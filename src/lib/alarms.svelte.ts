import { newId } from './ids';
import { Lease } from './lease.svelte';
import { nextRing } from './alarmtime';
import { ring } from './sound';
import { SyncedFile, type SyncedItem } from './synced.svelte';
import type { UnSubscriber } from './seelen';

/**
 * Timers, alarms and a stopwatch.
 *
 * Timers and alarms live in `alarms.json`, merged between displays, so one set
 * on the left display is running on the right one too - and its deadline is a
 * wall-clock time rather than a count, so a reload or a sleep never loses time.
 * Only the display holding the `alarms` lease rings (see `lease.svelte.ts`).
 *
 * The stopwatch is this display's own and is kept in memory: it survives the
 * panel being hidden and shown, not a restart, which is what a stopwatch is for.
 */

export interface Countdown extends SyncedItem {
  label: string;
  /** The length it was set to, in ms. */
  duration: number;
  /** When it ends, while running; null while paused or finished. */
  endsAt: number | null;
  /** What is left, while paused. */
  remaining: number;
  done: boolean;
  createdAt: number;
}

export interface Alarm extends SyncedItem {
  label: string;
  /** `HH:MM`, local. */
  time: string;
  /** JavaScript weekdays; empty rings once. */
  days: number[];
  enabled: boolean;
  /** When a snoozed alarm rings again. */
  snoozeUntil: number | null;
  /** The occurrence it last rang for, so it never rings twice for one. */
  lastRang: number;
  createdAt: number;
}

export interface Ringing {
  key: string;
  kind: 'timer' | 'alarm';
  id: string;
  label: string;
  since: number;
}

type AlarmCollections = { timers: Countdown[]; alarms: Alarm[] };

/** An alarm whose minute passed while nothing was running still rings, briefly. */
const GRACE_MS = 2 * 60_000;

class AlarmsStore {
  file = new SyncedFile<AlarmCollections>('alarms.json', () => ({ timers: [], alarms: [] }));
  lease = new Lease('alarms');

  ringing = $state<Ringing[]>([]);
  stopwatch = $state({ running: false, startedAt: 0, elapsed: 0, laps: [] as number[] });
  /** Bumped to re-run the planner when its sleep ends. */
  tick = $state(0);

  #users = 0;
  #releases: UnSubscriber[] = [];
  #stopSound: (() => void) | null = null;

  get timers(): Countdown[] {
    return this.file.data.timers;
  }

