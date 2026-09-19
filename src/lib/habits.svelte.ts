import { newId } from './ids';
import { SyncedFile, type SyncedItem } from './synced.svelte';
import type { UnSubscriber } from './seelen';

/**
 * Habits and the days they were done, shared by every display.
 *
 * A tick is its own item - `habitId@date` - rather than a day added to a list
 * on the habit, so ticking Monday on one display and Tuesday on the other are
 * two separate items and both survive the merge. Unticking is a removal, which
 * the merge honours only over a tick made before it.
 */

export interface Habit extends SyncedItem {
  name: string;
  colour: string;
  /** 7 for daily; fewer for "n times a week". */
  perWeek: number;
  order: number;
  createdAt: number;
}

export interface HabitCheck extends SyncedItem {
  habitId: string;
  date: string;
}

export const HABIT_COLOURS: Readonly<Record<string, string>> = {
  green: '#4fbf7a',
  blue: '#5b9cf5',
  purple: '#a37cf0',
  amber: '#e8a33d',
  red: '#e5635b',
  teal: '#3fb8b0',
  pink: '#e56fae',
};

type HabitCollections = { habits: Habit[]; checks: HabitCheck[] };

class HabitsStore {
  file = new SyncedFile<HabitCollections>('habits.json', () => ({ habits: [], checks: [] }));

  /** Every tick, for constant-time lookups while a grid is drawn. */
  done = $derived(new Set(this.file.data.checks.map((check) => check.id)));

  acquire(): UnSubscriber {
    return this.file.acquire();
  }

  get habits(): Habit[] {
    return this.file.data.habits.slice().sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  isDone(habitId: string, date: string): boolean {
    return this.done.has(`${habitId}@${date}`);
  }

  add(name: string, perWeek = 7): void {
    const colours = Object.keys(HABIT_COLOURS);
    const count = this.file.data.habits.length;
    const now = Date.now();
    this.file.put('habits', {
      id: newId('habit'),
      name: name.trim(),
      colour: colours[count % colours.length] as string,
      perWeek: Math.min(7, Math.max(1, Math.round(perWeek))),
      order: Math.max(0, ...this.file.data.habits.map((h) => h.order)) + 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  update(id: string, patch: Partial<Omit<Habit, 'id'>>): void {
    this.file.update('habits', id, patch);
  }

  move(id: string, direction: -1 | 1): void {
    const list = this.habits;
    const at = list.findIndex((h) => h.id === id);
    const self = list[at];
    const other = list[at + direction];
    if (!self || !other) return;
    this.file.update('habits', self.id, { order: other.order });
    this.file.update('habits', other.id, { order: self.order });
  }

  remove(id: string): void {
    const ticks = this.file.data.checks.filter((c) => c.habitId === id).map((c) => c.id);
    if (ticks.length) this.file.remove('checks', ...ticks);
    this.file.remove('habits', id);
  }

  toggle(habitId: string, date: string): void {
    const id = `${habitId}@${date}`;
    if (this.done.has(id)) this.file.remove('checks', id);
    else this.file.put('checks', { id, habitId, date, updatedAt: Date.now() });
  }
}

export const habits = new HabitsStore();
