import { addDays, toDateKey } from './agenda';
import { noteError } from './diagnostics';
import { Lease } from './lease.svelte';
import { readJson, writeJson } from './persist';
import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import type { FocusedApp } from '@seelen-ui/lib/types';

/**
 * Screen time: how long each application held the foreground, per day.
 *
 * ## What is measured
 *
 * The host announces every foreground change (`global-focus-changed`), so the
 * time between one announcement and the next belongs to the window that was
 * announced. Nothing polls for that. What cannot be announced is the absence
 * of a person, so once every 30 seconds the pointer position is read: a pointer
 * that has not moved and a foreground that has not changed for the "away after"
 * setting stops the count, back-dated to the last sign of life. A fullscreen
 * window never counts as away - a film or a game is watched with the mouse
 * still. The lock screen always does.
 *
 * ## Who measures
 *
 * Only the replica holding the `usage` lease counts (see `lease.svelte.ts`):
 * every replica receives the same focus events, and two counting would double
 * every minute. The others read the file once a minute to show it. Counting
 * happens only while a Screen time panel is on some display - the same bargain
 * every other module makes - and the panel says so.
 */

export interface UsageApp {
  name: string;
  exe: string | null;
  umid: string | null;
}

export interface UsageFile {
  version: 1;
  apps: Record<string, UsageApp>;
  /** Day key to app key to seconds. */
  days: Record<string, Record<string, number>>;
  /** Day key to how many times the foreground changed application. */
  switches: Record<string, number>;
}

const FILE = 'usage.json';
const KEEP_DAYS = 35;
const CHECK_MS = 30_000;
const SAVE_MS = 60_000;

function empty(): UsageFile {
  return { version: 1, apps: {}, days: {}, switches: {} };
}

function basename(path: string | null): string {
  return path?.split(/[\\/]/).pop() ?? '';
}

/** Which application a foreground window belongs to, or null for "nobody". */
function identify(app: FocusedApp): { key: string; info: UsageApp } | null {
  const exe = basename(app.exe).toLowerCase();
  if (exe === 'lockapp.exe' || exe === 'logonui.exe') return null;
  if (app.class === 'Progman' || app.class === 'WorkerW') {
    return { key: 'desktop', info: { name: 'Desktop', exe: null, umid: null } };
  }
  const key = app.umid ? `umid:${app.umid.toLowerCase()}` : exe ? `exe:${exe}` : app.name ? `name:${app.name.toLowerCase()}` : null;
  if (!key) return null;
  const name = app.name?.trim() || basename(app.exe).replace(/\.exe$/i, '') || 'Unknown';
  return { key, info: { name, exe: app.exe, umid: app.umid } };
}

class UsageStore {
  data = $state<UsageFile>(empty());
  loaded = $state(false);
  /** What holds the foreground now, as far as counting goes. */
  current = $state<{ key: string; name: string } | null>(null);
  away = $state(false);
  lease = new Lease('usage');

  #users = 0;
  #generation = 0;
  #releases: UnSubscriber[] = [];
  #check: ReturnType<typeof setInterval> | undefined;
  #save: ReturnType<typeof setInterval> | undefined;

  #idleMs = 5 * 60_000;
  #ignored = new Set<string>();

