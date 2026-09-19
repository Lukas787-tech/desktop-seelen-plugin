import { addDays, occurrencesBetween, toDateKey, type AgendaEvent, type Occurrence, type QuickAdd } from './agenda';
import { newId } from './ids';
import { Lease } from './lease.svelte';
import { chime } from './sound';
import { SyncedFile, type SyncedItem } from './synced.svelte';
import type { UnSubscriber } from './seelen';

/**
 * The Agenda's events, shared by every display, and the reminders they ring.
 *
 * The date arithmetic is in `agenda.ts`; this holds the file, decides what is
 * due, and remembers which occurrences have already rung - in the file, so a
 * reload does not ring the same reminder twice and the other display knows.
 */

export const AGENDA_COLOURS: Readonly<Record<string, string>> = {
  blue: '#5b9cf5',
  green: '#4fbf7a',
  amber: '#e8a33d',
  red: '#e5635b',
  purple: '#a37cf0',
  teal: '#3fb8b0',
  pink: '#e56fae',
  grey: '#8f96a3',
};

export function colourOf(event: AgendaEvent): string {
  return AGENDA_COLOURS[event.colour] ?? (AGENDA_COLOURS.blue as string);
}

/** An occurrence that has rung, keyed `eventId@date`. */
type Fired = SyncedItem;

type AgendaCollections = { events: AgendaEvent[]; fired: Fired[] };

/** A reminder whose moment passed while nothing ran still rings, within this. */
const LATE_MS = 6 * 3600_000;

class AgendaStore {
  file = new SyncedFile<AgendaCollections>('agenda.json', () => ({ events: [], fired: [] }));
  lease = new Lease('agenda');

  /** Reminders that have come due and not been dismissed. */
  ringing = $state<Occurrence[]>([]);
  /** Bumped to re-run the planner when its sleep ends. */
  tick = $state(0);

  #users = 0;
  #releases: UnSubscriber[] = [];

  get events(): AgendaEvent[] {
    return this.file.data.events;
  }

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) this.#releases.push(this.file.acquire(), this.lease.acquire());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users === 0) for (const release of this.#releases.splice(0)) release();
    };
  }

  between(from: string, to: string): Occurrence[] {
    return occurrencesBetween(this.file.data.events, from, to);
  }

  add(quick: QuickAdd, remind: number | null, colour = 'blue'): AgendaEvent {
    const event: AgendaEvent = {
      id: newId('event'),
      title: quick.title,
      date: quick.date,
      time: quick.time,
      duration: quick.duration,
      repeat: quick.repeat,
      until: null,
      colour,
      remind,
      note: '',
      updatedAt: Date.now(),
    };
    this.file.put('events', event);
    return event;
  }

  save(event: AgendaEvent): void {
    this.file.put('events', event);
  }

  duplicate(event: AgendaEvent): void {
    this.file.put('events', { ...event, id: newId('event'), title: `${event.title} (copy)` });
  }

  remove(id: string): void {
    this.file.remove('events', id);
    this.ringing = this.ringing.filter((o) => o.event.id !== id);
  }

  dismiss(key: string): void {
    this.ringing = this.ringing.filter((o) => o.key !== key);
  }

  /**
   * Rings whatever is due and sleeps until the next reminder is.
   *
   * Written for `$effect`, like `alarms.plan`: it reads the events and the rung
   * list, so an edit on either display re-plans, and it returns the cleanup
   * that cancels its sleep.
   */
  plan(active: boolean): () => void {
    void this.tick;
    const events = this.file.data.events.filter((e) => e.remind !== null).map((e) => ({ ...e }));
    const fired = new Set(this.file.data.fired.map((f) => f.id));
    if (!active || !this.file.loaded) return () => {};

    const now = Date.now();
    const today = toDateKey(new Date(now));
    const due: Occurrence[] = [];
    let soonest = Number.POSITIVE_INFINITY;

    for (const occurrence of occurrencesBetween(events, addDays(today, -1), addDays(today, 2))) {
      if (fired.has(occurrence.key)) continue;
      const at = occurrence.start - (occurrence.event.remind ?? 0) * 60_000;
      if (at > now) soonest = Math.min(soonest, at);
      else if (now - at < LATE_MS && (occurrence.end ?? occurrence.start) > now - 3600_000) due.push(occurrence);
    }

    const fire = due.length ? setTimeout(() => this.#ring(due, today), 0) : undefined;
    const sleep = setTimeout(() => this.tick++, Math.max(500, Math.min(soonest - now, 60_000) + 30));
    return () => {
      clearTimeout(fire);
      clearTimeout(sleep);
    };
  }

  #ring(due: Occurrence[], today: string): void {
    const now = Date.now();
    for (const occurrence of due) {
      this.file.put('fired', { id: occurrence.key, updatedAt: now });
      if (!this.ringing.some((o) => o.key === occurrence.key)) this.ringing = [...this.ringing, occurrence];
    }
    chime('done', 0.6);

    // What rang more than a few days ago is only noise in the file now.
    const cutoff = addDays(today, -3);
    const stale = this.file.data.fired.filter((f) => (f.id.split('@')[1] ?? '') < cutoff).map((f) => f.id);
    if (stale.length) this.file.remove('fired', ...stale);
  }
}

export const agenda = new AgendaStore();
