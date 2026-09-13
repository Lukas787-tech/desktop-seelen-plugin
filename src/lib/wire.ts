/**
 * The four request and response shapes a model is spoken to in.
 *
 * OpenAI's `/chat/completions` (which Groq, OpenRouter, LM Studio, llama.cpp
 * and most self-hosted servers also speak), Google's `:streamGenerateContent`,
 * Anthropic's `/v1/messages`, and Ollama's own `/api/chat`.
 *
 * Ollama is spoken to natively rather than through its OpenAI shim, because
 * the shim drops the three things that make a local model usable as an agent:
 * `num_ctx` (Ollama's default context is small enough that a list of tool
 * schemas silently pushes the system prompt out of the window), `keep_alive`
 * (a 12B model takes ~12s to load, measured, so letting it unload between
 * questions makes every one of them slow), and `think`.
 *
 * Everything here is pure: no host, no Svelte, no fetch. The store hands this
 * a normalised transcript and gets back a request; it hands this the frames of
 * a response and gets back text, reasoning and tool calls. That is what lets
 * one conversation fail over from one service to another mid-turn, and what
 * lets `npm test` exercise every wire without a network.
 */

export type Wire = 'openai' | 'gemini' | 'anthropic' | 'ollama';

/** JSON Schema for a tool's arguments - the one shape all four wires take. */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Omitted for a tool that takes nothing; Gemini rejects an empty object. */
  parameters?: ToolSchema;
}

/** One tool the model asked for, normalised across the wires. */
export interface ToolCall {
  /** The provider's own id for this call, echoed back with the result. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini's `thoughtSignature`, which has to be replayed with the call. */
  signature?: string;
}

export interface ToolResult {
  call: ToolCall;
  result: unknown;
}

/**
 * The conversation, independent of who it is sent to.
 *
 * Images are `data:` URLs, the one form every wire can be given its own shape
 * of without a second copy being stored.
 */
export type Turn =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; text: string; calls?: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

export interface RequestOptions {
  wire: Wire;
  /** Everything before the per-wire path. */
  base: string;
  model: string;
  system: string;
  turns: Turn[];
  tools: readonly ToolSpec[];
  stream: boolean;
  maxTokens: number;
  temperature?: number | null;
  topP?: number | null;
  /** Ollama only. */
  numCtx?: number | null;
  keepAlive?: string | null;
  /** Ollama only; `null` leaves the model's own default alone. */
  think?: boolean | null;
  /** OpenAI proper only - other servers reject the field. */
  includeUsage?: boolean;
}

export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * How much of one tool result is sent back.
 *
 * A web page or a folder listing can be hundreds of kilobytes; replaying that
 * every round would spend a small model's whole context on one answer.
 */
export const RESULT_LIMIT = 12_000;

