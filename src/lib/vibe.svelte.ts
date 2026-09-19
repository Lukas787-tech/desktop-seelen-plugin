import { chat } from './chat.svelte';
import { readJson, writeJson } from './persist';
import { PROVIDERS, providerFor, type ProviderId } from './providers';
import { decodeWhole, describeFailure } from './stream';
import { parseVibe, buildVibePrompt, type VibeDesign, type VibeRequest } from './vibe';
import { authorise, buildRequest } from './wire';

/**
 * The AI appearance designer's network half: which service answers, and the
 * one request that asks it for a design.
 *
 * It borrows the assistant's services rather than keeping a second set: the
 * same keys, the same local servers, the same privacy setting. A Gemini key
 * pasted here is the assistant's Gemini key, and a "local only" assistant
 * refuses a cloud designer too.
 *
 * One request, not a conversation and not a stream - the answer is a JSON
 * object that is useless until it is whole, so there is nothing to show early.
 * Each service is asked for JSON in the way it supports, which is what keeps a
 * small model from wrapping the object in chat.
 */

const FILE = 'appearance-ai.json';

/** Timeouts are generous: a cold local model spends most of a minute loading. */
const TIMEOUT_MS = 150_000;

/**
 * Where a design costs nothing: a Gemini key from AI Studio and Groq's key are
 * free tiers, OpenRouter has free models, and Ollama runs on this PC.
 */
export const FREE_PROVIDERS: readonly ProviderId[] = ['gemini', 'groq', 'openrouter', 'ollama'];

export type DesignerState =
  | { kind: 'ready' }
  | { kind: 'key'; provider: ProviderId }
  | { kind: 'offline'; provider: ProviderId }
  | { kind: 'local-only' };

interface Prefs {
  provider: ProviderId | null;
  model: string;
}

class VibeDesigner {
  provider = $state<ProviderId>('gemini');
  model = $state('');
  busy = $state(false);
  error = $state<string | null>(null);

  #chosen = false;
  #cancelled = false;
  #abort: AbortController | null = null;
  #loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.#loading ??= readJson<Partial<Prefs>>(FILE, {}).then((prefs) => {
      if (prefs.provider && PROVIDERS.some((p) => p.id === prefs.provider)) {
        this.provider = prefs.provider;
        this.#chosen = true;
      }
      if (typeof prefs.model === 'string') this.model = prefs.model;
    });
    return this.#loading;
  }

  /**
   * The service to use when none has been chosen: whichever already works,
   * a free one first, the assistant's own next. Nothing is saved, so a key
   * added later still moves the default.
   */
  suggest(assistantProvider: ProviderId): void {
    if (this.#chosen) return;
    const order: ProviderId[] = ['gemini', assistantProvider, 'ollama', 'groq', 'openrouter', 'lmstudio', 'openai', 'anthropic', 'custom'];
    this.provider = order.find((id) => chat.usable(id)) ?? 'gemini';
  }

  choose(id: ProviderId): void {
    this.provider = id;
    this.#chosen = true;
    this.#save();
  }

  setModel(model: string): void {
    this.model = model.trim();
    this.#save();
  }

  #save(): void {
    void writeJson(FILE, { provider: this.#chosen ? this.provider : null, model: this.model } satisfies Prefs).catch((err) =>
      console.error('[vibe] could not save the designer settings', err),
    );
  }

  /** What stands between the chosen service and a design. */
  state(): DesignerState {
    const id = this.provider;
    if (chat.prefs.privacy === 'local-only' && !chat.isLocal(id)) return { kind: 'local-only' };
    if (chat.usable(id)) return { kind: 'ready' };
    const provider = providerFor(id);
    if (provider.local || id === 'custom') return { kind: 'offline', provider: id };
    return { kind: 'key', provider: id };
  }

  /** The model that will answer, as the dialog names it. */
  modelFor(): string {
    const provider = providerFor(this.provider);
    return this.model || (chat.isLocal(provider.id) ? (chat.localModel(provider.id) ?? '') : provider.defaultModel);
  }

  async design(req: VibeRequest): Promise<VibeDesign> {
    const state = this.state();
    if (state.kind === 'local-only') throw this.#fail('The assistant is set to local services only; choose Ollama or LM Studio.');
    if (state.kind === 'key') throw this.#fail(`${providerFor(state.provider).label} needs an API key first.`);
    if (state.kind === 'offline') throw this.#fail(`${providerFor(state.provider).label} is not running.`);

    const provider = providerFor(this.provider);
    const model = this.modelFor();
    if (!model) throw this.#fail(`${provider.label} has no model to answer with.`);

    const { system, user } = buildVibePrompt(req);
    const request = buildRequest({
      wire: provider.wire,
      base: chat.baseFor(provider.id),
      model,
      system,
      turns: [{ role: 'user', text: user }],
      tools: [],
      stream: false,
      // Room for a thinking model's reasoning as well as the object itself: a
      // design cut off mid-object is not a design.
      maxTokens: 8192,
      temperature: 0.85,
    });

    // Each service's own way of promising JSON.
    const body = request.body as Record<string, unknown>;
    if (provider.wire === 'gemini') {
      body.generationConfig = { ...((body.generationConfig as object) ?? {}), responseMimeType: 'application/json' };
    } else if (provider.wire === 'ollama') {
      body.format = 'json';
    } else if (provider.id === 'openai' || provider.id === 'groq') {
      body.response_format = { type: 'json_object' };
    }
    authorise(request, provider.wire, provider.keyless ? '' : chat.keyFor(provider.id));

    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    this.#cancelled = false;
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    this.busy = true;
    this.error = null;

    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(describeFailure(response.status, await response.text().catch(() => '')));
      const decoded = decodeWhole(provider.wire, await response.json());
      const parsed = parseVibe(decoded.text, { fonts: req.fonts, styleShell: req.styleShell, includeShell: req.includeShell });
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.design;
    } catch (err) {
      const message = abort.signal.aborted
        ? this.#cancelled
          ? 'Stopped.'
          : 'The model took too long to answer.'
        : err instanceof TypeError
          ? `Could not reach ${provider.label}. Check the connection${provider.local ? ' and that it is running' : ''}.`
          : err instanceof Error
            ? err.message
            : String(err);
      throw this.#fail(message);
    } finally {
      clearTimeout(timer);
      this.busy = false;
      if (this.#abort === abort) this.#abort = null;
    }
  }

  cancel(): void {
    this.#cancelled = true;
    this.#abort?.abort();
  }

  #fail(message: string): Error {
    this.error = message;
    return new Error(message);
  }
}

export const designer = new VibeDesigner();
