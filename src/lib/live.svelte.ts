import { noteError } from './diagnostics';
import type { UnSubscriber } from './seelen';

/**
 * A host value that is read once and then kept live by one change event.
 *
 * Most of what the newer modules show is exactly that shape - notifications,
 * clipboard history, bluetooth devices, batteries - so it is worth one helper
 * rather than a dozen near-identical stores.
 *
 * Subscriptions are **reference counted and lazy**: a module that the user has
 * not enabled costs nothing, because its panel is never rendered and so never
 * acquires the value. That matters here more than usual - every one of these
 * would otherwise be held once per display replica for a panel nobody asked
 * for.
 *
 * `acquire()` returns its release function synchronously, which is what lets a
 * component hold one for exactly as long as it is mounted:
 *
 * ```svelte
 * $effect(() => notifications.acquire());
 * ```
 */
export interface HostValue<T> {
  /** The last value the host reported. */
  readonly current: T;
  /** Starts (or joins) the subscription; call the result to release it. */
  acquire(): UnSubscriber;
}

export interface HostValueOptions<T> {
  /** Used in error messages, e.g. `bluetooth`. */
  label: string;
  /** Shown until the host answers, and after the last release. */
  initial: T;
  load: () => Promise<T>;
  listen: (apply: (value: T) => void) => Promise<UnSubscriber>;
}

export function hostValue<T>(options: HostValueOptions<T>): HostValue<T> {
  let current = $state(options.initial);
  let users = 0;
  /**
   * Bumped on every start and stop. Subscribing is async, so without this a
   * value released while its `load` was still in flight would apply its result
   * - or leak its listener - after nobody was watching any more.
   */
  let generation = 0;
  let off: UnSubscriber | null = null;

  function fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${options.label}] host value unavailable`, err);
    noteError(`${options.label}: ${message}`);
  }

  async function load(mine: number): Promise<void> {
    try {
      const value = await options.load();
      if (mine === generation) current = value;
    } catch (err) {
      fail(err);
    }
  }

  async function start(mine: number): Promise<void> {
    await load(mine);
    try {
      const handle = await options.listen((value) => {
        if (mine === generation) current = value;
      });
      if (mine === generation) off = handle;
      else handle();
    } catch (err) {
      fail(err);
    }
  }

  return {
    get current() {
      return current;
    },

    acquire(): UnSubscriber {
      users++;
      if (users === 1) void start(++generation);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        users--;
        if (users > 0) return;
        generation++;
        off?.();
        off = null;
        current = options.initial;
      };
    },
  };
}

/**
 * Fire-and-forget host command, with the failure recorded rather than thrown.
 *
 * `onError` is for the commands a person watches for a result. Most are not:
 * a failed volume change is corrected by the next event the host sends. But
 * where nothing on screen would change either way - emptying the recycle bin
 * is the case that prompted this - the panel has to say so itself, or the
 * failure is only ever visible in a diagnostics file nobody opens.
 */
export function tell(
  label: string,
  action: Promise<unknown>,
  onError?: (message: string) => void,
): void {
  void action.catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${label}] command failed`, err);
    noteError(`${label}: ${message}`);
    onError?.(message);
  });
}

/**
 * A sender that keeps only the newest command per target, one in flight at a
 * time.
 *
 * A slider fires `input` for every step it moves, and each of those used to be
 * its own host command. For volume that was a queue of stale levels replaying
 * after the thumb had stopped; for brightness it was worse, because a monitor
 * answers DDC/CI in tens of milliseconds and the backlog could run for seconds
 * - the panel stuttered and the thumb jumped back as the echoes of old levels
 * arrived. Now a drag sends the level it started at, then whatever the thumb
 * reads when that one lands, and so on: always current, never queued.
 *
 * ```ts
 * const send = coalesced('media');
 * send(deviceId, () => invoke(SetVolumeLevel, { ... }));
 * ```
 */
export function coalesced(label: string): (key: string, send: () => Promise<unknown>) => void {
  const busy = new Set<string>();
  const waiting = new Map<string, () => Promise<unknown>>();

  function pump(key: string): void {
    const send = waiting.get(key);
    if (!send) {
      busy.delete(key);
      return;
    }
    waiting.delete(key);
    busy.add(key);
    let action: Promise<unknown>;
    try {
      action = send();
    } catch (err) {
      action = Promise.reject(err);
    }
    void action
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${label}] command failed`, err);
        noteError(`${label}: ${message}`);
      })
      .finally(() => pump(key));
  }

  return (key, send) => {
    waiting.set(key, send);
    if (!busy.has(key)) pump(key);
  };
}
