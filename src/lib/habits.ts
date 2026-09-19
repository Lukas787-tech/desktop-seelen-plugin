/**
 * Streaks and completion for the Habits module. Pure, for `npm test`; dates are
 * `YYYY-MM-DD` keys from `agenda.ts`, so a streak is counted in calendar days
 * and a clock change is never a missed day.
 */
import { addDays, fromDateKey } from './agenda';

export type DoneOn = (date: string) => boolean;

/**
 * Consecutive days done, counting back from today.
 *
 * A day that has not been ticked *yet* does not break anything: until today is
 * over, the streak is the one that ran up to yesterday.
 */
export function dailyStreak(done: DoneOn, today: string, limit = 3660): number {
  let day = done(today) ? today : addDays(today, -1);
  let count = 0;
  while (count < limit && done(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

/** The first day of the week `date` is in. */
export function weekStart(date: string, mondayFirst: boolean): string {
  const weekday = fromDateKey(date).getDay();
  const back = mondayFirst ? (weekday + 6) % 7 : weekday;
  return addDays(date, -back);
}

/** How many of the seven days from `start` are done. */
export function doneInWeek(done: DoneOn, start: string): number {
  let count = 0;
  for (let i = 0; i < 7; i++) if (done(addDays(start, i))) count++;
  return count;
}

/**
 * Consecutive weeks that met `perWeek`, counting back from this week - which,
 * like today in the daily streak, counts once it is met and is otherwise
 * still in play.
 */
export function weeklyStreak(done: DoneOn, today: string, perWeek: number, mondayFirst: boolean, limit = 520): number {
  let start = weekStart(today, mondayFirst);
  if (doneInWeek(done, start) < perWeek) start = addDays(start, -7);
  let count = 0;
  while (count < limit && doneInWeek(done, start) >= perWeek) {
    count++;
    start = addDays(start, -7);
  }
  return count;
}

/** The share of the last `days` days (today included) that were done. */
export function completion(done: DoneOn, today: string, days: number): number {
  if (days <= 0) return 0;
  let count = 0;
  for (let i = 0; i < days; i++) if (done(addDays(today, -i))) count++;
  return count / days;
}

/**
 * Reads a habit typed with its target, e.g. `Gym 3x/week` or `Read 5 per week`.
 * No target means every day.
 */
export function parseHabit(text: string): { name: string; perWeek: number } | null {
  const match = /\s*(\d)\s*(?:x|times)?\s*(?:\/|per|a|each)\s*w(?:ee)?k\b/i.exec(text);
  const perWeek = match ? Math.min(7, Math.max(1, Number(match[1]))) : 7;
  const name = (match ? text.replace(match[0], ' ') : text).replace(/\s+/g, ' ').trim();
  return name ? { name, perWeek } : null;
}
