/**
 * The Agenda module's calendar arithmetic and its quick-add reader.
 *
 * Pure, like `calc.ts`: dates in and dates out, no host and no state, so
 * `npm test` runs the shipped file. The store in `agenda.svelte.ts` keeps the
 * events; everything that decides *when* an event happens is here.
 *
 * Dates are local calendar days written `YYYY-MM-DD` rather than instants.
 * An all-day event on the 3rd is on the 3rd wherever the machine is, a weekly
 * event at 09:00 stays at 09:00 across a clock change, and both of those are
 * what a person means - an epoch millisecond means neither.
 */

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const REPEATS: readonly { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

export interface AgendaEvent {
  id: string;
  title: string;
  /** The first (or only) day, `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, or null for an all-day event. */
  time: string | null;
  /** Minutes; null for none. */
  duration: number | null;
  repeat: Repeat;
  /** Last day a repeat may fall on, inclusive. */
  until: string | null;
  /** A key into the panel's palette. */
  colour: string;
  /** Minutes before the start to ring; null for no reminder. */
  remind: number | null;
  note: string;
  updatedAt: number;
}

export interface Occurrence {
  event: AgendaEvent;
  /** The day this occurrence falls on. */
  date: string;
  /** Epoch ms of the start: local midnight for an all-day event. */
  start: number;
  end: number | null;
  allDay: boolean;
  /** Unique per event per day, for keyed lists and fired reminders. */
  key: string;
}

// --------------------------------------------------------------------- dates

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` key. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: string, days: number): string {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return toDateKey(fromDateKey(key)) === key;
}

export function isValidTime(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Days from `a` to `b`, counted in calendar days so a DST change is still one day. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1) - Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1)) / 86_400_000);
}

/** Whether a repeating event falls on `day`, ignoring its start and end bounds. */
function fallsOn(event: AgendaEvent, day: Date, first: Date): boolean {
  switch (event.repeat) {
    case 'none':
      return toDateKey(day) === event.date;
    case 'daily':
      return true;
    case 'weekdays':
      return day.getDay() !== 0 && day.getDay() !== 6;
    case 'weekly':
      return day.getDay() === first.getDay();
    case 'monthly': {
      // The 31st of a 30-day month lands on its last day rather than vanishing.
      const want = Math.min(first.getDate(), daysInMonth(day.getFullYear(), day.getMonth()));
      return day.getDate() === want;
    }
    case 'yearly': {
      if (day.getMonth() !== first.getMonth()) return false;
      const want = Math.min(first.getDate(), daysInMonth(day.getFullYear(), day.getMonth()));
      return day.getDate() === want;
    }
  }
}

function timeToMinutes(time: string | null): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Every occurrence from `from` to `to` inclusive, in start order, all-day
 * events first within a day.
 *
 * Walks the days rather than jumping by rule. The range a panel asks for is a
 * few weeks and the event list is short, so the walk is cheap, and it is the
 * one approach where "monthly on the 31st" and "yearly on 29 February" need no
 * special arithmetic at all.
 */
export function occurrencesBetween(events: readonly AgendaEvent[], from: string, to: string): Occurrence[] {
  const span = dayDiff(from, to);
  if (span < 0) return [];
  const out: Occurrence[] = [];

  for (const event of events) {
    if (!isValidDateKey(event.date)) continue;
    const first = fromDateKey(event.date);
    const startKey = event.date > from ? event.date : from;
    let endKey = to;
    if (event.until && event.until < endKey) endKey = event.until;
    if (event.repeat === 'none' && event.date < endKey) endKey = event.date;
    if (startKey > endKey) continue;

    const days = dayDiff(startKey, endKey);
    const cursor = fromDateKey(startKey);
    for (let i = 0; i <= days; i++) {
      if (fallsOn(event, cursor, first)) {
        const date = toDateKey(cursor);
        const allDay = event.time === null;
        const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, timeToMinutes(event.time)).getTime();
        const end = !allDay && event.duration ? start + event.duration * 60_000 : null;
        out.push({ event, date, start, end, allDay, key: `${event.id}@${date}` });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start - b.start || a.event.title.localeCompare(b.event.title);
  });
}

/** `Today`, `Tomorrow`, a weekday within the week, then a short date. */
export function dayLabel(key: string, today: string, locale?: string): string {
  const diff = dayDiff(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const date = fromDateKey(key);
  if (diff > 1 && diff < 7) return date.toLocaleDateString(locale, { weekday: 'long' });
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

export function formatTime(time: string, h24: boolean, locale?: string): string {
  const [h, m] = time.split(':').map(Number);
  const date = new Date(2000, 0, 1, h ?? 0, m ?? 0);
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: !h24 });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min`;
  return h ? `${h} h` : `${m} min`;
}

// ----------------------------------------------------------------- quick add

