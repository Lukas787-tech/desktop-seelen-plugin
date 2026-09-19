import { batchGames, blurbKey, buildBlurbPrompt, parseBlurbs, type Blurb, type BlurbRequest } from './blurb';
import { chat } from './chat.svelte';
import { noteAction, noteError } from './diagnostics';
import { debouncedWriter, readJson } from './persist';
import { providerFor, type ProviderId } from './providers';
import { decodeWhole, describeFailure } from './stream';
import { authorise, buildRequest } from './wire';

/**
 * The library's descriptions: asking a model for them, and keeping them.
 *
 * It borrows the assistant's services rather than keeping a second set - the
 * same keys, the same local servers, the same privacy setting - exactly as the
 * AI appearance designer does. A Gemini key pasted for the assistant is the key
 * this uses, and a "local only" assistant refuses a cloud description too.
 *
 * Gemini is the default because its free tier is the one most people already
 * have, it answers a batch of thirty in a couple of seconds, and it knows the
 * catalogue. Any other configured service works.
 *
 * Written to disk as it goes, a batch at a time: a library of two hundred is
 * several requests, and a failure on the fourth should not throw away the three
 * that worked.
 */

const FILE = 'game-blurbs.json';

/** A cold local model spends most of a minute loading before it answers. */
const TIMEOUT_MS = 120_000;

interface Stored {
  version: 1;
  blurbs: Record<string, Blurb>;
}

function defaults(): Stored {
  return { version: 1, blurbs: {} };
}

export type BlurbState =
  | { kind: 'ready' }
  | { kind: 'key'; provider: ProviderId }
  | { kind: 'offline'; provider: ProviderId }
  | { kind: 'local-only' };

class Blurbs {
  state = $state<Stored>(defaults());
  busy = $state(false);
  error = $state<string | null>(null);
  /** How far through the library the current run is. */
  progress = $state<{ done: number; total: number } | null>(null);
  /** Titles the model did not recognise on the last run. */
  skipped = $state(0);

  /** Which service answers. The assistant's own is the fallback. */
  provider = $state<ProviderId>('gemini');

  #writer = debouncedWriter(FILE, 600);
  #loaded = false;
  #loading: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #cancelled = false;

