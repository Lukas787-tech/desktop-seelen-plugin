/**
 * What a controller is, in the abstract: which physical control is which, what
 * it is called on the pad in the user's hands, and how a stick's raw pair of
 * floats becomes a direction.
 *
 * Deliberately pure and free of Svelte, the host and the DOM. The live reader
 * that polls `navigator.getGamepads()` is `gamepad.svelte.ts`; everything here
 * is table lookup and arithmetic, so it is covered by `npm test` rather than by
 * plugging a controller in and hoping.
 *
 * The whole file speaks the W3C *standard mapping*, which is what every XInput
 * pad, every DualSense and every Switch Pro controller reports through WebView2:
 * a fixed 17-button, 4-axis layout. A pad that reports `mapping: ""` is not
 * standard and is described in `RAW_FALLBACK` instead.
 */

/** Every control in the standard mapping, by what it does rather than by index. */
export type PadButton =
  | 'south'
  | 'east'
  | 'west'
  | 'north'
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  | 'select'
  | 'start'
  | 'l3'
  | 'r3'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'guide';

/**
 * Button index to name, in standard-mapping order.
 *
 * The face buttons are named by *position* - south, east, west, north - and not
 * by letter, because the letter moves: index 0 is A on an Xbox pad, Cross on a
 * DualSense and B on a Switch Pro. Naming the position means one binding table
 * works for every pad, and only the glyph shown to the user changes.
 */
export const BUTTON_ORDER: readonly PadButton[] = [
  'south',
  'east',
  'west',
  'north',
  'l1',
  'r1',
  'l2',
  'r2',
  'select',
  'start',
  'l3',
  'r3',
  'up',
  'down',
  'left',
  'right',
  'guide',
];

/** The four directions of the d-pad, so a caller can treat them as one control. */
export const DPAD: readonly PadButton[] = ['up', 'down', 'left', 'right'];

/** Buttons that are really analogue triggers, and are read as such. */
export const TRIGGERS: readonly PadButton[] = ['l2', 'r2'];

export type PadLayout = 'auto' | 'xbox' | 'playstation' | 'nintendo' | 'generic';

export const LAYOUT_OPTIONS: readonly { label: string; value: PadLayout }[] = [
  { label: 'Detect from the pad', value: 'auto' },
  { label: 'Xbox', value: 'xbox' },
  { label: 'PlayStation', value: 'playstation' },
  { label: 'Nintendo', value: 'nintendo' },
  { label: 'Generic', value: 'generic' },
];

/** What each control is called and drawn as, per family. */
type Faces = Record<PadButton, string>;

const SHARED: Pick<Faces, 'up' | 'down' | 'left' | 'right' | 'l3' | 'r3'> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  l3: 'L3',
  r3: 'R3',
};

const FACES: Record<Exclude<PadLayout, 'auto'>, Faces> = {
  xbox: {
    ...SHARED,
    south: 'A',
    east: 'B',
    west: 'X',
    north: 'Y',
    l1: 'LB',
    r1: 'RB',
    l2: 'LT',
    r2: 'RT',
    select: 'View',
    start: 'Menu',
    guide: 'Guide',
  },
  playstation: {
    ...SHARED,
    south: '✕',
    east: '○',
    west: '□',
    north: '△',
    l1: 'L1',
    r1: 'R1',
    l2: 'L2',
    r2: 'R2',
    select: 'Create',
    start: 'Options',
    guide: 'PS',
  },
  // The Switch Pro pad puts A where an Xbox pad puts B, so the *positions* hold
  // and only the letters move - which is exactly what naming them by position
  // was for.
  nintendo: {
    ...SHARED,
    south: 'B',
    east: 'A',
    west: 'Y',
    north: 'X',
    l1: 'L',
    r1: 'R',
    l2: 'ZL',
    r2: 'ZR',
    select: '−',
    start: '+',
    guide: 'Home',
  },
  generic: {
    ...SHARED,
    south: '1',
    east: '2',
    west: '3',
    north: '4',
    l1: 'L1',
    r1: 'R1',
    l2: 'L2',
    r2: 'R2',
    select: 'Select',
    start: 'Start',
    guide: 'Home',
  },
};

/**
 * Which family a pad belongs to, read from the id string the runtime reports.
 *
 * The id is free text - `Xbox 360 Controller (XInput STANDARD GAMEPAD)`,
 * `Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)` - so the
 * vendor id is looked for first, being the one part of it that is a fact, and
 * the marketing names are the fallback.
 */
