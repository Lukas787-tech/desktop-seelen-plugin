import { noteError } from './diagnostics';
import { readJson, writeJson } from './persist';
import type { UnSubscriber } from './seelen';

/**
 * A JSON file of lists that both display replicas edit.
 *
 * Every monitor gets its own webview but they share one data directory, so a
 * board, an agenda or a habit list shown on two displays is two copies of one
 * file being written by two processes. Last-writer-wins on the whole file - what
 * `notes.json` does - loses whatever the other display changed in between.
 *
 * So items are merged, not files. Each item carries an `id` and an `updatedAt`;
 * a write re-reads the file first, keeps the newer copy of every item, and
 * honours removals through a tombstone map rather than by absence (absence
 * cannot tell "deleted here" from "added there"). It is the same bargain
 * `mergeFiles` in `assistant-state.ts` makes for conversations, generalised.
 *
 * There is no file watch in the host API. A replica therefore re-reads when it
 * starts, whenever the pointer comes onto its panel - which is exactly when a
 * change made on the other display is about to matter - and on every write.
 */

import { mergeSynced, type Collections, type SyncedFileShape, type SyncedItem } from './merge';

export type { SyncedItem };

export class SyncedFile<C extends Collections> {
  data = $state() as C;
  loaded = $state(false);

  #filename: string;
  #empty: () => C;
  #firstRun: (() => C) | null;
  #deleted: Record<string, number> = {};
  #users = 0;
  /** Bumped on every local edit, so a slow re-read never overwrites a newer one. */
  #revision = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<void> = Promise.resolve();
  #loading: Promise<void> | null = null;
  #lastRead = 0;

  /**
   * @param empty     The shape with every collection present and empty.
   * @param firstRun  What a brand-new file starts with, e.g. a board's default
   *                  columns. Used only when there is no file at all.
   */
  constructor(filename: string, empty: () => C, firstRun?: () => C) {
    this.#filename = filename;
    this.#empty = empty;
    this.#firstRun = firstRun ?? null;
    this.data = empty();
  }

  /** Loads (or joins) the file; call the result to release it. */
  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) void this.refresh(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users === 0) void this.flush();
    };
  }

  /**
   * Reads the file and merges it over what is here.
   *
   * Cheap enough to call on every `pointerenter`; repeated calls inside a
   * couple of seconds are folded into the one already made.
   */
  refresh(force = false): Promise<void> {
    if (this.#loading) return this.#loading;
    if (!force && Date.now() - this.#lastRead < 2000) return Promise.resolve();

    this.#loading = (async () => {
      const revision = this.#revision;
      const raw = await readJson<unknown>(this.#filename, null);
      this.#lastRead = Date.now();

      if (raw === null && !this.loaded) {
        this.data = this.#firstRun ? this.#firstRun() : this.#empty();
        this.loaded = true;
        if (this.#firstRun) this.save(0);
        return;
      }

      const disk = this.#normalise(raw);
      if (!this.loaded) {
        this.data = disk.collections;
        this.#deleted = disk.deleted;
        this.loaded = true;
        return;
      }
      // A local edit made while the file was being read is newer than it; the
      // write that edit queued will merge the two instead.
      if (revision !== this.#revision) return;
      this.#adopt(mergeSynced(disk, this.#snapshot()));
    })()
      .catch((err) => noteError(`${this.#filename}: read ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.#loading = null;
      });
    return this.#loading;
  }

  /** Adds an item, or replaces the one with the same id. */
  put<K extends keyof C>(collection: K, item: C[K][number]): void {
    const list = this.data[collection] as SyncedItem[];
    const stamped = { ...item, updatedAt: Date.now() };
    const at = list.findIndex((existing) => existing.id === item.id);
    if (at === -1) list.push(stamped);
    else list[at] = stamped;
    this.save();
  }

  /** Changes some fields of one item. */
  update<K extends keyof C>(collection: K, id: string, patch: Partial<C[K][number]>): void {
    const list = this.data[collection] as SyncedItem[];
    const at = list.findIndex((existing) => existing.id === id);
    if (at === -1) return;
    list[at] = { ...list[at], ...patch, updatedAt: Date.now() } as SyncedItem;
    this.save();
  }

  remove<K extends keyof C>(collection: K, ...ids: string[]): void {
    if (!ids.length) return;
    const gone = new Set(ids);
    const now = Date.now();
    for (const id of ids) this.#deleted[id] = now;
    (this.data[collection] as SyncedItem[]) = (this.data[collection] as SyncedItem[]).filter((item) => !gone.has(item.id));
    this.save();
  }

  save(delay = 450): void {
    if (!this.loaded) return;
    this.#revision++;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#write();
    }, delay);
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#write();
    }
    await this.#inFlight;
  }

  #write(): void {
    const revision = this.#revision;
    const mine = this.#snapshot();
    this.#inFlight = this.#inFlight
      .then(async () => {
        const disk = this.#normalise(await readJson<unknown>(this.#filename, null));
        const merged = mergeSynced(disk, mine);
        await writeJson(this.#filename, merged);
        this.#lastRead = Date.now();
        if (revision === this.#revision) this.#adopt(merged);
      })
      .catch((err) => noteError(`${this.#filename}: write ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Takes a merged result, touching the reactive state only if it differs. */
  #adopt(merged: SyncedFileShape<C>): void {
    this.#deleted = merged.deleted;
    const current = JSON.stringify($state.snapshot(this.data));
    if (JSON.stringify(merged.collections) !== current) this.data = merged.collections;
  }

  #snapshot(): SyncedFileShape<C> {
    return { version: 1, collections: $state.snapshot(this.data) as C, deleted: { ...this.#deleted } };
  }

  #normalise(raw: unknown): SyncedFileShape<C> {
    const empty = this.#empty();
    const file = (raw && typeof raw === 'object' ? raw : {}) as Partial<SyncedFileShape<C>>;
    const collections = { ...empty } as Record<string, SyncedItem[]>;
    for (const key of Object.keys(empty)) {
      const list = (file.collections as Record<string, unknown> | undefined)?.[key];
      collections[key] = Array.isArray(list)
        ? list.filter((item): item is SyncedItem => !!item && typeof item === 'object' && typeof item.id === 'string')
            .map((item) => ({ ...item, updatedAt: Number(item.updatedAt) || 0 }))
        : [];
    }
    return { version: 1, collections: collections as C, deleted: { ...(file.deleted ?? {}) } };
  }
}