  /** Loads the cache once; safe to call from every component that shows one. */
  load(): Promise<void> {
    this.#loading ??= readJson<Stored>(FILE, defaults()).then((stored) => {
      this.state = { ...defaults(), ...stored, blurbs: stored.blurbs ?? {} };
      this.#loaded = true;
    });
    return this.#loading;
  }

  /** The description for a game, by its display name. */
  get(name: string): string | null {
    return this.state.blurbs[blurbKey(name)]?.text ?? null;
  }

  has(name: string): boolean {
    return !!this.get(name);
  }

  get count(): number {
    return Object.keys(this.state.blurbs).length;
  }

  /**
   * The service to use: the one chosen, or whichever already works.
   *
   * Gemini first because its free tier is the one most people already have;
   * then the assistant's own, then the rest. Nothing is stored, so a key added
   * later moves the default on its own.
   */
  suggest(assistantProvider: ProviderId): void {
    const order: ProviderId[] = ['gemini', assistantProvider, 'groq', 'openrouter', 'ollama', 'lmstudio', 'openai', 'anthropic', 'custom'];
    this.provider = order.find((id) => chat.usable(id)) ?? 'gemini';
  }

  /** What stands between the chosen service and an answer. */
  ready(): BlurbState {
    const id = this.provider;
    if (chat.prefs.privacy === 'local-only' && !chat.isLocal(id)) return { kind: 'local-only' };
    if (chat.usable(id)) return { kind: 'ready' };
    const provider = providerFor(id);
    return provider.local || id === 'custom' ? { kind: 'offline', provider: id } : { kind: 'key', provider: id };
  }

  /**
   * Writes descriptions for everything that has none.
   *
   * `refresh` rewrites the ones already stored too, for a library described by
   * a weaker model the first time round.
   */
  async describe(
    games: readonly { name: string; launcher?: string }[],
    options: { refresh?: boolean } = {},
  ): Promise<number> {
    await this.load();
    const state = this.ready();
    if (state.kind === 'local-only') throw this.#fail('The assistant is set to local services only; choose Ollama or LM Studio.');
    if (state.kind === 'key') throw this.#fail(`${providerFor(state.provider).label} needs an API key first.`);
    if (state.kind === 'offline') throw this.#fail(`${providerFor(state.provider).label} is not running.`);

    // One request per game, not per entry: two library entries for one game
    // would otherwise be described twice and counted twice.
    const wanted = new Map<string, BlurbRequest>();
    for (const game of games) {
      const key = blurbKey(game.name);
      if (!key || wanted.has(key)) continue;
      if (!options.refresh && this.state.blurbs[key]) continue;
      wanted.set(key, { key, name: game.name, launcher: game.launcher });
    }

    const todo = [...wanted.values()];
    if (!todo.length) return 0;

    const provider = providerFor(this.provider);
    const model = this.model();
    if (!model) throw this.#fail(`${provider.label} has no model to answer with.`);

    this.busy = true;
    this.error = null;
    this.skipped = 0;
    this.#cancelled = false;
    let written = 0;
    let skipped = 0;
    const batches = batchGames(todo, 30);
    this.progress = { done: 0, total: todo.length };

    try {
      for (const batch of batches) {
        if (this.#cancelled) break;
        const parsed = await this.#ask(batch, provider.id, model);
        for (const [key, text] of Object.entries(parsed.blurbs)) {
          this.state.blurbs[key] = { text, at: Date.now() };
          written++;
        }
        skipped += parsed.unknown.length;
        this.progress = { done: Math.min(todo.length, (this.progress?.done ?? 0) + batch.length), total: todo.length };
        // Saved per batch, so a failure later keeps what already worked.
        this.#writer.queue($state.snapshot(this.state));
      }
      this.skipped = skipped;
      noteAction(`blurbs: wrote ${written}, skipped ${skipped}`);
      return written;
    } finally {
      this.busy = false;
      this.progress = null;
      await this.#writer.flush();
    }
  }

  /** The model that will answer, as the dialog names it. */
  model(): string {
    const provider = providerFor(this.provider);
    return chat.isLocal(provider.id) ? (chat.localModel(provider.id) ?? '') : provider.fastModel || provider.defaultModel;
  }

  async #ask(batch: BlurbRequest[], id: ProviderId, model: string): Promise<ReturnType<typeof parseBlurbs>> {
    const provider = providerFor(id);
    const { system, user } = buildBlurbPrompt(batch);
    const request = buildRequest({
      wire: provider.wire,
      base: chat.baseFor(id),
      model,
      system,
      turns: [{ role: 'user', text: user }],
      tools: [],
      stream: false,
      // Thirty descriptions plus a thinking model's reasoning; an answer cut
      // off mid-object is no answer at all.
      maxTokens: 8192,
      // Low: this is recall, not invention, and invention is the failure mode.
      temperature: 0.2,
    });

    // Each service's own way of promising JSON.
    const body = request.body as Record<string, unknown>;
    if (provider.wire === 'gemini') {
      body.generationConfig = { ...((body.generationConfig as object) ?? {}), responseMimeType: 'application/json' };
    } else if (provider.wire === 'ollama') {
      body.format = 'json';
    } else if (id === 'openai' || id === 'groq') {
      body.response_format = { type: 'json_object' };
    }
    authorise(request, provider.wire, provider.keyless ? '' : chat.keyFor(id));

    const abort = new AbortController();
    this.#abort = abort;
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(describeFailure(response.status, await response.text().catch(() => '')));
      const decoded = decodeWhole(provider.wire, await response.json());
      const parsed = parseBlurbs(decoded.text, batch.map((game) => game.key));
      // A batch the model made nothing of is not fatal - the next one may be
      // full of titles it knows - so it is recorded and the run carries on.
      if (!parsed.ok) noteError(`blurbs: ${parsed.error ?? 'no answer'}`);
      return parsed;
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
      if (this.#abort === abort) this.#abort = null;
    }
  }

  cancel(): void {
    this.#cancelled = true;
    this.#abort?.abort();
  }

  /** Forgets one description, so the next run writes it again. */
  forget(name: string): void {
    delete this.state.blurbs[blurbKey(name)];
    if (this.#loaded) this.#writer.queue($state.snapshot(this.state));
  }

  clear(): void {
    this.state = defaults();
    this.#writer.queue($state.snapshot(this.state));
  }

  #fail(message: string): Error {
    this.error = message;
    return new Error(message);
  }
}

export const blurbs = new Blurbs();