export function detectLayout(id: string): Exclude<PadLayout, 'auto'> {
  const text = id.toLowerCase();
  const vendor = /vendor:\s*([0-9a-f]{4})/i.exec(text)?.[1];
  if (vendor === '054c') return 'playstation';
  if (vendor === '057e') return 'nintendo';
  if (vendor === '045e') return 'xbox';
  if (/dualsense|dualshock|playstation|\bps[345]\b|sony/.test(text)) return 'playstation';
  if (/switch|joy-?con|nintendo|pro controller/.test(text)) return 'nintendo';
  if (/xbox|xinput|microsoft/.test(text)) return 'xbox';
  return 'generic';
}

/**
 * The layout to draw with: the user's choice, or what the pad says it is.
 *
 * With nothing plugged in there is no id to read, and the hints are still worth
 * showing - the button list in the settings and the legend along the bottom of
 * the launcher both have to say *something* before a controller arrives. Xbox
 * rather than `generic`, because A/B/X/Y is what almost every pad sold for
 * Windows is lettered, and "press 1 to play" would be a worse guess than a
 * wrong-but-familiar one.
 */
export function resolveLayout(setting: PadLayout, id: string): Exclude<PadLayout, 'auto'> {
  if (setting !== 'auto') return setting;
  return id.trim() ? detectLayout(id) : 'xbox';
}

/** What to print on a button hint, e.g. `A`, `✕`, `RB`. */
export function glyphFor(button: PadButton, layout: Exclude<PadLayout, 'auto'>): string {
  return FACES[layout][button];
}

/** The same, spelled out for a settings row: `A button`, `Left bumper`. */
export function labelFor(button: PadButton, layout: Exclude<PadLayout, 'auto'>): string {
  const glyph = glyphFor(button, layout);
  if (DPAD.includes(button)) return `D-pad ${button}`;
  if (button === 'l3' || button === 'r3') return `${glyph} (stick click)`;
  return glyph;
}

/* ------------------------------------------------------------- bindings -- */

/**
 * What the surface can be asked to do with a controller.
 *
 * Navigation is four directions rather than a stick, because the d-pad, the
 * left stick and - when the user asks for it - the right stick all end up here.
 */
export type PadAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'details'
  | 'favourite'
  | 'search'
  | 'menu'
  | 'sectionPrev'
  | 'sectionNext'
  | 'pageUp'
  | 'pageDown'
  | 'quit';

export const ACTION_ORDER: readonly PadAction[] = [
  'confirm',
  'back',
  'details',
  'favourite',
  'search',
  'menu',
  'sectionPrev',
  'sectionNext',
  'pageUp',
  'pageDown',
  'quit',
];

export const ACTION_LABELS: Record<PadAction, string> = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  confirm: 'Play / choose',
  back: 'Back',
  details: 'Details',
  favourite: 'Favourite',
  search: 'Search',
  menu: 'Menu',
  sectionPrev: 'Previous section',
  sectionNext: 'Next section',
  pageUp: 'Jump up',
  pageDown: 'Jump down',
  quit: 'Leave game mode',
};

export type Bindings = Record<PadAction, PadButton>;

/**
 * The console convention: south confirms, east goes back.
 *
 * It is stated in *positions*, so it is already right on a Switch Pro pad,
 * where the button under the thumb happens to be lettered B - which is the
 * button a Switch user presses to confirm.
 */
export const DEFAULT_BINDINGS: Bindings = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  confirm: 'south',
  back: 'east',
  details: 'north',
  favourite: 'west',
  search: 'l3',
  menu: 'select',
  sectionPrev: 'l1',
  sectionNext: 'r1',
  pageUp: 'l2',
  pageDown: 'r2',
  quit: 'start',
};

const BUTTONS = new Set<string>(BUTTON_ORDER);
const ACTIONS = new Set<string>([...ACTION_ORDER, 'up', 'down', 'left', 'right']);

/**
 * Reads the stored binding string, e.g. `confirm=south,back=east`.
 *
 * Stored as text rather than as JSON because it is one widget setting, edited
 * in a text field by anyone who wants to, and a malformed pair must cost that
 * pair and nothing else - an unparseable JSON blob would cost every binding at
 * once and leave the pad dead.
 */
export function parseBindings(text: string): Bindings {
  const bindings: Bindings = { ...DEFAULT_BINDINGS };
  for (const pair of text.split(/[,\n;]/)) {
    const [rawAction, rawButton] = pair.split('=').map((part) => part.trim().toLowerCase());
    if (!rawAction || !rawButton) continue;
    if (!ACTIONS.has(rawAction) || !BUTTONS.has(rawButton)) continue;
    bindings[rawAction as PadAction] = rawButton as PadButton;
  }
  return bindings;
}

/** Only what differs from the defaults, so the stored string stays readable. */
export function formatBindings(bindings: Bindings): string {
  return ACTION_ORDER.filter((action) => bindings[action] !== DEFAULT_BINDINGS[action])
    .map((action) => `${action}=${bindings[action]}`)
    .join(', ');
}