export function resultText(result: unknown): string {
  const text = typeof result === 'string' ? result : (JSON.stringify(result) ?? 'null');
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}... [truncated]` : text;
}

/** `data:image/png;base64,AAAA` -> its parts, or null for anything else. */
export function splitDataUrl(url: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return match ? { mime: match[1] ?? 'image/png', data: match[2] ?? '' } : null;
}

/**
 * Makes a stored transcript sendable.
 *
 * Every wire rejects a tool call with no result after it, and a turn stopped
 * mid-tool leaves exactly that behind. The stopped calls are answered with a
 * result that says so, rather than dropped, so the model does not think it
 * never tried. Results for calls that are not in the turn before them, and
 * empty assistant turns, are removed.
 */
export function repairTurns(turns: readonly Turn[]): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i] as Turn;
    if (turn.role === 'tool') continue;
    if (turn.role === 'user') {
      out.push(turn);
      continue;
    }

    const calls = turn.calls ?? [];
    if (!calls.length) {
      if (turn.text.trim()) out.push({ role: 'assistant', text: turn.text });
      continue;
    }

    out.push({ role: 'assistant', text: turn.text, calls });
    const next = turns[i + 1];
    const given = next?.role === 'tool' ? next.results : [];
    out.push({
      role: 'tool',
      results: calls.map(
        (call) =>
          given.find((r) => r.call.id === call.id) ?? {
            call,
            result: { error: 'Not run: the turn was stopped before this call finished.' },
          },
      ),
    });
    if (next?.role === 'tool') i++;
  }
  return out;
}

/** Joins neighbouring messages of one role, which Anthropic and Gemini require. */
function mergeRoles<T extends { role: string }>(
  messages: T[],
  join: (into: T, from: T) => void,
): T[] {
  const out: T[] = [];
  for (const message of messages) {
    const last = out.at(-1);
    if (last && last.role === message.role) join(last, message);
    else out.push(message);
  }
  return out;
}

function openaiMessages(system: string, turns: Turn[]): unknown[] {
  const out: unknown[] = system ? [{ role: 'system', content: system }] : [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      out.push({
        role: 'user',
        content: turn.images?.length
          ? [
              { type: 'text', text: turn.text },
              ...turn.images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ]
          : turn.text,
      });
    } else if (turn.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: turn.text || null,
        ...(turn.calls?.length
          ? {
              tool_calls: turn.calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of turn.results) {
        out.push({ role: 'tool', tool_call_id: r.call.id, content: resultText(r.result) });
      }
    }
  }
  return out;
}

function ollamaMessages(system: string, turns: Turn[]): unknown[] {
  const out: unknown[] = system ? [{ role: 'system', content: system }] : [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      const images = (turn.images ?? []).map((u) => splitDataUrl(u)?.data).filter(Boolean);
      out.push({ role: 'user', content: turn.text, ...(images.length ? { images } : {}) });
    } else if (turn.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: turn.text,
        ...(turn.calls?.length
          ? { tool_calls: turn.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
          : {}),
      });
    } else {
      for (const r of turn.results) {
        out.push({ role: 'tool', tool_name: r.call.name, content: resultText(r.result) });
      }
    }
  }
  return out;
}

type Block = Record<string, unknown>;

function anthropicMessages(turns: Turn[]): unknown[] {
  const messages: { role: string; content: Block[] }[] = [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      const images = (turn.images ?? [])
        .map((u) => splitDataUrl(u))
        .filter((p): p is { mime: string; data: string } => !!p)
        .map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }));
      messages.push({ role: 'user', content: [...images, { type: 'text', text: turn.text }] });
    } else if (turn.role === 'assistant') {
      const content: Block[] = turn.text ? [{ type: 'text', text: turn.text }] : [];
      for (const c of turn.calls ?? []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      }
      if (content.length) messages.push({ role: 'assistant', content });
    } else {
      messages.push({
        role: 'user',
        content: turn.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.call.id,
          content: resultText(r.result),
        })),
      });
    }
  }
  return mergeRoles(messages, (into, from) => into.content.push(...from.content));
}

function geminiMessages(turns: Turn[]): unknown[] {
  const messages: { role: string; parts: Block[] }[] = [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      const images = (turn.images ?? [])
        .map((u) => splitDataUrl(u))
        .filter((p): p is { mime: string; data: string } => !!p)
        .map((p) => ({ inlineData: { mimeType: p.mime, data: p.data } }));
      messages.push({ role: 'user', parts: [{ text: turn.text }, ...images] });
    } else if (turn.role === 'assistant') {
      const parts: Block[] = turn.text ? [{ text: turn.text }] : [];
      for (const c of turn.calls ?? []) {
        parts.push({
          functionCall: { name: c.name, args: c.args },
          ...(c.signature ? { thoughtSignature: c.signature } : {}),
        });
      }
      if (parts.length) messages.push({ role: 'model', parts });
    } else {
      messages.push({
        role: 'user',
        parts: turn.results.map((r) => ({
          functionResponse: {
            name: r.call.name,
            // Gemini requires an object here, so a bare value is wrapped.
            response: { result: resultText(r.result) },
          },
        })),
      });
    }
  }
  return mergeRoles(messages, (into, from) => into.parts.push(...from.parts));
}

function toolsPayload(wire: Wire, tools: readonly ToolSpec[]): unknown {
  if (!tools.length) return undefined;
  if (wire === 'gemini') {
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          ...(t.parameters ? { parameters: t.parameters } : {}),
        })),
      },
    ];
  }
  const schema = (t: ToolSpec) => t.parameters ?? { type: 'object', properties: {} };
  if (wire === 'anthropic') {
    return tools.map((t) => ({ name: t.name, description: t.description, input_schema: schema(t) }));
  }
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: schema(t) },
  }));
}

/** Drops keys whose value is undefined, so a request carries only what was set. */
function compact(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

const num = (v: number | null | undefined) => (typeof v === 'number' ? v : undefined);

/** Builds the one request this wire understands. The credential is added by `authorise`. */
export function buildRequest(o: RequestOptions): WireRequest {
  const json = { 'content-type': 'application/json' };
  const turns = repairTurns(o.turns);
  const tools = toolsPayload(o.wire, o.tools);

  if (o.wire === 'ollama') {
    const options = compact({
      num_ctx: num(o.numCtx),
      temperature: num(o.temperature),
      top_p: num(o.topP),
      num_predict: o.maxTokens,
    });
    return {
      url: `${o.base}/api/chat`,
      headers: json,
      body: compact({
        model: o.model,
        messages: ollamaMessages(o.system, turns),
        tools,
        stream: o.stream,
        think: typeof o.think === 'boolean' ? o.think : undefined,
        keep_alive: o.keepAlive || undefined,
        options,
      }),
    };
  }

  if (o.wire === 'gemini') {
    const verb = o.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return {
      url: `${o.base}/models/${encodeURIComponent(o.model)}:${verb}`,
      // In a header rather than the documented `?key=`, so it never lands in a
      // URL something downstream might log.
      headers: { ...json, 'x-goog-api-key': '' },
      body: compact({
        systemInstruction: o.system ? { parts: [{ text: o.system }] } : undefined,
        contents: geminiMessages(turns),
        tools,
        generationConfig: compact({
          maxOutputTokens: o.maxTokens,
          temperature: num(o.temperature),
          topP: num(o.topP),
        }),
      }),
    };
  }

  if (o.wire === 'anthropic') {
    return {
      url: `${o.base}/messages`,
      headers: {
        ...json,
        'x-api-key': '',
        'anthropic-version': '2023-06-01',
        // Without this the API rejects a request carrying a browser `Origin`,
        // which is what a webview widget always sends.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: compact({
        model: o.model,
        max_tokens: o.maxTokens,
        system: o.system || undefined,
        stream: o.stream,
        tools,
        temperature: num(o.temperature),
        messages: anthropicMessages(turns),
      }),
    };
  }

  return {
    url: `${o.base}/chat/completions`,
    headers: { ...json, authorization: '' },
    body: compact({
      model: o.model,
      max_tokens: o.maxTokens,
      stream: o.stream,
      stream_options: o.stream && o.includeUsage ? { include_usage: true } : undefined,
      tools,
      temperature: num(o.temperature),
      top_p: num(o.topP),
      messages: openaiMessages(o.system, turns),
    }),
  };
}

/** Puts the credential on whichever header this wire authenticates with. */
export function authorise(request: WireRequest, wire: Wire, key: string): void {
  if (!key) {
    delete request.headers['x-goog-api-key'];
    delete request.headers['x-api-key'];
    delete request.headers.authorization;
    return;
  }
  if (wire === 'gemini') request.headers['x-goog-api-key'] = key;
  else if (wire === 'anthropic') request.headers['x-api-key'] = key;
  else request.headers.authorization = `Bearer ${key}`;
}
