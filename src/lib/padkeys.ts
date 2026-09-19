/**
 * Controller-to-keyboard translation: what a button press is turned *into*.
 *
 * ## What this can and cannot reach
 *
 * The surface is a webview. It can synthesise a key press into its own
 * document, and that is genuinely useful - every module on the desktop is
 * already built to be driven by a keyboard, so translating the pad into keys is
 * what makes the notes panel, the calculator, the browser module and the
 * assistant work from the sofa without writing a controller path into each of
 * them.
 *
 * It cannot reach *other* applications. Synthesising input for another window
 * means `SendInput`, which is a Win32 call; Seelen's command surface has no
 * equivalent (see `SeelenCommand` - there is `Run`, `OpenFile` and focus, and
 * nothing that types), and a webview cannot make the call itself. So a game's
 * own keyboard controls are outside what this does, and the settings dialog
 * says so rather than letting the name imply otherwise.
 *
 * Pure and DOM-free: parsing and tables only. `gamemode.svelte.ts` is what
 * actually dispatches the events this file describes.
 */

import { BUTTON_ORDER, type PadButton } from './gamepad';

/** A key press to synthesise, in the shape `KeyboardEvent`'s constructor takes. */
export interface KeyStroke {
  key: string;
  code: string;
  /** Legacy `keyCode`, which plenty of handlers still read. */
  keyCode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Everything a button can be turned into. */
export type PadTarget =
  | { kind: 'key'; stroke: KeyStroke; label: string }
  | { kind: 'click'; button: 0 | 1 | 2; label: string }
  | { kind: 'scroll'; dx: number; dy: number; label: string }
  | { kind: 'none'; label: string };

/**
 * The named keys, with the `code` and `keyCode` each one carries.
 *
 * Written out rather than derived because there is no rule connecting the
 * three: `Escape` is code `Escape` and keyCode 27, `ArrowUp` is `ArrowUp` and
 * 38, and a letter's code is `KeyW` while its key is the lower-case letter.
 */
const NAMED: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
};

/** `keyCode` for the punctuation a binding is likely to name. */
const PUNCTUATION: Record<string, { code: string; keyCode: number }> = {
  '-': { code: 'Minus', keyCode: 189 },
  '=': { code: 'Equal', keyCode: 187 },
  '[': { code: 'BracketLeft', keyCode: 219 },
  ']': { code: 'BracketRight', keyCode: 221 },
  ';': { code: 'Semicolon', keyCode: 186 },
  "'": { code: 'Quote', keyCode: 222 },
  ',': { code: 'Comma', keyCode: 188 },
  '.': { code: 'Period', keyCode: 190 },
  '/': { code: 'Slash', keyCode: 191 },
  '\\': { code: 'Backslash', keyCode: 220 },
  '`': { code: 'Backquote', keyCode: 192 },
};

function blank(): Omit<KeyStroke, 'key' | 'code' | 'keyCode'> {
  return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
}

/**
 * Reads one binding, e.g. `ctrl+shift+f5`, `enter`, `w`, `f11`.
 *
 * Returns null for anything it does not recognise, so a typo costs that one
 * binding rather than the profile.
 */
export function parseStroke(text: string): KeyStroke | null {
  const parts = text
    .trim()
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const modifiers = blank();
  // The last part is the key; everything before it modifies. A binding that is
  // *only* modifiers has no key to press and is refused below.
  const keyName = parts.pop() as string;
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') modifiers.ctrlKey = true;
    else if (part === 'shift') modifiers.shiftKey = true;
    else if (part === 'alt') modifiers.altKey = true;
    else if (part === 'win' || part === 'meta' || part === 'cmd') modifiers.metaKey = true;
    else return null;
  }

  const named = NAMED[keyName];
  if (named) return { ...named, ...modifiers };

  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(keyName);
  if (fn) {
    const n = Number(fn[1]);
    return { key: `F${n}`, code: `F${n}`, keyCode: 111 + n, ...modifiers };
  }

  if (/^[a-z]$/.test(keyName)) {
    const upper = keyName.toUpperCase();
    return {
      key: modifiers.shiftKey ? upper : keyName,
      code: `Key${upper}`,
      keyCode: upper.charCodeAt(0),
      ...modifiers,
    };
  }

  if (/^[0-9]$/.test(keyName)) {
    return {
      key: keyName,
      code: `Digit${keyName}`,
      keyCode: keyName.charCodeAt(0),
      ...modifiers,
    };
  }

  const punctuation = PUNCTUATION[keyName];
  if (punctuation) return { key: keyName, ...punctuation, ...modifiers };

  return null;
}

/** The binding written back out, for a settings row: `Ctrl + Shift + F5`. */
export function formatStroke(stroke: KeyStroke): string {
  const parts: string[] = [];
  if (stroke.ctrlKey) parts.push('Ctrl');
  if (stroke.altKey) parts.push('Alt');
  if (stroke.shiftKey) parts.push('Shift');
  if (stroke.metaKey) parts.push('Win');
  parts.push(stroke.key === ' ' ? 'Space' : stroke.key.length === 1 ? stroke.key.toUpperCase() : stroke.key);
  return parts.join(' + ');
}

