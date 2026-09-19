/**
 * The newer modules' pure parts: the calculator's parser and unit tables, and
 * the agenda's repeat expansion and quick-add reader.
 *
 * Run with `npm test`, which bundles each module with esbuild first so this
 * exercises the shipped TypeScript.
 */
import { evaluate, formatNumber, formatResult } from '../../.test/calc.mjs';
import { occurrencesBetween, parseQuickAdd, dayLabel, addDays, dayDiff } from '../../.test/agenda.mjs';
import { parseDuration, formatCountdown, formatStopwatch, nextRing, describeDays, describeWait } from '../../.test/alarmtime.mjs';
import { mergeSynced } from '../../.test/merge.mjs';
import { dailyStreak, weeklyStreak, completion, parseHabit } from '../../.test/habits.mjs';
import { asUrl, resolveQuery, nameFor } from '../../.test/links.mjs';
import { findFreeSpot, isOffSurface, overlaps } from '../../.test/layout.mjs';
import { routeFor, refusalFor, youtubeEmbed, cleanReaderText, nextMode, linkDestination, inPageTarget, formDestination } from '../../.test/browser.mjs';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

// ------------------------------------------------------------- calculator
const calc = (input, options = {}) => {
  const r = evaluate(input, options);
  return r.ok ? formatResult(r, { precision: 10 }) : `error: ${r.error}`;
};

check('precedence', calc('1 + 2 * 3'), '7');
check('brackets', calc('(1 + 2) * 3'), '9');
check('power is right-associative', calc('2^3^2'), '512');
check('unary minus binds looser than power', calc('-2^2'), '-4');
check('float noise is rounded away', calc('0.1 + 0.2'), '0.3');
check('modulo between operands', calc('10 % 3'), '1');
check('a bare percent', calc('50%'), '0.5');
check('relative percent up', calc('200 + 10%'), '220');
check('relative percent down', calc('200 - 25%'), '150');
check('percent of a product stays absolute', calc('200 * 10%'), '20');
check('factorial', calc('5!'), '120');
check('implicit multiplication by a constant', calc('2pi'), '6.283185307');
check('implicit multiplication by brackets', calc('3(4+1)'), '15');
check('brackets times brackets', calc('(1+2)(3+4)'), '21');
check('functions', calc('sqrt(16) + abs(-2)'), '6');
check('sine in degrees', calc('sin(30)', { angle: 'deg' }), '0.5');
check('sine of 180 degrees is zero', calc('sin(180)', { angle: 'deg' }), '0');
check('sine in radians', calc('sin(pi/2)', { angle: 'rad' }), '1');
check('variadic max', calc('max(3, 9, 2)'), '9');
check('log base 10', calc('log(1000)'), '3');
check('log with a base', calc('log(8, 2)'), '3');
check('hex and binary literals', calc('0xff + 0b11'), '258');
check('to hex', calc('255 to hex'), '0xFF');
check('to binary', calc('10 in bin'), '0b1010');
check('km to miles', calc('5 km to mi'), '3.106855961 mi');
check('celsius to fahrenheit', calc('100 c to f'), '212 °F');
check('fahrenheit to celsius', calc('-40 °F in °C'), '-40 °C');
check('binary data units', calc('1 GiB to MB'), '1073.741824 MB');
check('speed units with a slash', calc('60 km/h in mph'), '37.28227153 mph');
check('inches, with "in" as both unit and keyword', calc('12 in in cm'), '30.48 cm');
check('unit glued to its number', calc('3km to m'), '3000 m');
check('an expression converted', calc('(2+3) h to min'), '300 min');
check('mismatched dimensions', calc('5 kg to m'), 'error: Cannot turn kg (mass) into m (length).');
check('a unit with nowhere to go keeps it', calc('5 kg'), '5 kg');
check('min is still a function', calc('min(4, 2)'), '2');
check('ans', calc('ans * 2', { variables: { ans: 21 } }), '42');
check('variables', calc('x^2 + 1', { variables: { x: 4 } }), '17');
{
  const r = evaluate('rate = 3 * 4');
  check('assignment names the variable', r.ok && [r.assigned, r.value], ['rate', 12]);
}
check('a built-in cannot be assigned', calc('pi = 3'), 'error: "pi" is a built-in name.');
check('division by zero', calc('1/0'), 'error: Division by zero.');
check('unknown function', calc('foo(2)'), 'error: There is no function called "foo".');
check('unclosed bracket', calc('(1+2'), 'error: Missing ")".');
check('function without brackets', calc('sqrt 4'), 'error: sqrt needs brackets, like sqrt(2).');
check('arity', calc('sqrt(1, 2)'), 'error: sqrt() takes 1 value.');
check('empty input is quiet', evaluate('   '), { ok: false, error: '' });
check('grouping', formatNumber(1234567.891, { grouping: true }), '1,234,567.891');
check('huge numbers go exponential', formatNumber(6.02214076e23, { precision: 6 }), '6.02214e23');
check('tiny numbers go exponential', formatNumber(0.000000012345, { precision: 4 }), '1.235e-8');

// ----------------------------------------------------------------- agenda
// Monday 14 September 2026, 10:00 local.
const now = new Date(2026, 8, 14, 10, 0);
const quick = (text, options) => parseQuickAdd(text, now, options);
const brief = (q) => q && [q.title, q.date, q.time, q.duration, q.repeat, q.remind];

check('tomorrow at a time', brief(quick('Dentist tomorrow 14:30')), ['Dentist', '2026-09-15', '14:30', null, 'none', null]);
check('weekday and am', brief(quick('fri 9am standup')), ['standup', '2026-09-18', '09:00', null, 'none', null]);
check('pm today', brief(quick('Call mom at 5pm')), ['Call mom', '2026-09-14', '17:00', null, 'none', null]);
check('a time already gone moves to tomorrow', brief(quick('Report 9:00')), ['Report', '2026-09-15', '09:00', null, 'none', null]);
check('day month yearly', brief(quick('Birthday 3 oct every year')), ['Birthday', '2026-10-03', null, null, 'yearly', null]);
check('every weekday name is weekly from that day', brief(quick('Gym every monday 18:00 for 1h')), ['Gym', '2026-09-14', '18:00', 60, 'weekly', null]);
check('iso date and a time range', brief(quick('Meeting 2026-10-01 10:00-11:30')), ['Meeting', '2026-10-01', '10:00', 90, 'none', null]);
check('pm range', brief(quick('Lunch 1-2pm')), ['Lunch', '2026-09-14', '13:00', 60, 'none', null]);
check('german style date', brief(quick('Pay rent 1.10.')), ['Pay rent', '2026-10-01', null, null, 'none', null]);
check('weekdays with a reminder', brief(quick('Standup weekdays 9:15 remind 5m')), ['Standup', '2026-09-14', '09:15', null, 'weekdays', 5]);
check('in n days', brief(quick('in 3 days pick up parcel')), ['pick up parcel', '2026-09-17', null, null, 'none', null]);
check('a past date without a year is next year', brief(quick('Tax return 2 feb')), ['Tax return', '2027-02-02', null, null, 'none', null]);
check('month first when asked', brief(quick('Launch 10/3', { monthFirst: true })), ['Launch', '2026-10-03', null, null, 'none', null]);
check('german words', brief(quick('Zahnarzt morgen um 8 Uhr')), ['Zahnarzt', '2026-09-15', '08:00', null, 'none', null]);
check('nothing left to call it', quick('tomorrow 9am'), null);
check('empty', quick(''), null);
check('a title with no date words is left alone', brief(quick('Read the design doc')), ['Read the design doc', '2026-09-14', null, null, 'none', null]);

