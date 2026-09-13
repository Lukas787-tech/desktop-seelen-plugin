import type { ToolCall, Wire } from './wire';

/**
 * Reading a model's reply as it arrives, on any of the four wires.
 *
 * Tools and streaming used to be exclusive here: a tool round was read whole,
 * so any turn with tools switched on arrived all at once after a long silence.
 * Each wire does stream its tool calls - OpenAI as argument fragments keyed by
 * index, Anthropic as partial JSON per content block, Gemini and Ollama as
 * whole calls in one chunk - so the assembler below collects those while the
 * prose streams, and a round is only known to want tools once it has ended.
 *
 * Pure, like `wire.ts`: frames in, text and calls out.
 */

export interface Frame {
  event: string;
  data: string;
}

/** A fetch response body, whose byte type is narrower than `ReadableStream<Uint8Array>`. */
type Body = Response['body'];

/** Pulls `event:`/`data:` frames out of an SSE body, per the EventSource grammar. */
export async function* sseFrames(body: Body): AsyncGenerator<Frame> {
  if (!body) return;
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let event = '';
  let data = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          // A blank line closes the frame; frames with no data are keep-alives.
          if (data) yield { event, data };
          event = '';
          data = '';
        } else if (line.startsWith('data:')) {
          data += (data ? '\n' : '') + line.slice(5).trimStart();
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        }
      }
    }
    const tail = buffer.replace(/\r$/, '');
    if (tail.startsWith('data:')) data += (data ? '\n' : '') + tail.slice(5).trimStart();
    if (data) yield { event, data };
  } finally {
    void reader.cancel().catch(() => {
      /* the stream is already going away */
    });
  }
}

/** Ollama streams one JSON object per line rather than SSE. */
export async function* ndjsonFrames(body: Body): AsyncGenerator<Frame> {
  if (!body) return;
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield { event: '', data: line };
      }
    }
    if (buffer.trim()) yield { event: '', data: buffer.trim() };
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function framesOf(wire: Wire, body: Body): AsyncGenerator<Frame> {
  return wire === 'ollama' ? ndjsonFrames(body) : sseFrames(body);
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Only Ollama reports generation time, which is what makes this measurable. */
  tokensPerSecond: number | null;
}

export interface Decoded {
  text: string;
  thinking: string;
  calls: ToolCall[];
  stop: string | null;
  usage: Usage;
}

/** What one frame added. */
export interface Delta {
  text?: string;
  thinking?: string;
  /** A failure reported inside a 200 stream, which every wire can do. */
  error?: string;
}

let callSerial = 0;

/**
 * Unique across rounds and across wires: a Gemini call id is invented here, and
 * a conversation that fails over to Anthropic replays it as a `tool_use` id,
 * which must be unique within the request.
 */
function inventId(): string {
  callSerial += 1;
  return `call_${Date.now().toString(36)}_${callSerial.toString(36)}`;
}

export function safeArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A model can produce unparseable arguments; an empty bag lets the tool
    // answer with what is missing instead of failing the whole turn.
    return {};
  }
}

