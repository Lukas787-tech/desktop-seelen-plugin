/**
 * The Alarms module's clock arithmetic, kept pure so `npm test` can run it.
 */

/**
 * Reads what a person types into a timer box: `90s`, `10m`, `1h20m`, `1:30`,
 * `1:02:03`, or a bare `10` (minutes). Whatever words are left over become the
 * timer's name, so `tea 4m` is a four-minute timer called "tea".
 */
export function parseDuration(text: string): { ms: number; label: string } | null {
  let rest = ` ${text.trim()} `;
  let ms = 0;
  let matched = false;

  const clock = /\s(\d{1,3}):(\d{2})(?::(\d{2}))?(?=\s)/.exec(rest);
  if (clock) {
    matched = true;
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] === undefined ? null : Number(clock[3])];
    // `m:ss`, or `h:mm:ss` when there are three parts.
    ms = c === null ? (a * 60 + b) * 1000 : (a * 3600 + b * 60 + c) * 1000;
    rest = rest.replace(clock[0], ' ');
  }

  const units = /(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?=[\s\d]|$)/gi;
  for (const m of rest.matchAll(units)) {
    matched = true;
    const value = Number((m[1] as string).replace(',', '.'));
    const unit = (m[2] as string).toLowerCase();
    ms += value * (unit.startsWith('h') ? 3_600_000 : unit.startsWith('m') ? 60_000 : 1000);
  }
  rest = rest.replace(units, ' ');

  if (!matched) {
    const bare = /\s(\d+(?:[.,]\d+)?)(?=\s)/.exec(rest);
    if (bare) {
      ms = Number((bare[1] as string).replace(',', '.')) * 60_000;
      rest = rest.replace(bare[0], ' ');
      matched = true;
    }
  }

  ms = Math.round(ms);
  if (!matched || ms <= 0 || ms > 100 * 3_600_000) return null;
  return { ms, label: rest.replace(/\s+/g, ' ').trim() };
}

const two = (n: number) => String(n).padStart(2, '0');

/** A countdown: `4:05`, or `1:04:05` past an hour. Rounds up, so it never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** A stopwatch: `1:05.42`, or `1:01:05.4` past an hour. */
export function formatStopwatch(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const cs = Math.floor((safe % 1000) / 10);
  return h ? `${h}:${two(m)}:${two(s)}.${Math.floor(cs / 10)}` : `${m}:${two(s)}.${two(cs)}`;
}

/**
 * The first moment after `after` that an alarm set for `time` on `days` rings.
 *
 * `days` are JavaScript weekday numbers (0 is Sunday); empty means "once", which
 * rings at the next `time` whatever the day. Built from local date parts each
 * time, so an alarm at 07:00 stays at 07:00 across a clock change.
 */
export function nextRing(time: string, days: readonly number[], after: number): number {
  const [h, m] = time.split(':').map(Number);
  const start = new Date(after);
  for (let d = 0; d <= 7; d++) {
    const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, h ?? 0, m ?? 0, 0, 0);
    if (at.getTime() <= after) continue;
    if (days.length === 0 || days.includes(at.getDay())) return at.getTime();
  }
  return Number.POSITIVE_INFINITY;
}

/** `Every day`, `Weekdays`, `Weekends`, `Once`, or the days themselves. */
export function describeDays(days: readonly number[], locale?: string): string {
  const set = new Set(days);
  if (set.size === 0) return 'Once';
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  // Monday first, which is how a week is read in most of the world.
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => set.has(d))
    .map((d) => new Date(2024, 0, 7 + d).toLocaleDateString(locale, { weekday: 'short' }))
    .join(', ');
}

/** `in 7 h 12 min`, `in 3 min`, `in under a minute`. */
export function describeWait(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (h >= 24) return `in ${Math.round(h / 24)} d`;
  return rest ? `in ${h} h ${rest} min` : `in ${h} h`;
}