  #focus: FocusedApp | null = null;
  #since = Date.now();
  #lastActivity = Date.now();
  #lastPointer = '';
  #wasHolder = false;
  #dirty = false;

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) void this.#start(++this.#generation);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      this.#generation++;
      this.#tally(Date.now());
      void this.#persist();
      clearInterval(this.#check);
      clearInterval(this.#save);
      for (const release of this.#releases.splice(0)) release();
      this.current = null;
    };
  }

  /** From the panel's settings. */
  configure(idleMinutes: number, ignore: string): void {
    this.#idleMs = Math.max(1, idleMinutes) * 60_000;
    this.#ignored = new Set(
      ignore
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  clear(): void {
    this.data = empty();
    this.#dirty = true;
    void this.#persist();
  }

  async #start(mine: number): Promise<void> {
    this.#releases.push(this.lease.acquire());
    await this.#reload();
    if (mine !== this.#generation) return;

    try {
      const off = await subscribe(SeelenEvent.GlobalFocusChanged, ({ payload }) => {
        if (mine === this.#generation) this.#onFocus(payload as FocusedApp);
      });
      if (mine === this.#generation) this.#releases.push(off);
      else off();
      this.#onFocus(await invoke(SeelenCommand.GetFocusedApp));
    } catch (err) {
      noteError(`usage: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.#check = setInterval(() => void this.#checkActivity(), CHECK_MS);
    this.#save = setInterval(() => void this.#periodic(), SAVE_MS);
  }

  #onFocus(app: FocusedApp): void {
    const now = Date.now();
    this.#tally(now);
    const before = this.#focus ? identify(this.#focus)?.key : null;
    this.#focus = app;
    this.#lastActivity = now;
    if (this.away) this.away = false;

    const who = identify(app);
    this.current = who ? { key: who.key, name: who.info.name } : null;
    if (who && this.lease.held) {
      this.data.apps[who.key] = who.info;
      if (before && before !== who.key) {
        const day = toDateKey(new Date(now));
        this.data.switches[day] = (this.data.switches[day] ?? 0) + 1;
      }
    }
  }

  async #checkActivity(): Promise<void> {
    const now = Date.now();
    try {
      const pointer = String(await invoke(SeelenCommand.GetMousePosition));
      if (pointer !== this.#lastPointer) {
        this.#lastPointer = pointer;
        this.#lastActivity = now;
      }
    } catch {
      // Without a pointer reading, treat the person as present.
      this.#lastActivity = now;
    }

    const watching = this.#focus?.isFullscreened === true;
    const idle = now - this.#lastActivity > this.#idleMs && !watching;

    if (idle && !this.away) {
      // Count up to the last sign of life, not up to the moment it was noticed.
      this.#tally(Math.max(this.#since, this.#lastActivity));
      this.away = true;
      this.#since = now;
    } else if (!idle && this.away) {
      this.away = false;
      this.#since = now;
    } else {
      this.#tally(now);
    }
  }

  /** Adds the time since the last tally to whatever held the foreground. */
  #tally(until: number): void {
    const from = this.#since;
    this.#since = until;
    if (until <= from || this.away || !this.lease.held || !this.#focus) return;
    const who = identify(this.#focus);
    if (!who || this.#ignored.has(who.info.name.toLowerCase())) return;
    // A gap longer than a check interval and a half means the machine slept or
    // the replica stalled; none of that was screen time.
    if (until - from > CHECK_MS * 3 && !this.#focus.isFullscreened) return;

    this.data.apps[who.key] ??= who.info;
    let start = from;
    while (start < until) {
      const date = new Date(start);
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
      const end = Math.min(until, midnight);
      const day = toDateKey(date);
      const row = (this.data.days[day] ??= {});
      row[who.key] = (row[who.key] ?? 0) + (end - start) / 1000;
      start = end;
    }
    this.#dirty = true;
  }

  async #periodic(): Promise<void> {
    const held = this.lease.held;
    if (held && !this.#wasHolder) {
      // Just took over from another display: start from what it wrote.
      await this.#reload();
      this.#since = Date.now();
    }
    this.#wasHolder = held;
    if (held) {
      this.#tally(Date.now());
      await this.#persist();
    } else {
      await this.#reload();
    }
  }

  async #reload(): Promise<void> {
    const raw = await readJson<Partial<UsageFile> | null>(FILE, null);
    this.data = { version: 1, apps: raw?.apps ?? {}, days: raw?.days ?? {}, switches: raw?.switches ?? {} };
    this.loaded = true;
  }

  async #persist(): Promise<void> {
    if (!this.#dirty || !this.lease.held) return;
    this.#dirty = false;
    const cutoff = addDays(toDateKey(new Date()), -KEEP_DAYS);
    const snapshot = $state.snapshot(this.data) as UsageFile;
    for (const day of Object.keys(snapshot.days)) if (day < cutoff) delete snapshot.days[day];
    for (const day of Object.keys(snapshot.switches)) if (day < cutoff) delete snapshot.switches[day];
    try {
      await writeJson(FILE, snapshot);
    } catch (err) {
      this.#dirty = true;
      noteError(`usage: save ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const usage = new UsageStore();

/** `5 h 12 min`, `47 min`, `under a minute`. */
export function formatSpent(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return seconds > 0 ? '< 1 min' : '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