  get alarms(): Alarm[] {
    return this.file.data.alarms;
  }

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) this.#releases.push(this.file.acquire(), this.lease.acquire());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      for (const release of this.#releases.splice(0)) release();
      this.#silence();
    };
  }

  // --- timers ---------------------------------------------------------------

  addTimer(ms: number, label: string): void {
    const now = Date.now();
    this.file.put('timers', {
      id: newId('timer'),
      label: label.trim(),
      duration: ms,
      endsAt: now + ms,
      remaining: ms,
      done: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  remaining(timer: Countdown, now: number): number {
    if (timer.done) return 0;
    return timer.endsAt === null ? timer.remaining : Math.max(0, timer.endsAt - now);
  }

  pause(timer: Countdown): void {
    if (timer.endsAt === null) return;
    this.file.update('timers', timer.id, { endsAt: null, remaining: Math.max(0, timer.endsAt - Date.now()) });
  }

  resume(timer: Countdown): void {
    if (timer.endsAt !== null || timer.done) return;
    this.file.update('timers', timer.id, { endsAt: Date.now() + timer.remaining });
  }

  reset(timer: Countdown): void {
    this.file.update('timers', timer.id, { endsAt: null, remaining: timer.duration, done: false });
    this.dismiss(`timer:${timer.id}`);
  }

  restart(timer: Countdown): void {
    this.file.update('timers', timer.id, { endsAt: Date.now() + timer.duration, remaining: timer.duration, done: false });
    this.dismiss(`timer:${timer.id}`);
  }

  /** One more minute: on a running timer, and on one that just finished. */
  extend(timer: Countdown, ms = 60_000): void {
    const now = Date.now();
    if (timer.done || timer.endsAt === null) {
      const base = timer.done ? 0 : timer.remaining;
      this.file.update('timers', timer.id, { endsAt: now + base + ms, remaining: base + ms, done: false });
    } else {
      this.file.update('timers', timer.id, { endsAt: timer.endsAt + ms });
    }
    this.dismiss(`timer:${timer.id}`);
  }

  removeTimer(id: string): void {
    this.file.remove('timers', id);
    this.dismiss(`timer:${id}`);
  }

  // --- alarms ---------------------------------------------------------------

  addAlarm(time: string, days: number[], label: string): void {
    const now = Date.now();
    this.file.put('alarms', {
      id: newId('alarm'),
      label: label.trim(),
      time,
      days: [...new Set(days)].sort(),
      enabled: true,
      snoozeUntil: null,
      // Never ring for a minute that was already under way when it was set.
      lastRang: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  setEnabled(alarm: Alarm, enabled: boolean): void {
    this.file.update('alarms', alarm.id, {
      enabled,
      snoozeUntil: null,
      lastRang: enabled ? Math.max(alarm.lastRang, Date.now()) : alarm.lastRang,
    });
    if (!enabled) this.dismiss(`alarm:${alarm.id}`);
  }

  removeAlarm(id: string): void {
    this.file.remove('alarms', id);
    this.dismiss(`alarm:${id}`);
  }

  /** When an enabled alarm next rings, measured from `now`. */
  nextFor(alarm: Alarm, now: number, grace = 0): number | null {
    if (!alarm.enabled) return null;
    if (alarm.snoozeUntil && alarm.snoozeUntil > alarm.lastRang) return alarm.snoozeUntil;
    return nextRing(alarm.time, alarm.days, Math.max(alarm.lastRang, now - grace));
  }

  snooze(entry: Ringing, minutes = 5): void {
    if (entry.kind === 'alarm') {
      const alarm = this.alarms.find((a) => a.id === entry.id);
      if (alarm) this.file.update('alarms', alarm.id, { enabled: true, snoozeUntil: Date.now() + minutes * 60_000 });
    } else {
      const timer = this.timers.find((t) => t.id === entry.id);
      if (timer) this.extend(timer, minutes * 60_000);
    }
    this.dismiss(entry.key);
  }

  dismiss(key: string): void {
    if (!this.ringing.some((r) => r.key === key)) return;
    this.ringing = this.ringing.filter((r) => r.key !== key);
    if (!this.ringing.length) this.#silence();
  }

  dismissAll(): void {
    this.ringing = [];
    this.#silence();
  }

  // --- stopwatch ------------------------------------------------------------

  stopwatchElapsed(now: number): number {
    const sw = this.stopwatch;
    return sw.elapsed + (sw.running ? now - sw.startedAt : 0);
  }

  toggleStopwatch(): void {
    const now = performance.now();
    if (this.stopwatch.running) {
      this.stopwatch.elapsed += now - this.stopwatch.startedAt;
      this.stopwatch.running = false;
    } else {
      this.stopwatch.startedAt = now;
      this.stopwatch.running = true;
    }
  }

  lap(): void {
    if (!this.stopwatch.running) return;
    this.stopwatch.laps.unshift(this.stopwatchElapsed(performance.now()));
  }

  resetStopwatch(): void {
    this.stopwatch = { running: false, startedAt: 0, elapsed: 0, laps: [] };
  }

  // --- ringing --------------------------------------------------------------

  /**
   * Looks for anything due and sleeps until the next thing is.
   *
   * Written for `$effect`: it reads the timers and alarms, so an edit on either
   * display re-plans, and returns the cleanup that cancels its sleep. The sleep
   * is capped at a minute so a machine that slept through a deadline notices
   * within one when it wakes.
   */
  plan(active: boolean, rings: number, volume: number): () => void {
    void this.tick;
    const timers = this.file.data.timers.map((t) => ({ ...t }));
    const alarms = this.file.data.alarms.map((a) => ({ ...a }));
    if (!active || !this.file.loaded) return () => {};

    const now = Date.now();
    const due: Array<() => void> = [];
    let soonest = Number.POSITIVE_INFINITY;

    for (const timer of timers) {
      if (timer.done || timer.endsAt === null) continue;
      if (timer.endsAt <= now) due.push(() => this.#finishTimer(timer));
      else soonest = Math.min(soonest, timer.endsAt);
    }
    for (const alarm of alarms) {
      const at = this.nextFor(alarm, now, GRACE_MS);
      if (at === null) continue;
      if (at <= now) due.push(() => this.#ringAlarm(alarm, at));
      else soonest = Math.min(soonest, at);
    }

    // Changing the lists from inside the effect that reads them would re-enter
    // it; ringing a moment later is indistinguishable.
    const fire = due.length
      ? setTimeout(() => {
          for (const run of due) run();
          if (!this.#stopSound && this.ringing.length) this.#stopSound = ring('alarm', rings, volume / 100);
        }, 0)
      : undefined;
    const wait = Math.max(250, Math.min(soonest - now, 60_000) + 30);
    const sleep = setTimeout(() => this.tick++, wait);
    return () => {
      clearTimeout(fire);
      clearTimeout(sleep);
    };
  }

  #finishTimer(timer: Countdown): void {
    this.file.update('timers', timer.id, { done: true, endsAt: null, remaining: 0 });
    this.#push({ key: `timer:${timer.id}`, kind: 'timer', id: timer.id, label: timer.label || 'Timer', since: Date.now() });
  }

  #ringAlarm(alarm: Alarm, at: number): void {
    this.file.update('alarms', alarm.id, {
      lastRang: Math.max(at, Date.now()),
      snoozeUntil: null,
      // A one-off alarm has done its job.
      enabled: alarm.days.length > 0,
    });
    this.#push({ key: `alarm:${alarm.id}`, kind: 'alarm', id: alarm.id, label: alarm.label || `Alarm ${alarm.time}`, since: Date.now() });
  }

  #push(entry: Ringing): void {
    this.ringing = [...this.ringing.filter((r) => r.key !== entry.key), entry];
  }

  #silence(): void {
    this.#stopSound?.();
    this.#stopSound = null;
  }
}

export const alarms = new AlarmsStore();