const ev = (over) => ({ id: 'e', title: 't', date: '2026-01-31', time: null, duration: null, repeat: 'none', until: null, colour: 'blue', remind: null, note: '', updatedAt: 0, ...over });
const days = (events, from, to) => occurrencesBetween(events, from, to).map((o) => o.date);

check('monthly on the 31st lands on short months\' last day', days([ev({ repeat: 'monthly' })], '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
check('yearly on 29 February', days([ev({ date: '2024-02-29', repeat: 'yearly' })], '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
check('weekdays skip the weekend', days([ev({ date: '2026-09-11', repeat: 'weekdays' })], '2026-09-11', '2026-09-15'), ['2026-09-11', '2026-09-14', '2026-09-15']);
check('weekly stops at until', days([ev({ date: '2026-09-01', repeat: 'weekly', until: '2026-09-15' })], '2026-09-01', '2026-10-31'), ['2026-09-01', '2026-09-08', '2026-09-15']);
check('a one-off outside the range', days([ev({ date: '2026-09-01' })], '2026-09-02', '2026-09-30'), []);
{
  const list = occurrencesBetween(
    [ev({ id: 'b', title: 'late', date: '2026-09-14', time: '15:00' }), ev({ id: 'a', title: 'all day', date: '2026-09-14' }), ev({ id: 'c', title: 'early', date: '2026-09-14', time: '08:00', duration: 30 })],
    '2026-09-14',
    '2026-09-14',
  );
  check('all-day first, then by time', list.map((o) => o.event.title), ['all day', 'early', 'late']);
  check('an end from the duration', list[1].end - list[1].start, 30 * 60_000);
}
check('day labels', ['2026-09-14', '2026-09-15', '2026-09-13'].map((k) => dayLabel(k, '2026-09-14', 'en-GB')), ['Today', 'Tomorrow', 'Yesterday']);
check('adding days across a month', addDays('2026-01-30', 3), '2026-02-02');
check('day difference across DST', dayDiff('2026-03-28', '2026-03-30'), 2);

// ----------------------------------------------------------------- alarms
check('seconds', parseDuration('90s'), { ms: 90_000, label: '' });
check('minutes', parseDuration('10m'), { ms: 600_000, label: '' });
check('hours and minutes', parseDuration('1h20m'), { ms: 4_800_000, label: '' });
check('hours and minutes, spaced', parseDuration('1h 20m'), { ms: 4_800_000, label: '' });
check('m:ss', parseDuration('1:30'), { ms: 90_000, label: '' });
check('h:mm:ss', parseDuration('1:02:03'), { ms: 3_723_000, label: '' });
check('a bare number is minutes', parseDuration('10'), { ms: 600_000, label: '' });
check('a name before', parseDuration('tea 4m'), { ms: 240_000, label: 'tea' });
check('a decimal and a name after', parseDuration('2.5 min pasta'), { ms: 150_000, label: 'pasta' });
check('no length at all', parseDuration('hello'), null);
check('zero is not a timer', parseDuration('0'), null);
check('countdown rounds up', [61_000, 3_661_000, 500, 0].map(formatCountdown), ['1:01', '1:01:01', '0:01', '0:00']);
check('stopwatch hundredths', formatStopwatch(65_420), '1:05.42');
{
  const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();
  check('once, later today', nextRing('07:00', [], at(14, 6)), at(14, 7));
  check('once, exactly now is tomorrow', nextRing('07:00', [], at(14, 7)), at(15, 7));
  check('weekends only from a Monday', nextRing('07:00', [6, 0], at(14, 8)), at(19, 7));
  check('every weekday from a Friday evening', nextRing('06:30', [1, 2, 3, 4, 5], at(18, 20)), at(21, 6, 30));
}
check('day summaries', [[1, 2, 3, 4, 5], [], [0, 6], [0, 1, 2, 3, 4, 5, 6]].map((d) => describeDays(d, 'en-GB')), ['Weekdays', 'Once', 'Weekends', 'Every day']);
check('wait', describeWait(7 * 3_600_000 + 12 * 60_000), 'in 7 h 12 min');

// ------------------------------------------------------------------ merge
{
  const now = 1_000_000;
  const file = (items, deleted = {}) => ({ version: 1, collections: { cards: items }, deleted });
  const ids = (merged) => merged.collections.cards.map((c) => `${c.id}:${c.v}`).sort();

  check('both sides survive', ids(mergeSynced(file([{ id: 'a', updatedAt: 1, v: 1 }]), file([{ id: 'b', updatedAt: 1, v: 1 }]), now)), ['a:1', 'b:1']);
  check('the newer copy wins', ids(mergeSynced(file([{ id: 'a', updatedAt: 5, v: 'disk' }]), file([{ id: 'a', updatedAt: 3, v: 'mine' }]), now)), ['a:disk']);
  check('a tie goes to the writer', ids(mergeSynced(file([{ id: 'a', updatedAt: 5, v: 'disk' }]), file([{ id: 'a', updatedAt: 5, v: 'mine' }]), now)), ['a:mine']);
  check('a removal beats an older edit', ids(mergeSynced(file([{ id: 'a', updatedAt: 5, v: 1 }]), file([], { a: 6 }), now)), []);
  check('an edit after a removal brings it back', ids(mergeSynced(file([{ id: 'a', updatedAt: 9, v: 2 }]), file([], { a: 6 }), now)), ['a:2']);
  check('old tombstones are dropped', mergeSynced(file([]), file([], { gone: 1 }), 61 * 86_400_000).deleted, {});
  {
    const disk = file([{ id: 'x', updatedAt: 1, v: 1 }, { id: 'a', updatedAt: 1, v: 1 }, { id: 'b', updatedAt: 1, v: 1 }]);
    const mine = file([{ id: 'b', updatedAt: 1, v: 1 }, { id: 'a', updatedAt: 1, v: 1 }]);
    const order = mergeSynced(disk, mine, now).collections.cards.map((c) => c.id);
    check("the writer's order comes first, then the file's extras", order, ['b', 'a', 'x']);
    const same = file([{ id: 'a', updatedAt: 2, v: 1 }, { id: 'b', updatedAt: 3, v: 1 }]);
    check('an unchanged merge serialises the same', JSON.stringify(mergeSynced(same, same, now).collections), JSON.stringify(same.collections));
  }
}

// ----------------------------------------------------------------- habits
{
  const set = (...dates) => {
    const s = new Set(dates);
    return (d) => s.has(d);
  };
  const today = '2026-09-14'; // a Monday
  check('a streak through today', dailyStreak(set('2026-09-14', '2026-09-13', '2026-09-12'), today), 3);
  check('today not ticked yet keeps the streak to yesterday', dailyStreak(set('2026-09-13', '2026-09-12'), today), 2);
  check('a gap ends it', dailyStreak(set('2026-09-14', '2026-09-12'), today), 1);
  check('nothing', dailyStreak(set(), today), 0);
  // Weeks starting Monday: 14-20 Sep (this one), 7-13, 31 Aug-6 Sep.
  const weekly = set('2026-09-08', '2026-09-10', '2026-09-12', '2026-09-01', '2026-09-03', '2026-09-05');
  check('weekly streak, this week still open', weeklyStreak(weekly, today, 3, true), 2);
  check('weekly streak with this week met', weeklyStreak(set('2026-09-14', '2026-09-15', '2026-09-16', '2026-09-08', '2026-09-09', '2026-09-10'), '2026-09-16', 3, true), 2);
  check('completion over a week', completion(set('2026-09-14', '2026-09-13'), today, 4), 0.5);
  check('a habit with a target', parseHabit('Gym 3x/week'), { name: 'Gym', perWeek: 3 });
  check('a target in words', parseHabit('Read 5 times per week'), { name: 'Read', perWeek: 5 });
  check('no target is daily', parseHabit('Meditate'), { name: 'Meditate', perWeek: 7 });
}

// ------------------------------------------------------------------ links
check('a bare domain', asUrl('github.com'), 'https://github.com');
check('a domain with a path', asUrl('example.org/docs?a=1'), 'https://example.org/docs?a=1');
check('localhost is http', asUrl('localhost:5173'), 'http://localhost:5173');
check('words are not an address', asUrl('best pizza near me'), null);
check('a scheme is kept', asUrl('steam://run/730'), 'steam://run/730');
check('a bang up front', resolveQuery('!yt lofi beats', 'google')?.url, 'https://www.youtube.com/results?search_query=lofi%20beats');
check('a bang at the end', resolveQuery('svelte runes !gh', 'google')?.label, 'GitHub: svelte runes');
check('an unknown bang searches literally', resolveQuery('!nope cats', 'duckduckgo')?.url, 'https://duckduckgo.com/?q=!nope%20cats');
check('an address opens', resolveQuery('news.ycombinator.com', 'google')?.kind, 'address');
check('everything else searches', resolveQuery('weather berlin', 'bing')?.url, 'https://www.bing.com/search?q=weather%20berlin');
check('a name from a host', [nameFor('https://www.github.com/x'), nameFor('https://news.bbc.co.uk/')], ['Github', 'Bbc']);

// ---------------------------------------------------------------- browser
check('a site that frames is live', routeFor('https://en.wikipedia.org/wiki/Svelte').mode, 'live');
check('text mode reads it instead', routeFor('https://en.wikipedia.org/wiki/Svelte', true).mode, 'reader');
check('a refusing site is shown as a copy', routeFor('https://github.com/sveltejs/svelte').mode, 'page');
check('a subdomain goes where its parent does', routeFor('https://mail.google.com/mail/u/0/').mode, 'window');
check('a lookalike host is not matched', refusalFor('https://notgithub.com/'), null);
check('bing results frame, bing itself does not', [routeFor('https://www.bing.com/search?q=x').mode, routeFor('https://www.bing.com/').mode], ['live', 'window']);
check('a map embed frames', routeFor('https://www.google.com/maps/embed?pb=1').mode, 'live');
check('a video plays in its embed player', routeFor('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1m30s').load, 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=90');
check('short links and shorts too', [youtubeEmbed('https://youtu.be/jNQXAC9IVRw'), youtubeEmbed('https://m.youtube.com/shorts/jNQXAC9IVRw')], ['https://www.youtube-nocookie.com/embed/jNQXAC9IVRw', 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw']);
check('a video keeps its own address', routeFor('https://youtu.be/jNQXAC9IVRw').url, 'https://youtu.be/jNQXAC9IVRw');
check('youtube without a video opens a window', routeFor('https://www.youtube.com/feed/subscriptions').mode, 'window');
check('other schemes go to the shell', routeFor('steam://run/730').mode, 'external');
check('reader text loses empty links and images', cleanReaderText('1.[](https://v)[Title](https://t)\n\n\n\n![Image 1](https://i.png)x').text, '1.[Title](https://t)\n\nx');
check('duckduckgo results are a copy, duckduckgo itself a window', [routeFor('https://html.duckduckgo.com/html/?q=x').mode, routeFor('https://duckduckgo.com/').mode], ['page', 'window']);
check('reddit turns the reader away, so it gets a window', routeFor('https://www.reddit.com/r/programming/').mode, 'window');
check('the view button goes live, copy, text and back', [nextMode('https://example.com/', 'live'), nextMode('https://example.com/', 'page'), nextMode('https://example.com/', 'reader'), nextMode('https://github.com/', 'reader'), nextMode('https://mail.google.com/', 'window')], ['page', 'reader', 'live', 'page', 'page']);
check('a search redirect link is unwrapped', linkDestination('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fsvelte.dev%2Fblog%2Frunes&rut=abc'), 'https://svelte.dev/blog/runes');
check('a copied page cannot hand over another protocol', [linkDestination('javascript:alert(1)'), linkDestination('ms-settings:privacy'), linkDestination('mailto:a@b.c')], [null, null, 'mailto:a@b.c']);
check('an anchor on the same page stays on it', [inPageTarget('https://a.com/x#install', 'https://a.com/x'), inPageTarget('https://a.com/y#install', 'https://a.com/x')], ['install', null]);
check('a plain form becomes an address, a posting one does not', [formDestination('https://a.com/search?old=1', 'get', [['q', 'svelte runes']]), formDestination('https://a.com/login', 'post', [['user', 'x']])], ['https://a.com/search?q=svelte+runes', null]);
check('long reader text stops at a paragraph', cleanReaderText(`${'a'.repeat(90)}\n\n${'b'.repeat(20)}`, 100), { text: 'a'.repeat(90), truncated: true });

// ----------------------------------------------------------------- layout
{
  const hd = { width: 1920, height: 1080 };
  const column = [
    { x: 40, y: 40, w: 300, h: 150 },
    { x: 40, y: 210, w: 300, h: 330 },
  ];
  check('touching edges do not overlap', overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
  check('a gap makes neighbours overlap', overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 10, h: 10 }, 4), true);
  check('the first free spot is beside the column', findFreeSpot({ w: 300, h: 360 }, column, hd), { x: 360, y: 40 });
  check('an empty surface starts at the margin', findFreeSpot({ w: 300, h: 300 }, [], hd), { x: 40, y: 40 });
  check('too big for the display', findFreeSpot({ w: 2000, h: 300 }, [], hd), null);
  check('a wide layout on a 1080p display is off it', isOffSurface({ x: 1960, y: 40, w: 320, h: 380 }, hd), true);
  check('a panel partly past the right edge is still reachable', isOffSurface({ x: 1700, y: 40, w: 300, h: 380 }, hd), false);
  check('a header below the bottom edge is not', isOffSurface({ x: 40, y: 1060, w: 300, h: 200 }, hd), true);
}

// ------------------------------------------------------------- appearance
{
  const { readFileSync } = await import('node:fs');
  const { PALETTES, SCHEME_OPTIONS, RAMP_STOPS, schemeVars, schemePolarity } = await import('../../.test/schemes.mjs');
  const { LOOKS, APPEARANCE_KEYS, SHARED_EXTRA_KEYS, resolveLook, currentLook, exportAppearance, parseAppearance } =
    await import('../../.test/looks.mjs');
  const { surfaceVars, surfaceData } = await import('../../.test/appearance.mjs');
  const { APPEARANCE_FIELDS } = await import('../../.test/appearance-fields.mjs');
  const { GAME_MODE_FIELDS } = await import('../../.test/gamemode-fields.mjs');

  const root = new URL('../../', import.meta.url);
  const scalar = (raw) => {
    const text = raw.trim().replace(/,$/, '');
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    const quoted = /^"(.*)"$/.exec(text) ?? /^'(.*)'$/.exec(text);
    return quoted ? quoted[1] : text;
  };

  // DEFAULT_CONFIG, read from the source: the store itself imports the host SDK.
  const configSource = readFileSync(new URL('src/lib/config.svelte.ts', root), 'utf8');
  const start = configSource.indexOf('export const DEFAULT_CONFIG');
  const defaults = {};
  for (const line of configSource.slice(start, configSource.indexOf('\n};', start)).split(/\r?\n/)) {
    // Trimmed: the slice ends before the closing brace's newline, so a CRLF
    // file leaves its last line carrying a bare `\r`.
    const m = /^  (\w+): (.+),$/.exec(line.trimEnd());
    if (m) defaults[m[1]] = scalar(m[2]);
  }

  // Every setting item in metadata.yml: its type, default, range and options.
  const settings = new Map();
  let item = null;
  let inOptions = false;
  let optionLabel = null;
  for (const line of readFileSync(new URL('widgets/desktop/metadata.yml', root), 'utf8').split(/\r?\n/)) {
    let m;
    if ((m = /^        - type: (\w+)$/.exec(line))) {
      item = { type: m[1], options: [] };
      inOptions = false;
    } else if (!item) {
      continue;
    } else if ((m = /^          key: (\w+)$/.exec(line))) {
      item.key = m[1];
      settings.set(m[1], item);
    } else if (/^          options:$/.test(line)) {
      inOptions = true;
    } else if (inOptions && (m = /^            - label: (.+)$/.exec(line))) {
      optionLabel = scalar(m[1]);
    } else if (inOptions && (m = /^              value: (.+)$/.exec(line))) {
      item.options.push({ value: String(scalar(m[1])), label: optionLabel });
    } else if ((m = /^          (\w+): (.+)$/.exec(line))) {
      inOptions = false;
      if (['defaultValue', 'min', 'max', 'step'].includes(m[1])) item[m[1]] = scalar(m[2]);
    }
  }

  // The two declarations of every setting agree.
  check(
    'metadata.yml defaults match DEFAULT_CONFIG',
    [...settings.values()]
      .filter((s) => !Object.is(defaults[s.key], s.defaultValue))
      .map((s) => `${s.key}: yml ${JSON.stringify(s.defaultValue)}, config ${JSON.stringify(defaults[s.key])}`),
    [],
  );
  check('every appearance key is declared in metadata.yml', [...APPEARANCE_KEYS, ...SHARED_EXTRA_KEYS].filter((k) => !settings.has(k)), []);

  const fieldProblems = [];
  for (const def of Object.values(APPEARANCE_FIELDS).flat()) {
    const s = settings.get(def.key);
    if (!s) fieldProblems.push(`${def.key}: not in metadata.yml`);
    else if (s.type !== def.type) fieldProblems.push(`${def.key}: ${def.type} here, ${s.type} there`);
    else if (def.type === 'range' && (def.min !== s.min || def.max !== s.max || def.step !== s.step)) fieldProblems.push(`${def.key}: range differs`);
    else if (def.type === 'select' && def.options.map((o) => o.value).join() !== s.options.map((o) => o.value).join()) fieldProblems.push(`${def.key}: options differ`);
  }
  check('the Appearance dialog matches metadata.yml', fieldProblems, []);

  // The Game mode dialog is declared twice for the same reason the Appearance
  // one is: `metadata.yml` feeds Seelen's own Settings window, which cannot
  // read the TypeScript table the dialog is built from.
  const gameProblems = [];
  for (const def of Object.values(GAME_MODE_FIELDS).flat()) {
    const s = settings.get(def.key);
    if (!s) gameProblems.push(`${def.key}: not in metadata.yml`);
    else if (s.type !== def.type) gameProblems.push(`${def.key}: ${def.type} here, ${s.type} there`);
    else if (def.type === 'range' && (def.min !== s.min || def.max !== s.max || def.step !== s.step)) gameProblems.push(`${def.key}: range differs`);
    else if (def.type === 'select' && def.options.map((o) => o.value).join() !== s.options.map((o) => o.value).join()) gameProblems.push(`${def.key}: options differ`);
  }
  check('the Game mode dialog matches metadata.yml', gameProblems, []);
  check('the display picker is not per-monitor', settings.has('gameModeDisplay'), true);

  // Looks write only values the settings accept.
  const lookProblems = [];
  for (const look of LOOKS) {
    for (const [key, value] of Object.entries(look.values)) {
      const s = settings.get(key);
      if (!APPEARANCE_KEYS.includes(key)) lookProblems.push(`${look.id}.${key}: not an appearance key`);
      else if (!s) lookProblems.push(`${look.id}.${key}: undeclared`);
      else if (typeof value !== typeof defaults[key]) lookProblems.push(`${look.id}.${key}: wrong type`);
      else if (s.type === 'select' && !s.options.some((o) => o.value === value)) lookProblems.push(`${look.id}.${key}: ${value} is not an option`);
      else if (s.type === 'range' && (value < s.min || value > s.max)) lookProblems.push(`${look.id}.${key}: ${value} is out of range`);
      else if (s.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) lookProblems.push(`${look.id}.${key}: not a colour`);
    }
  }
  check('every look sets only valid values', lookProblems, []);
  check('look ids are unique', new Set(LOOKS.map((look) => look.id)).size, LOOKS.length);
  check('the defaults are the Glass look', currentLook(defaults, defaults), 'glass');
  const terminal = LOOKS.find((look) => look.id === 'terminal');
  check('an applied look is recognised', currentLook({ ...defaults, ...resolveLook(terminal, defaults) }, defaults), 'terminal');
  check('one slider moved is no longer the look', currentLook({ ...defaults, ...resolveLook(terminal, defaults), cornerRadius: 3 }, defaults), null);
  check('a look puts back what it does not mention', resolveLook(LOOKS[0], { ...defaults, panelBorderStyle: 'ridge' }).panelBorderStyle, 'ridge');

  // Schemes.
  const hex = /^#[0-9a-f]{6}$/i;
  check(
    'every palette colour is six-digit hex',
    Object.entries(PALETTES).flatMap(([id, p]) => Object.entries(p).filter(([k, v]) => k !== 'label' && k !== 'dark' && !hex.test(v)).map(([k]) => `${id}.${k}`)),
    [],
  );
  check('the scheme options are theme, custom and every palette', SCHEME_OPTIONS.map((o) => o.value), ['theme', 'custom', ...Object.keys(PALETTES)]);
  check('metadata.yml offers exactly those schemes', settings.get('colorScheme')?.options.map((o) => o.value), SCHEME_OPTIONS.map((o) => o.value));
  check('following the theme sets no colours', schemeVars({ colorScheme: 'theme', schemeGround: '#000000', schemeInk: '#ffffff' }), []);
  const nord = new Map(schemeVars({ ...defaults, colorScheme: 'nord' }));
  check('a scheme sets the whole ramp', RAMP_STOPS.every((stop) => nord.has(`--color-gray-${stop}`)), true);
  check('a scheme is grounded and inked in its own colours', [nord.get('--color-gray-50'), nord.get('--color-gray-900'), nord.get('--color-red-700')], ['#2e3440', '#e5e9f0', '#bf616a']);
  check('a custom scheme is mixed from its two colours', new Map(schemeVars({ colorScheme: 'custom', schemeGround: '#101010', schemeInk: '#f0f0f0' })).get('--color-gray-50'), '#101010');
  check(
    'scheme polarity',
    [schemePolarity('nord', ''), schemePolarity('solarized-light', ''), schemePolarity('theme', '#ffffff'), schemePolarity('custom', '#fff8e7'), schemePolarity('custom', '#161616')],
    ['dark', 'light', null, 'light', 'dark'],
  );

  // What reaches the stylesheets.
  const vars = (over) => new Map(surfaceVars({ ...defaults, ...over }));
  const base = vars({});
  check(
    'at the defaults every multiplier is 1 and every size is as tuned',
    [base.get('--text-scale'), base.get('--round'), base.get('--density'), base.get('--panel-pad'), base.get('--panel-border-width'), base.get('--bar-h')],
    ['1', '1', '1', '12px', '1px', '4px'],
  );
  check('at the defaults the accent follows the theme', base.get('--accent'), 'var(--rs-accent, #7aa2f7)');
  check('at the defaults no scheme colour is set', base.has('--color-gray-50'), false);
  check('a scheme brings its accent and stops following the theme', [vars({ colorScheme: 'nord' }).get('--accent'), vars({ colorScheme: 'nord' }).get('--panel-ground')], ['#88c0d0', 'var(--color-gray-50, #16161e)']);
  check('a scheme without its accents uses the pickers', vars({ colorScheme: 'nord', schemeAccent: false, accentColor: '#ff0000' }).get('--accent'), '#ff0000');
  check('no blur and no saturation is no backdrop filter at all', vars({ panelBlur: 0 }).get('--panel-backdrop'), 'none');
  check('saturation joins the blur', vars({ panelBlur: 10, backdropSaturation: 150 }).get('--panel-backdrop'), 'blur(10px) saturate(1.5)');
  check('the text scale follows the base size', vars({ fontSize: 18 }).get('--text-scale'), '1.286');
  check('animations off stops motion whatever its length', vars({ animations: false, motionScale: 200 }).get('--motion'), '0');
  check('a font name cannot end the declaration', vars({ fontFamily: 'Evil"; } body { x' }).get('--ui-font').startsWith('"Evil  body  x", '), true);
  check(
    'a turning edge needs animations on',
    [surfaceData({ ...defaults, borderAnimation: true }).borderMotion, surfaceData({ ...defaults, borderAnimation: true, animations: false }).borderMotion],
    ['on', 'off'],
  );

  // Sharing.
  const shared = parseAppearance(exportAppearance({ ...defaults, colorScheme: 'dracula', customCss: '.x {}' }), defaults);
  check('an exported appearance reads back', [shared.ok, shared.values?.colorScheme, shared.values?.customCss], [true, 'dracula', '.x {}']);
  const typo = parseAppearance(JSON.stringify({ panelOpacity: 'lots', cornerRadius: 4, somethingElse: 1 }), defaults);
  check('a pasted value of the wrong type is left out and named', [typo.ok, typo.values, typo.skipped], [true, { cornerRadius: 4 }, ['panelOpacity', 'somethingElse']]);
  check('text that is not JSON is refused', parseAppearance('nope', defaults).ok, false);

  // The scheme, as sent to the shell theme.
  const { shellSchemeVars, mixHex } = await import('../../.test/schemes.mjs');
  check('an OKLab mix returns its ends', [mixHex('#ff0000', '#0000ff', 100), mixHex('#ff0000', '#0000ff', 0)], ['#ff0000', '#0000ff']);
  check('an OKLab mix of black and white is a mid grey', mixHex('#ffffff', '#000000', 50), '#636363');
  const shellNone = shellSchemeVars(defaults);
  check('following the theme sends the shell no scheme', [shellNone['--rs-scheme'], shellNone['--rs-scheme-bg'], shellNone['--rs-scheme-accent']], ['"none"', 'transparent', 'transparent']);
  const shellNord = shellSchemeVars({ ...defaults, colorScheme: 'nord' });
  check('a named scheme sends its ramp, hues and accent', [shellNord['--rs-scheme'], shellNord['--rs-scheme-bg'], shellNord['--rs-scheme-red'], shellNord['--rs-scheme-accent']], ['"full"', '#2e3440', '#bf616a', '#88c0d0']);
  const shellCustom = shellSchemeVars({ ...defaults, colorScheme: 'custom', schemeGround: '#101010', schemeInk: '#F0F0F0', accentColor: '#ff5c8a' });
  check('a custom scheme sends its greys and the picked accent, not hues', [shellCustom['--rs-scheme'], shellCustom['--rs-scheme-fg'], shellCustom['--rs-scheme-red'], shellCustom['--rs-scheme-accent']], ['"ramp"', '#f0f0f0', 'transparent', '#ff5c8a']);
  check(
    'the shell is only ever sent hex or transparent',
    [shellNone, shellNord, shellCustom].flatMap((vars) => Object.entries(vars).filter(([k, v]) => k !== '--rs-scheme' && !/^(#[0-9a-f]{6}|transparent)$/.test(v)).map(([k]) => k)),
    [],
  );
  check('the three states send the same variables', [Object.keys(shellNone).sort().join(), Object.keys(shellCustom).sort().join()], [Object.keys(shellNord).sort().join(), Object.keys(shellNord).sort().join()]);

  // The Shell tab's table of theme settings matches the theme's own metadata.yml.
  const { THEME_KNOBS, THEME_INTERNAL, decodeKnob, encodeKnob, knobByName, shareableShell } = await import('../../.test/shell-theme.mjs');
  const unquote = (raw) => raw.trim().replace(/^'(.*)'$/, '$1').replace(/^"(<.*>)"$/, '$1');
  const themeKnobs = new Map();
  let themeKnob = null;
  for (const line of readFileSync(new URL('themes/surface/metadata.yml', root), 'utf8').split(/\r?\n/)) {
    let m;
    if ((m = /^        - name: (--[\w-]+)$/.exec(line))) {
      themeKnob = { name: m[1], options: [] };
      themeKnobs.set(m[1], themeKnob);
    } else if (themeKnob && (m = /^          (syntax|initialValue|min|max|step): (.+)$/.exec(line))) {
      themeKnob[m[1]] = unquote(m[2]);
    } else if (themeKnob && (m = /^            - (.+)$/.exec(line))) {
      themeKnob.options.push(unquote(m[1]).replace(/^"(.*)"$/, '$1'));
    }
  }
  const knobProblems = [];
  for (const k of THEME_KNOBS) {
    const y = themeKnobs.get(k.name);
    if (!y) {
      knobProblems.push(`${k.name}: not in the theme`);
      continue;
    }
    if (y.syntax !== k.syntax) knobProblems.push(`${k.name}: syntax ${k.syntax} here, ${y.syntax} there`);
    if (y.initialValue !== k.initial) knobProblems.push(`${k.name}: initial ${k.initial} here, ${y.initialValue} there`);
    for (const part of ['min', 'max', 'step']) {
      if (y[part] !== undefined && y[part] !== 'null' && Number(y[part]) !== k[part]) knobProblems.push(`${k.name}: ${part} ${k[part]} here, ${y[part]} there`);
    }
    if ((k.options ?? []).map((o) => o.value).join() !== y.options.join()) knobProblems.push(`${k.name}: options differ`);
  }
  check('the Shell tab matches the theme metadata', knobProblems, []);
  check('every theme setting a person sets is in the Shell tab', [...themeKnobs.keys()].filter((name) => !THEME_INTERNAL.test(name) && !knobByName(name)), []);

  const presetKnob = knobByName('--rs-preset');
  const radiusKnob = knobByName('--rs-radius');
  const familyKnob = knobByName('--rs-font-family');
  const accentKnob = knobByName('--rs-accent');
  const zoomKnob = knobByName('--rs-dock-zoom');
  check(
    'theme values decode for the dialog',
    [decodeKnob(presetKnob, '"midnight"'), decodeKnob(presetKnob, undefined), decodeKnob(radiusKnob, '16px'), decodeKnob(familyKnob, 'system-ui'), decodeKnob(familyKnob, '"Inter"'), decodeKnob(accentKnob, undefined), decodeKnob(zoomKnob, '22')],
    ['midnight', 'monochrome', 16, '', 'Inter', 'transparent', 22],
  );
  check(
    'theme values encode the way the host stores them',
    [encodeKnob(presetKnob, 'ember'), encodeKnob(radiusKnob, 12), encodeKnob(familyKnob, ''), encodeKnob(familyKnob, 'Inter'), encodeKnob(accentKnob, ''), encodeKnob(zoomKnob, 30)],
    ['"ember"', '12px', 'system-ui', '"Inter"', 'transparent', '30'],
  );
  check(
    'a shared shell leaves out what the desktop writes and what the theme does not have',
    Object.keys(shareableShell({ '--rs-preset': '"moss"', '--rs-tint': 'rgb(1, 2, 3)', '--rs-scheme-bg': '#000000', '--rs-nonsense': '1' })),
    ['--rs-preset'],
  );
  const withShell = parseAppearance(exportAppearance(defaults, { '--rs-dock-zoom': '30' }), defaults);
  check('an exported appearance carries the shell', [withShell.ok, withShell.shell], [true, { '--rs-dock-zoom': '30' }]);

  // The AI designer: what it may set, and how its answer is made safe to write.
  const { VIBE_FIELDS, vibeKnobs, buildVibePrompt, extractJson, parseVibe } = await import('../../.test/vibe.mjs');
  check(
    'the designer never changes how the desktop is used',
    VIBE_FIELDS.filter((def) => ['fontSize', 'animations', 'lockLayout', 'wallpaperEnabled', 'styleShell', 'iconSize'].includes(def.key)).map((def) => def.key),
    [],
  );
  check(
    'the designer is offered every look setting but the theme switch',
    APPEARANCE_KEYS.filter((key) => key !== 'followTheme' && !VIBE_FIELDS.some((def) => def.key === key)),
    [],
  );
  check(
    'shell settings the desktop sends are not the designer’s while it sends them',
    [vibeKnobs(true).some((k) => k.synced), vibeKnobs(false).some((k) => k.synced), vibeKnobs(false).some((k) => k.group === 'palette')],
    [false, true, false],
  );
  const vibePrompt = buildVibePrompt({ prompt: 'cosy cabin', adjust: false, current: defaults, currentShell: {}, fonts: ['Georgia', 'Consolas'], styleShell: true, includeShell: true });
  check(
    'the prompt lists every setting, the free shell settings and the fonts',
    [VIBE_FIELDS.every((def) => vibePrompt.system.includes(`- ${def.key}:`)), vibePrompt.system.includes('- --rs-dock-zoom:'), vibePrompt.system.includes('- --rs-radius:'), vibePrompt.system.includes('Georgia; Consolas'), vibePrompt.system.includes('catppuccin-latte (light)'), vibePrompt.user],
    [true, true, false, true, true, 'Vibe: cosy cabin'],
  );
  check(
    'an adjustment sends the current design',
    buildVibePrompt({ prompt: 'warmer', adjust: true, current: defaults, currentShell: {}, fonts: [], styleShell: true, includeShell: false }).user.startsWith('The current design:\n{"desktop":{'),
    true,
  );
  check('JSON is found inside a fence and prose', extractJson('Sure!\n```json\n{"name": "x"}\n```\nEnjoy'), { name: 'x' });
  const vibe = parseVibe(
    JSON.stringify({
      name: 'Cabin',
      summary: 'Warm.',
      desktop: { colorScheme: 'Gruvbox Dark', panelOpacity: 140, cornerRadius: '13.6px', panelBorderWidth: 1.3, accentColor: 'f80', panelShadow: 'enormous', fontFamily: 'Comic Neue', displayFont: 'georgia', panelTexture: 'true', fontSize: 30, wat: 1 },
      shell: { '--rs-dock-zoom': 99, '--rs-start-icon': 'petal', '--rs-radius': 4, '--rs-start-color': 'transparent' },
    }),
    { fonts: ['Georgia'], styleShell: true, includeShell: true },
  );
  check(
    'a design is coerced into values the controls accept',
    [vibe.ok, vibe.design?.name, vibe.design?.desktop],
    [true, 'Cabin', { colorScheme: 'gruvbox-dark', panelOpacity: 100, cornerRadius: 14, panelBorderWidth: 1.5, accentColor: '#ff8800', displayFont: 'Georgia', panelTexture: true }],
  );
  check('what cannot be used is named, never written', vibe.design?.dropped, ['panelShadow', 'fontFamily', 'fontSize', 'wat', '--rs-radius']);
  check('shell values are stored the way the theme reads them', vibe.design?.shell, { '--rs-dock-zoom': '40', '--rs-start-icon': '"petal"', '--rs-start-color': 'transparent' });
  check(
    'an answer with nothing usable in it is refused',
    [parseVibe('no idea', { fonts: [], styleShell: true, includeShell: true }).ok, parseVibe('{"desktop": {"wat": 1}}', { fonts: [], styleShell: true, includeShell: true }).ok],
    [false, false],
  );
  check(
    'a model that forgets the desktop wrapper is still understood',
    parseVibe('{"name": "Flat", "colorScheme": "nord", "panelBlur": 0}', { fonts: [], styleShell: true, includeShell: false }).design?.desktop,
    { colorScheme: 'nord', panelBlur: 0 },
  );
}

// -------------------------------------------------------------- game mode
{
  const {
    DEFAULT_BINDINGS,
    actionsFor,
    axisValue,
    detectLayout,
    formatBindings,
    glyphFor,
    parseBindings,
    resolveLayout,
    repeatsBy,
    stickDirection,
    stickVector,
  } = await import('../../.test/gamepad.mjs');
  const { buildTranslation, formatStroke, parseStroke, parseTarget } = await import('../../.test/padkeys.mjs');
  const { firstIn, nearestTo, pickNeighbour } = await import('../../.test/navgrid.mjs');

  // --- which pad is in the user's hands
  check('an Xbox pad is recognised', detectLayout('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  check(
    'a DualSense is recognised by its vendor id, not its marketing name',
    detectLayout('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'),
    'playstation',
  );
  check('a Switch Pro pad is recognised', detectLayout('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'nintendo');
  check('anything else falls back to generic', detectLayout('Some Unknown Pad'), 'generic');

  // The whole point of naming buttons by position: one binding is the right
  // letter on every pad.
  check(
    'the confirm button is lettered per family',
    [glyphFor('south', 'xbox'), glyphFor('south', 'playstation'), glyphFor('south', 'nintendo')],
    ['A', '✕', 'B'],
  );
  check('and the back button with it', [glyphFor('east', 'xbox'), glyphFor('east', 'nintendo')], ['B', 'A']);

  // With nothing plugged in there is no id to read, and the hints still have to
  // say something; "press 1 to play" would be a worse guess than A.
  check('no pad yet still draws familiar glyphs', resolveLayout('auto', ''), 'xbox');
  check('a pad that is there is read', resolveLayout('auto', 'Wireless Controller (Vendor: 054c)'), 'playstation');
  check('and a choice always wins', resolveLayout('nintendo', 'Xbox 360 Controller'), 'nintendo');

  // --- dead zones and sticks
  check('inside the dead zone reads as centred', axisValue(0.2, 0.25), 0);
  check('just outside it starts from zero, not from the raw value', axisValue(0.2501, 0.25) < 0.002, true);
  check('full deflection is full', axisValue(1, 0.25), 1);
  check('and it keeps its sign', axisValue(-1, 0.25), -1);
  check('a curve softens the middle', axisValue(0.625, 0.25, 2).toFixed(3), '0.250');

  // A round hole, not a square one: the same push registers the same whichever
  // way it points.
  check('a diagonal inside the radius is still centred', stickVector(0.2, 0.2, 0.35).magnitude, 0);
  check('a diagonal past it is not', stickVector(0.3, 0.3, 0.35).magnitude > 0, true);
  check('the dominant axis wins outright', stickDirection(0.9, 0.4, 0.5), 'right');
  check('...in either direction', stickDirection(0.2, -0.9, 0.5), 'up');
  check('a stick at rest means nothing', stickDirection(0.1, 0.1, 0.5), null);

  // --- hold to repeat
  check('a tap is one step', repeatsBy(0, 420, 140), 1);
  check('and still one just before the delay is out', repeatsBy(419, 420, 140), 1);
  check('the first repeat lands on the delay', repeatsBy(420, 420, 140, 140, 0), 2);
  check('then they come at the interval', repeatsBy(420 + 140 * 3, 420, 140, 140, 0), 5);
  check('a long hold accelerates', repeatsBy(2000, 420, 140, 60) > repeatsBy(2000, 420, 140, 140, 0), true);

  // --- bindings
  check('the default is the console layout', [DEFAULT_BINDINGS.confirm, DEFAULT_BINDINGS.back], ['south', 'east']);
  check('a stored pair is read', parseBindings('confirm=east, back=south').confirm, 'east');
  check('a malformed pair costs only itself', parseBindings('confirm=east, back=wat').back, 'east');
  check('only what differs is written back', formatBindings({ ...DEFAULT_BINDINGS, confirm: 'east' }), 'confirm=east');
  check('nothing to say means an empty string', formatBindings(DEFAULT_BINDINGS), '');
  check('a button bound twice answers with both', actionsFor('east', { ...DEFAULT_BINDINGS, quit: 'east' }).sort(), ['back', 'quit']);

  // --- keys
  check('a plain key', formatStroke(parseStroke('enter')), 'Enter');
  check('a letter carries its code', [parseStroke('w').code, parseStroke('w').keyCode], ['KeyW', 87]);
  check('modifiers, in a fixed order', formatStroke(parseStroke('shift+ctrl+f5')), 'Ctrl + Shift + F5');
  check('a function key', [parseStroke('f11').key, parseStroke('f11').keyCode], ['F11', 122]);
  check('shift capitalises the letter it produces', parseStroke('shift+a').key, 'A');
  check('nonsense is refused rather than guessed', [parseStroke('wat'), parseStroke('ctrl+')], [null, null]);
  check('a mouse target', parseTarget('rightclick').kind, 'click');
  check('a scroll target', [parseTarget('scrolldown').dx, parseTarget('scrolldown').dy], [0, 1]);
  check('an empty binding is a real "nothing"', parseTarget('none').kind, 'none');

  {
    const navigation = buildTranslation('navigation', '');
    check('the navigation profile walks the controls', [navigation.r1.label, navigation.south.label], ['Tab', 'Enter']);
    const overridden = buildTranslation('navigation', 'north=f5, l3=rightclick, r1=none');
    check('an override applies over a preset', [overridden.north.label, overridden.l3.label], ['F5', 'Right click']);
    check('...including clearing one', overridden.r1.kind, 'none');
    check('an unreadable override leaves the preset alone', buildTranslation('navigation', 'north=wat').north.label, 'Space');
    check('custom starts from nothing', Object.keys(buildTranslation('custom', '')).length, 0);
  }

  // --- spatial navigation
  {
    // A rail of three tabs above two rows of tiles, laid out as they render.
    const rects = [
      { id: 'tab-a', x: 40, y: 20, w: 100, h: 40, group: 'rail' },
      { id: 'tab-b', x: 150, y: 20, w: 100, h: 40, group: 'rail' },
      { id: 'tab-c', x: 260, y: 20, w: 100, h: 40, group: 'rail' },
      { id: 'r1-1', x: 40, y: 120, w: 160, h: 240, group: 'row1' },
      { id: 'r1-2', x: 220, y: 120, w: 160, h: 240, group: 'row1' },
      { id: 'r2-1', x: 40, y: 400, w: 160, h: 240, group: 'row2' },
      { id: 'r2-2', x: 220, y: 400, w: 160, h: 240, group: 'row2' },
    ];

    check('a row moves sideways', pickNeighbour('tab-a', rects, 'right'), 'tab-b');
    check('and stops at its end', pickNeighbour('tab-c', rects, 'right'), null);
    // Down lands on what is actually underneath: tab-b spans 150-250, so its
    // centre sits over r1-1 (40-200), not over r1-2 (220-380).
    check('down from a tab lands under it', pickNeighbour('tab-b', rects, 'down'), 'r1-1');
    check('...and under a tab further along, the tile further along', pickNeighbour('tab-c', rects, 'down'), 'r1-2');
    check('a column stays a column', pickNeighbour('r1-1', rects, 'down'), 'r2-1');
    check('...and comes back up the same way', pickNeighbour('r2-2', rects, 'up'), 'r1-2');
    check('nothing above the rail', pickNeighbour('tab-a', rects, 'up'), null);
    check(
      'a disabled control is not somewhere to land',
      pickNeighbour('tab-a', rects.map((r) => (r.id === 'tab-b' ? { ...r, disabled: true } : r)), 'right'),
      'tab-c',
    );

    check('a screen opens top-left', firstIn(rects), 'tab-a');
    check('...or top-left of the group it is told', firstIn(rects, 'row2'), 'r2-1');
    check('the selection can be re-found by position', nearestTo(rects, 300, 500), 'r2-2');
  }

  // A tall panel beside a short one overlaps it; an edge test would call the
  // neighbour "not ahead" and refuse to move at all.
  {
    const uneven = [
      { id: 'tall', x: 0, y: 0, w: 200, h: 400 },
      { id: 'short', x: 220, y: 160, w: 200, h: 80 },
    ];
    check('a short neighbour beside a tall one is still reachable', pickNeighbour('tall', uneven, 'right'), 'short');
    check('and the way back', pickNeighbour('short', uneven, 'left'), 'tall');
  }
}

// --------------------------------------------- game rows and descriptions
{
  const { dedupe, homeRows, keysOf, nameKey } = await import('../../.test/gamerows.mjs');
  const { batchGames, blurbKey, buildBlurbPrompt, cleanBlurb, parseBlurbs } = await import('../../.test/blurb.mjs');

  // --- one tile per game, however many entries detection left behind
  const game = (id, extra = {}) => ({ id, name: id, target: `c:\\games\\${id}.exe`, ...extra });

  const has = (game, key) => keysOf(game).includes(key);

  check('an entry answers to its executable', has({ id: 'a', name: 'A', target: 'steam://rungameid/1', exePath: 'C:/G/Run.exe' }, 'exe:c:\\g\\run.exe'), true);
  check('...to its package id', has({ id: 'a', name: 'A', target: 'x', umid: 'Pkg!App' }, 'umid:pkg!app'), true);
  check('...to what it launches', has({ id: 'a', name: 'A', target: 'Steam://RunGameID/1' }, 'target:steam://rungameid/1'), true);
  check('...to the store and id inside that link', has({ id: 'a', name: 'A', target: 'steam://rungameid/730' }, 'store:steam:730'), true);
  check('...and to its own title', has({ id: 'a', name: 'Counter-Strike 2™', target: 'x' }, 'name:counter strike 2'), true);
  check('a title is folded to letters and numbers', nameKey({ id: 'a', name: 'COUNTER-STRIKE  2' }), 'counter strike 2');
  check('a name the user gave it wins', nameKey({ id: 'a', name: 'cs2', customName: 'Counter-Strike 2' }), 'counter strike 2');
  check('an entry with nothing to offer is only ever itself', keysOf({ id: 'a', name: '', target: '' }), ['id:a']);
  check(
    'a launcher bootstrapper is not an identity, or a whole store would be one game',
    has({ id: 'a', name: 'League of Legends', target: 'C:\\Riot Games\\RiotClientServices.exe' }, 'exe:c:\\riot games\\riotclientservices.exe'),
    false,
  );

  // The reported bug: one shortcut, one running process, one title.
  check(
    'a shortcut and the process it started are one tile',
    dedupe([
      { id: 'a', name: 'Counter-Strike 2', target: 'steam://rungameid/730' },
      { id: 'b', name: 'Counter-Strike 2', target: 'D:\\Steam\\cs2.exe', exePath: 'D:\\Steam\\cs2.exe' },
    ]).map((g) => g.id),
    ['a'],
  );
  check(
    'two spellings of one link are one tile',
    dedupe([
      { id: 'a', name: 'CS2', target: 'steam://rungameid/730' },
      { id: 'b', name: 'Counter-Strike', target: 'steam://run/730' },
    ]).length,
    1,
  );
  check(
    'and a chain of them collapses the whole way',
    dedupe([
      { id: 'a', name: 'Counter-Strike 2', target: 'steam://rungameid/730' },
      { id: 'b', name: 'Something else', target: 'D:\\cs2.exe', exePath: 'D:\\cs2.exe' },
      { id: 'c', name: 'Counter-Strike 2', target: 'D:\\cs2.exe' },
    ]).map((g) => g.id),
    ['a'],
  );
  {
    const merged = dedupe([
      { id: 'a', name: 'CS2', target: 'steam://rungameid/730', minutes: 10 },
      { id: 'b', name: 'CS2', target: 'x', exePath: 'D:/cs2.exe', minutes: 400, favourite: true, lastPlayed: 7 },
    ])[0];
    check(
      'what the copies knew is kept',
      [merged.id, merged.exePath, merged.favourite, merged.lastPlayed, merged.minutes],
      ['a', 'D:/cs2.exe', true, 7, 400],
    );
  }
  check(
    'play time is the larger of the two, never the sum',
    dedupe([
      { id: 'a', name: 'CS2', target: 'a', minutes: 300 },
      { id: 'b', name: 'CS2', target: 'b', minutes: 200 },
    ])[0].minutes,
    300,
  );
  check(
    'an entry gone from one copy and present in the other is installed',
    dedupe([
      { id: 'a', name: 'CS2', target: 'a', missing: true },
      { id: 'b', name: 'CS2', target: 'b', missing: false },
    ])[0].missing,
    false,
  );
  check(
    'two games that only share a bootstrapper stay two games',
    dedupe([
      { id: 'a', name: 'League of Legends', target: 'C:\\Riot\\RiotClientServices.exe --launch-product=league' },
      { id: 'b', name: 'Valorant', target: 'C:\\Riot\\RiotClientServices.exe --launch-product=valorant' },
    ]).length,
    2,
  );
  check(
    'a demo is not the game',
    dedupe([
      { id: 'a', name: 'Cassette Beasts', target: 'a' },
      { id: 'b', name: 'Cassette Beasts demo', target: 'b' },
    ]).length,
    2,
  );
  check('different games are left alone', dedupe([game('a'), game('b')]).length, 2);

  // --- no game in two rows of the home screen
  {
    const library = [
      game('played-fav', { lastPlayed: 500, favourite: true }),
      game('played', { lastPlayed: 400 }),
      game('fav', { favourite: true }),
      game('plain'),
    ];
    const rows = homeRows(library, { recentCount: 12, split: true });
    check('the rows are named for what they hold', rows.map((r) => r.label), ['Continue playing', 'Favourites', 'Everything else']);
    check('recently played comes first', rows[0].games.map((g) => g.id), ['played-fav', 'played']);
    check('a favourite already shown above is not repeated', rows[1].games.map((g) => g.id), ['fav']);
    check('and the last row is only what is left', rows[2].games.map((g) => g.id), ['plain']);
    check(
      'every game appears exactly once across the screen',
      rows.flatMap((r) => r.games.map((g) => g.id)).sort(),
      ['fav', 'plain', 'played', 'played-fav'],
    );
  }

  check(
    'with nothing played or favourited there is one honest row',
    homeRows([game('a'), game('b')], { recentCount: 12, split: true }).map((r) => r.label),
    ['All games'],
  );
  check(
    'the recent row is capped',
    homeRows(
      [game('a', { lastPlayed: 3 }), game('b', { lastPlayed: 2 }), game('c', { lastPlayed: 1 })],
      { recentCount: 2, split: true },
    )[0].games.length,
    2,
  );
  check(
    'a wrapped layout is one row, not three',
    homeRows([game('a', { lastPlayed: 1, favourite: true })], { recentCount: 12, split: false }).map((r) => r.label),
    ['All games'],
  );

  // --- descriptions
  check('a game is keyed by its name, folded', blurbKey('Hades II'), 'hades ii');
  check('...so punctuation and spacing cannot split one game in two', [blurbKey('Half-Life: Alyx'), blurbKey('half life  alyx')], ['half life alyx', 'half life alyx']);

  check('markdown is stripped out of a caption', cleanBlurb('**A factory** builder.'), 'A factory builder.');
  check('and the quotation marks a model wraps it in', cleanBlurb('"A factory builder."'), 'A factory builder.');
  check('a refusal is not a description', cleanBlurb("I don't recognise this title."), '');
  check('nor is a placeholder', [cleanBlurb('N/A'), cleanBlurb('unknown'), cleanBlurb('   ')], ['', '', '']);
  check('a non-string is not a description either', cleanBlurb(null), '');
  check('an over-long answer is cut at a sentence', cleanBlurb(`${'A '.repeat(60)}end. ${'B '.repeat(60)}`).endsWith('end.'), true);

  {
    const prompt = buildBlurbPrompt([{ key: 'factorio', name: 'Factorio', launcher: 'Steam' }]);
    check('the prompt carries the key the answer must come back under', prompt.user.includes('key: factorio'), true);
    check('...and the store, which disambiguates a shared name', prompt.user.includes('store: Steam'), true);
    check('the model is told an empty string is the right answer', /empty string/.test(prompt.system), true);
  }

  {
    const answer = '```json\n{"games":[{"key":"factorio","text":"Build and automate a factory."},{"key":"setup","text":""}]}\n```';
    const parsed = parseBlurbs(answer, ['factorio', 'setup']);
    check('a fenced answer is read', [parsed.ok, parsed.blurbs.factorio], [true, 'Build and automate a factory.']);
    check('an entry the model did not recognise is left out, not stored', 'setup' in parsed.blurbs, false);
    check('...and reported as unknown', parsed.unknown, ['setup']);
  }

  check(
    'a key the model invented is dropped',
    parseBlurbs('{"games":[{"key":"nope","text":"Something."},{"key":"a","text":"Real."}]}', ['a']).blurbs,
    { a: 'Real.' },
  );
  check(
    'a plain object of key to text is understood too',
    parseBlurbs('{"a":"A game."}', ['a']).blurbs,
    { a: 'A game.' },
  );
  check('an answer that is not JSON is refused', parseBlurbs('sorry, no', ['a']).ok, false);
  check('an answer with nothing recognised is refused', parseBlurbs('{"games":[{"key":"a","text":""}]}', ['a']).ok, false);

  check('the library is asked for in batches', batchGames([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  check('a batch size of zero does not loop for ever', batchGames([1, 2], 0).length, 2);
}

// --------------------------------------------- telling two shortcuts apart
{
  const { distinguishingKey, pickPressed } = await import('../../.test/hotkeys.mjs');

  check('a combination is told apart by its last real key', distinguishingKey(['Win', 'Shift', 'D']), 'D');
  check('...whatever order the modifiers came in', distinguishingKey(['Shift', 'G', 'Win']), 'G');
  check('a combination of modifiers alone tells nothing apart', distinguishingKey(['Win', 'Shift']), null);
  check('nor does an empty one', distinguishingKey([]), null);

  const combos = new Map([
    ['show-desktop', ['Win', 'Shift', 'D']],
    ['game-mode', ['Win', 'Shift', 'G']],
  ]);

  check('the one whose key is down is the one that fired', pickPressed(combos, (k) => k === 'G'), 'game-mode');
  check('...and the other way round', pickPressed(combos, (k) => k === 'D'), 'show-desktop');
  check('nothing down is not an answer', pickPressed(combos, () => false), null);
  check('and neither is everything down', pickPressed(combos, () => true), null);
  check(
    'a shortcut with nothing to tell it apart is never the answer',
    pickPressed(new Map([['a', ['Win', 'Shift']], ['b', ['Win', 'G']]]), (k) => k === 'G'),
    'b',
  );
}

if (failures) {
  console.log(`\n${failures} module check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll module checks passed.');