export interface QuickAdd {
  title: string;
  date: string;
  time: string | null;
  duration: number | null;
  repeat: Repeat;
  remind: number | null;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, sonntag: 0,
  mon: 1, monday: 1, montag: 1,
  tue: 2, tues: 2, tuesday: 2, dienstag: 2,
  wed: 3, wednesday: 3, mittwoch: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, donnerstag: 4,
  fri: 5, friday: 5, freitag: 5,
  sat: 6, saturday: 6, samstag: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, januar: 0,
  feb: 1, february: 1, februar: 1,
  mar: 2, march: 2, märz: 2, maerz: 2,
  apr: 3, april: 3,
  may: 4, mai: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, okt: 9, oktober: 9,
  nov: 10, november: 10,
  dec: 11, december: 11, dez: 11, dezember: 11,
};

const WEEKDAY_WORDS = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const MONTH_WORDS = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

function to24(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase() === 'pm';
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function unitMinutes(value: number, unit: string): number {
  return /^h/i.test(unit) || /^std/i.test(unit) ? Math.round(value * 60) : Math.round(value);
}

/** The next date (today included) that falls on `weekday`. */
function nextWeekday(today: Date, weekday: number, forceNext: boolean): Date {
  const date = new Date(today);
  let ahead = (weekday - date.getDay() + 7) % 7;
  if (forceNext && ahead === 0) ahead = 7;
  date.setDate(date.getDate() + ahead);
  return date;
}

export interface QuickAddOptions {
  /** Read `3/10` as March 10th rather than 3 October. */
  monthFirst?: boolean;
}

/**
 * Reads a line like `Dentist tomorrow 14:30 for 1h remind 15m` into an event.
 *
 * Each recognised phrase is cut out of the text as it is read, and whatever is
 * left is the title - so the order of the parts does not matter and a title
 * containing none of them survives untouched. Returns null when nothing is
 * left to call the event.
 */
export function parseQuickAdd(text: string, now: Date, options: QuickAddOptions = {}): QuickAdd | null {
  let rest = ` ${text.trim()} `;
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
    return m;
  };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date: Date | null = null;
  let time: string | null = null;
  let duration: number | null = null;
  let repeat: Repeat = 'none';
  let remind: number | null = null;
  let dateExplicit = false;

  // --- repeats ------------------------------------------------------------
  let m: RegExpExecArray | null;
  if ((m = take(new RegExp(`\\s(?:every|each|jeden|jede)\\s+(${WEEKDAY_WORDS})\\b`, 'i')))) {
    repeat = 'weekly';
    date = nextWeekday(today, WEEKDAYS[(m[1] as string).toLowerCase()] as number, false);
    dateExplicit = true;
  } else if (take(/\s(?:every\s+weekday|weekdays|werktags)\b/i)) repeat = 'weekdays';
  else if (take(/\s(?:every\s+day|each\s+day|daily|täglich)\b/i)) repeat = 'daily';
  else if (take(/\s(?:every\s+week|weekly|wöchentlich)\b/i)) repeat = 'weekly';
  else if (take(/\s(?:every\s+month|monthly|monatlich)\b/i)) repeat = 'monthly';
  else if (take(/\s(?:every\s+year|yearly|annually|jährlich)\b/i)) repeat = 'yearly';

  // --- reminder -----------------------------------------------------------
  if ((m = take(/\sremind(?:\s+me)?\s+(\d+)\s*(h|hrs?|hours?|m|mins?|minutes?)(?:\s+before)?\b/i))) {
    remind = unitMinutes(Number(m[1]), m[2] as string);
  }

  // --- duration -----------------------------------------------------------
  if ((m = take(/\sfor\s+(\d+)\s*h\s*(\d+)\s*m(?:in)?s?\b/i))) {
    duration = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = take(/\sfor\s+(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i))) {
    duration = unitMinutes(Number(m[1]), m[2] as string);
  }

  // --- time ---------------------------------------------------------------
  // A range needs a colon or am/pm on at least one side, or `3-4` would be read
  // as a time rather than left alone.
  const range = /\s(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|bis)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?=\s)/i.exec(rest);
  if (range && (range[2] || range[3] || range[5] || range[6])) {
    take(new RegExp(range[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const endMeridiem = range[6];
    const startMeridiem = range[3] ?? (endMeridiem && Number(range[1]) <= Number(range[4]) ? endMeridiem : undefined);
    const sh = to24(Number(range[1]), startMeridiem);
    const sm = Number(range[2] ?? 0);
    const eh = to24(Number(range[4]), endMeridiem);
    const em = Number(range[5] ?? 0);
    if (sh < 24 && sm < 60 && eh < 24 && em < 60) {
      time = `${pad(sh)}:${pad(sm)}`;
      let span = eh * 60 + em - (sh * 60 + sm);
      if (span <= 0) span += 24 * 60;
      duration ??= span;
    }
  }
  if (!time && (m = take(/\s(?:at\s+|um\s+|@\s*)?(\d{1,2})[:.](\d{2})\s*(am|pm|uhr)?(?=\s)/i))) {
    const h = to24(Number(m[1]), m[3]?.toLowerCase() === 'uhr' ? undefined : m[3]);
    if (h < 24 && Number(m[2]) < 60) time = `${pad(h)}:${m[2]}`;
  }
  if (!time && (m = take(/\s(?:at\s+|um\s+|@\s*)?(\d{1,2})\s*(am|pm)(?=\s)/i))) {
    const h = to24(Number(m[1]), m[2]);
    if (h < 24) time = `${pad(h)}:00`;
  }
  if (!time && (m = take(/\s(?:um\s+)?(\d{1,2})\s*uhr(?=\s)/i))) {
    if (Number(m[1]) < 24) time = `${pad(Number(m[1]))}:00`;
  }
  if (!time && (m = take(/\s(?:at|um|@)\s*(\d{1,2})(?=\s)/i))) {
    if (Number(m[1]) < 24) time = `${pad(Number(m[1]))}:00`;
  }
  if (!time && take(/\s(?:at\s+)?(?:noon|midday|mittags)\b/i)) time = '12:00';
  if (!time && take(/\s(?:at\s+)?midnight\b/i)) time = '00:00';

  // --- date ---------------------------------------------------------------
  const offsetDays = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d;
  };

  if (!date && (m = take(/\s(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() === Number(m[2]) - 1) date = d;
    dateExplicit = true;
  }
  if (!date && take(/\s(?:the\s+)?day\s+after\s+tomorrow\b|\sübermorgen\b/i)) date = offsetDays(2);
  if (!date && take(/\s(?:tomorrow|tmrw|tmr|morgen)\b/i)) date = offsetDays(1);
  if (!date && take(/\s(?:today|tonight|heute)\b/i)) date = today;
  if (!date && (m = take(/\sin\s+(\d+)\s*(days?|d|weeks?|w|months?|tagen?|wochen?)\b/i))) {
    const n = Number(m[1]);
    const unit = (m[2] as string).toLowerCase();
    if (unit.startsWith('w')) date = offsetDays(n * 7);
    else if (unit.startsWith('m')) date = new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
    else date = offsetDays(n);
  }
  if (!date && take(/\snext\s+week\b|\snächste\s+woche\b/i)) date = offsetDays(7);
  if (!date && take(/\snext\s+month\b|\snächsten\s+monat\b/i)) date = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (!date && (m = take(new RegExp(`\\s(?:on\\s+|am\\s+)?(next\\s+)?(${WEEKDAY_WORDS})\\b`, 'i')))) {
    date = nextWeekday(today, WEEKDAYS[(m[2] as string).toLowerCase()] as number, !!m[1]);
    dateExplicit = true;
  }
  if (!date && (m = take(new RegExp(`\\s(?:on\\s+|the\\s+)?(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(?:of\\s+)?(${MONTH_WORDS})\\.?(?:\\s+(\\d{4}))?\\b`, 'i')))) {
    date = new Date(Number(m[3] ?? today.getFullYear()), MONTHS[(m[2] as string).toLowerCase()] as number, Number(m[1]));
    dateExplicit = !m[3];
  }
  if (!date && (m = take(new RegExp(`\\s(?:on\\s+)?(${MONTH_WORDS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i')))) {
    date = new Date(Number(m[3] ?? today.getFullYear()), MONTHS[(m[1] as string).toLowerCase()] as number, Number(m[2]));
    dateExplicit = !m[3];
  }
  if (!date && (m = take(/\s(\d{1,2})([./])(\d{1,2})(?:\2(\d{2,4})?)?(?=\s)/))) {
    let day = Number(m[1]);
    let month = Number(m[3]);
    if (m[2] === '/' && options.monthFirst) [day, month] = [month, day];
    let year = m[4] ? Number(m[4]) : today.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month - 1)) {
      date = new Date(year, month - 1, day);
      dateExplicit = !m[4];
    }
  }

  // A date given without a year that has already gone means next year's.
  if (date && dateExplicit && date < today && repeat === 'none') {
    date = new Date(date.getFullYear() + 1, date.getMonth(), date.getDate());
  }

  // Only a time: the next time the clock reads it.
  if (!date) {
    date = today;
    if (time && repeat === 'none') {
      const [h, min] = time.split(':').map(Number);
      const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, min);
      if (at.getTime() <= now.getTime()) date = offsetDays(1);
    }
  }

  const title = rest
    .replace(/\s(?:at|on|from|by|um|am|@)\s*$/i, ' ')
    .replace(/^\s*(?:at|on|from|by|um|am|-|–|:)\s/i, ' ')
    .replace(/\s+[-–:,]\s*$/, ' ')
    .replace(/^\s*[-–:,]\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return null;

  return { title, date: toDateKey(date), time, duration, repeat, remind };
}