function parse(data: string): any {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function errorOf(root: any): string | undefined {
  const e = root?.error;
  if (!e) return undefined;
  if (typeof e === 'string') return e;
  return typeof e.message === 'string' ? e.message : JSON.stringify(e);
}

interface Pending {
  id: string;
  name: string;
  args: string | Record<string, unknown>;
  signature?: string;
}

export class StreamAssembler {
  text = '';
  thinking = '';
  stop: string | null = null;
  usage: Usage = { inputTokens: null, outputTokens: null, tokensPerSecond: null };

  #wire: Wire;
  /** Keyed by the wire's own index where it has one, so fragments land together. */
  #calls = new Map<string, Pending>();

  constructor(wire: Wire) {
    this.#wire = wire;
  }

  push(frame: Frame): Delta {
    if (this.#wire === 'openai' && frame.data === '[DONE]') return {};
    if (this.#wire === 'anthropic' && frame.event === 'error') {
      return { error: errorOf(parse(frame.data)) ?? 'The service reported an error.' };
    }
    const root = parse(frame.data);
    if (!root) return {};
    const error = errorOf(root);
    if (error) return { error };

    const delta =
      this.#wire === 'openai'
        ? this.#openai(root)
        : this.#wire === 'anthropic'
          ? this.#anthropic(frame.event || root.type, root)
          : this.#wire === 'gemini'
            ? this.#gemini(root)
            : this.#ollama(root);
    if (delta.text) this.text += delta.text;
    if (delta.thinking) this.thinking += delta.thinking;
    return delta;
  }

  finish(): Decoded {
    const calls = [...this.#calls.values()]
      .filter((c) => c.name)
      .map((c) => ({
        id: c.id,
        name: c.name,
        args: safeArgs(c.args),
        ...(c.signature ? { signature: c.signature } : {}),
      }));
    return { text: this.text, thinking: this.thinking, calls, stop: this.stop, usage: this.usage };
  }

  #openai(root: any): Delta {
    if (root.usage) {
      this.usage.inputTokens = root.usage.prompt_tokens ?? null;
      this.usage.outputTokens = root.usage.completion_tokens ?? null;
    }
    const choice = root.choices?.[0];
    if (!choice) return {};
    if (choice.finish_reason) this.stop = choice.finish_reason;
    // A non-streamed body has `message` where a stream has `delta`.
    const delta = choice.delta ?? choice.message ?? {};
    for (const [i, part] of (delta.tool_calls ?? []).entries()) {
      const key = String(part.index ?? i);
      const entry = this.#calls.get(key) ?? { id: part.id ?? inventId(), name: '', args: '' };
      if (part.id) entry.id = part.id;
      if (part.function?.name) entry.name += part.function.name;
      const args = part.function?.arguments;
      if (typeof args === 'string') entry.args = `${typeof entry.args === 'string' ? entry.args : ''}${args}`;
      else if (args && typeof args === 'object') entry.args = args;
      this.#calls.set(key, entry);
    }
    const thinking = delta.reasoning_content ?? delta.reasoning;
    return {
      text: typeof delta.content === 'string' ? delta.content : undefined,
      thinking: typeof thinking === 'string' ? thinking : undefined,
    };
  }

  #anthropic(event: string, root: any): Delta {
    if (event === 'message_start') {
      this.usage.inputTokens = root.message?.usage?.input_tokens ?? null;
      return {};
    }
    if (event === 'message_delta') {
      if (root.delta?.stop_reason) this.stop = root.delta.stop_reason;
      if (root.usage?.output_tokens != null) this.usage.outputTokens = root.usage.output_tokens;
      return {};
    }
    if (event === 'content_block_start') {
      const block = root.content_block;
      if (block?.type === 'tool_use') {
        this.#calls.set(String(root.index), { id: block.id ?? inventId(), name: block.name ?? '', args: '' });
      }
      return {};
    }
    if (event === 'content_block_delta') {
      const d = root.delta;
      if (d?.type === 'text_delta') return { text: d.text };
      if (d?.type === 'thinking_delta') return { thinking: d.thinking };
      if (d?.type === 'input_json_delta') {
        const entry = this.#calls.get(String(root.index));
        if (entry && typeof entry.args === 'string') entry.args += d.partial_json ?? '';
      }
    }
    return {};
  }

  #gemini(root: any): Delta {
    const meta = root.usageMetadata;
    if (meta) {
      this.usage.inputTokens = meta.promptTokenCount ?? null;
      this.usage.outputTokens = meta.candidatesTokenCount ?? null;
    }
    const candidate = root.candidates?.[0];
    if (candidate?.finishReason) this.stop = candidate.finishReason;
    let text = '';
    let thinking = '';
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) {
        const id = inventId();
        this.#calls.set(id, {
          id,
          name: part.functionCall.name ?? '',
          args: part.functionCall.args ?? {},
          ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
        });
      } else if (typeof part.text === 'string') {
        if (part.thought) thinking += part.text;
        else text += part.text;
      }
    }
    return { text: text || undefined, thinking: thinking || undefined };
  }

  #ollama(root: any): Delta {
    const message = root.message ?? {};
    for (const call of message.tool_calls ?? []) {
      const id = call.id || inventId();
      this.#calls.set(id, { id, name: call.function?.name ?? '', args: call.function?.arguments ?? {} });
    }
    if (root.done) {
      this.stop = root.done_reason ?? 'stop';
      this.usage.inputTokens = root.prompt_eval_count ?? null;
      this.usage.outputTokens = root.eval_count ?? null;
      // Durations are nanoseconds.
      if (root.eval_count && root.eval_duration) {
        this.usage.tokensPerSecond = Math.round((root.eval_count / root.eval_duration) * 1e9 * 10) / 10;
      }
    }
    return {
      text: typeof message.content === 'string' && message.content ? message.content : undefined,
      thinking: typeof message.thinking === 'string' && message.thinking ? message.thinking : undefined,
    };
  }
}

/** A non-streamed response, read through the same assembler as a stream. */
export function decodeWhole(wire: Wire, payload: unknown): Decoded {
  const assembler = new StreamAssembler(wire);
  if (wire !== 'anthropic') {
    const error = assembler.push({ event: '', data: JSON.stringify(payload) }).error;
    if (error) throw new Error(error);
    return assembler.finish();
  }
  // Anthropic's whole reply is blocks rather than events; replay it as events.
  const body = payload as any;
  assembler.push({ event: 'message_start', data: JSON.stringify({ message: body }) });
  for (const [index, block] of (body?.content ?? []).entries()) {
    if (block.type === 'text') {
      assembler.push({ event: 'content_block_delta', data: JSON.stringify({ index, delta: { type: 'text_delta', text: block.text } }) });
    } else if (block.type === 'thinking') {
      assembler.push({ event: 'content_block_delta', data: JSON.stringify({ index, delta: { type: 'thinking_delta', thinking: block.thinking } }) });
    } else if (block.type === 'tool_use') {
      assembler.push({ event: 'content_block_start', data: JSON.stringify({ index, content_block: { ...block, input: undefined } }) });
      assembler.push({ event: 'content_block_delta', data: JSON.stringify({ index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } }) });
    }
  }
  assembler.push({ event: 'message_delta', data: JSON.stringify({ delta: { stop_reason: body?.stop_reason }, usage: body?.usage }) });
  return assembler.finish();
}

/**
 * Turns a failed response into one line a user can act on.
 *
 * Every provider nests its message differently but all of them put a human
 * string somewhere under `error`; the status is the fallback because an HTML
 * error page from a proxy has no JSON at all.
 */
export function describeFailure(status: number, raw: string): string {
  const root = parse(raw);
  let detail = errorOf(root) ?? (typeof root?.message === 'string' ? root.message : '');
  if (!detail && raw && !raw.trimStart().startsWith('<')) detail = raw.slice(0, 200);
  if (status === 401 || status === 403) return detail || 'The API key was rejected.';
  if (status === 429) return detail || 'Rate limited; try again shortly.';
  if (status === 404 && /model/i.test(detail)) return `${detail}. Pick an installed model in the assistant's settings.`;
  return detail || `Request failed (${status}).`;
}