/**
 * Which action a button press means, if any.
 *
 * A button may legitimately be bound twice - `back` and `quit` on the same
 * button is a reasonable thing to want - so this answers with every match and
 * lets the caller decide, rather than silently dropping one.
 */
export function actionsFor(button: PadButton, bindings: Bindings): PadAction[] {
  const found: PadAction[] = [];
  for (const [action, bound] of Object.entries(bindings) as [PadAction, PadButton][]) {
    if (bound === button) found.push(action);
  }
  return found;
}

/* ---------------------------------------------------------------- sticks -- */

/**
 * One axis, with its dead zone removed and its response shaped.
 *
 * The dead zone is not merely a threshold: a stick that reports 0.31 with a
 * dead zone of 0.30 must move *slowly*, not jump to 31% speed, so what is left
 * is rescaled back across the full range. `curve` then shapes it - 1 is linear,
 * above 1 gives fine control near the centre, which is what a pointer wants.
 */
export function axisValue(raw: number, deadzone: number, curve = 1): number {
  const magnitude = Math.abs(raw);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  const shaped = curve === 1 ? scaled : Math.pow(scaled, curve);
  return Math.sign(raw) * Math.min(1, shaped);
}

export interface StickVector {
  x: number;
  y: number;
  /** 0..1 once the dead zone is out, which is what a pointer's speed follows. */
  magnitude: number;
}

/**
 * Both axes of one stick, dead-zoned *radially*.
 *
 * Per-axis dead zones leave a square hole at the centre, so a stick pushed
 * diagonally by a hair registers on both axes while the same push straight up
 * registers on neither. Taking the magnitude first gives the round hole the
 * hardware actually has.
 */
export function stickVector(
  rawX: number,
  rawY: number,
  deadzone: number,
  curve = 1,
): StickVector {
  const length = Math.hypot(rawX, rawY);
  if (length <= deadzone || length === 0) return { x: 0, y: 0, magnitude: 0 };
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  const magnitude = curve === 1 ? scaled : Math.pow(scaled, curve);
  return { x: (rawX / length) * magnitude, y: (rawY / length) * magnitude, magnitude };
}

/**
 * A stick read as a d-pad.
 *
 * The threshold is deliberately well above the dead zone, and the dominant axis
 * wins outright: a menu that moved diagonally - one step across *and* one step
 * down from a single lazy push - is the thing this prevents.
 */
export function stickDirection(
  rawX: number,
  rawY: number,
  threshold: number,
): 'up' | 'down' | 'left' | 'right' | null {
  const { x, y, magnitude } = stickVector(rawX, rawY, threshold);
  if (!magnitude) return null;
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/* --------------------------------------------------------------- repeat -- */

/**
 * How many times a held direction should have fired by now.
 *
 * A console menu repeats on a hold, and it accelerates: the first repeat waits
 * out `delayMs` so a tap is unambiguously one step, then they come every
 * `intervalMs`, closing to `minIntervalMs` as the hold goes on so a long list
 * can be crossed without letting go.
 *
 * Expressed as a total count rather than as a timer so the caller only has to
 * remember when the hold started - no per-key timers to cancel, and a frame
 * that arrives late fires the steps it owes rather than losing them.
 */
export function repeatsBy(
  heldMs: number,
  delayMs: number,
  intervalMs: number,
  minIntervalMs = intervalMs,
  rampMs = 1200,
): number {
  if (heldMs < 0) return 0;
  // The press itself.
  let count = 1;
  if (heldMs < delayMs || intervalMs <= 0) return count;

  let at = delayMs;
  let step = intervalMs;
  // Walked rather than solved: the interval shortens with each repeat, and the
  // number of them over a realistic hold is small enough that a loop is both
  // exact and cheaper to be sure of than the closed form.
  while (at <= heldMs && count < 4096) {
    count++;
    at += step;
    if (rampMs > 0 && minIntervalMs < intervalMs) {
      const through = Math.min(1, (at - delayMs) / rampMs);
      step = intervalMs + (minIntervalMs - intervalMs) * through;
    }
  }
  return count;
}

/* ------------------------------------------------------------ raw pads -- */

/**
 * A pad that does not report the standard mapping.
 *
 * Rare on Windows, where anything XInput arrives mapped, but a DirectInput-only
 * stick or an adapter can come through with `mapping: ""` and its own button
 * order. Nothing can be assumed about it, so rather than guess wrong the first
 * sixteen buttons are taken in the order they arrive - which is right often
 * enough to be usable, and the settings dialog says so.
 */
export const RAW_FALLBACK: readonly PadButton[] = BUTTON_ORDER;

/** The button at a raw index, for a pad with no standard mapping. */
export function buttonAt(index: number, standard: boolean): PadButton | null {
  const table = standard ? BUTTON_ORDER : RAW_FALLBACK;
  return table[index] ?? null;
}