/** Reads one right-hand side: a key, a mouse click, a scroll, or nothing. */
export function parseTarget(text: string): PadTarget | null {
  const value = text.trim().toLowerCase();
  if (!value || value === 'none' || value === '-') return { kind: 'none', label: '—' };

  if (value === 'click' || value === 'lmb' || value === 'mouse1') {
    return { kind: 'click', button: 0, label: 'Left click' };
  }
  if (value === 'rightclick' || value === 'rmb' || value === 'mouse2') {
    return { kind: 'click', button: 2, label: 'Right click' };
  }
  if (value === 'middleclick' || value === 'mmb' || value === 'mouse3') {
    return { kind: 'click', button: 1, label: 'Middle click' };
  }

  const scroll = /^scroll(up|down|left|right)$/.exec(value);
  if (scroll) {
    const deltas: Record<'up' | 'down' | 'left' | 'right', { dx: number; dy: number }> = {
      up: { dx: 0, dy: -1 },
      down: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 },
      right: { dx: 1, dy: 0 },
    };
    const { dx, dy } = deltas[scroll[1] as 'up' | 'down' | 'left' | 'right'];
    return { kind: 'scroll', dx, dy, label: `Scroll ${scroll[1]}` };
  }

  const stroke = parseStroke(value);
  return stroke ? { kind: 'key', stroke, label: formatStroke(stroke) } : null;
}

export type TranslationPreset = 'navigation' | 'arrows' | 'wasd' | 'mouse' | 'custom';

export const PRESET_OPTIONS: readonly { label: string; value: TranslationPreset }[] = [
  { label: 'Menu navigation', value: 'navigation' },
  { label: 'Arrow keys', value: 'arrows' },
  { label: 'WASD', value: 'wasd' },
  { label: 'Mouse and scroll', value: 'mouse' },
  { label: 'Custom', value: 'custom' },
];

type Profile = Partial<Record<PadButton, string>>;

/**
 * The ready-made profiles.
 *
 * `navigation` is the one that matters: it is what turns the pad into the
 * keyboard the surface's own modules already understand - Tab and Shift+Tab to
 * walk the focusable controls, Enter to press one, Escape to close. A user who
 * wants something else has the other three and a text field.
 */
export const PRESETS: Record<Exclude<TranslationPreset, 'custom'>, Profile> = {
  navigation: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    south: 'enter',
    east: 'escape',
    west: 'backspace',
    north: 'space',
    l1: 'shift+tab',
    r1: 'tab',
    l2: 'pageup',
    r2: 'pagedown',
    select: 'home',
    start: 'end',
    l3: 'click',
    r3: 'rightclick',
  },
  arrows: {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    south: 'enter',
    east: 'escape',
    west: 'backspace',
    north: 'space',
    l1: 'pageup',
    r1: 'pagedown',
    l2: 'home',
    r2: 'end',
    select: 'tab',
    start: 'escape',
  },
  wasd: {
    up: 'w',
    down: 's',
    left: 'a',
    right: 'd',
    south: 'space',
    east: 'ctrl+c',
    west: 'r',
    north: 'e',
    l1: 'q',
    r1: 'f',
    l2: 'shift+tab',
    r2: 'tab',
    select: 'escape',
    start: 'enter',
  },
  mouse: {
    up: 'scrollup',
    down: 'scrolldown',
    left: 'scrollleft',
    right: 'scrollright',
    south: 'click',
    east: 'escape',
    west: 'middleclick',
    north: 'rightclick',
    l1: 'shift+tab',
    r1: 'tab',
    l2: 'pageup',
    r2: 'pagedown',
    select: 'home',
    start: 'end',
  },
};

export type Translation = Partial<Record<PadButton, PadTarget>>;

const KNOWN = new Set<string>(BUTTON_ORDER);

/** Turns a profile's text values into targets, dropping any that do not read. */
function compile(profile: Profile): Translation {
  const out: Translation = {};
  for (const [button, text] of Object.entries(profile)) {
    if (!KNOWN.has(button) || !text) continue;
    const target = parseTarget(text);
    if (target) out[button as PadButton] = target;
  }
  return out;
}

/**
 * The translation in force: a preset, with the user's own overrides on top.
 *
 * The overrides apply to every preset rather than only to `custom`, so
 * "navigation, but the north button is F5" needs one line in the field instead
 * of a whole profile written out by hand.
 */
export function buildTranslation(preset: TranslationPreset, overrides: string): Translation {
  const base = preset === 'custom' ? {} : PRESETS[preset];
  const compiled = compile(base);
  for (const pair of overrides.split(/[,\n;]/)) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const button = pair.slice(0, at).trim().toLowerCase();
    const value = pair.slice(at + 1).trim();
    if (!KNOWN.has(button)) continue;
    const target = parseTarget(value);
    if (target) compiled[button as PadButton] = target;
  }
  return compiled;
}
