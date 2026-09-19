/**
 * The Desktop Surface theme's own settings, for the Appearance dialog's Shell
 * tab - so the dock, the start button and the start menu can be dressed from
 * the desktop instead of from Seelen's Settings window.
 *
 * A theme setting is a CSS variable the host registers with `@property` and
 * stores as a string in `settings.byTheme['@ralfm/surface']`. The table below
 * mirrors `themes/surface/metadata.yml`, which the widget cannot read at
 * runtime; `npm test` checks every name, syntax, range and option against it.
 *
 * The codec is the part that has to be exact. The host stores whatever string
 * it is given and registers the variable by its syntax, so a `<string>` must
 * keep its quotes (a bare `midnight` is an ident, fails to parse, and the
 * preset silently does nothing) and a `<length-percentage>` must keep its unit.
 * `shellstyle.ts` writes the same formats, so a value set here and one synced
 * from the desktop read back identically.
 */

export const THEME_ID = '@ralfm/surface';

export type KnobSyntax = '<string>' | '<number>' | '<color>' | '<length-percentage>' | '<family-name>';

export type KnobGroup = 'palette' | 'glass' | 'shape' | 'type' | 'motion' | 'dock' | 'start' | 'menu';

export const KNOB_GROUPS: readonly { id: KnobGroup; label: string }[] = [
  { id: 'palette', label: 'Palette' },
  { id: 'glass', label: 'Glass' },
  { id: 'shape', label: 'Shape' },
  { id: 'type', label: 'Typography' },
  { id: 'motion', label: 'Motion' },
  { id: 'dock', label: 'Dock' },
  { id: 'start', label: 'Start button' },
  { id: 'menu', label: 'Start menu' },
];

export interface ThemeKnob {
  name: string;
  label: string;
  description?: string;
  group: KnobGroup;
  syntax: KnobSyntax;
  /** The metadata's `initialValue`, as stored. */
  initial: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Unquoted. */
  options?: readonly { value: string; label: string }[];
  /**
   * Written from the desktop's own settings while "Apply to the Seelen shell"
   * is on. Shown only while it is off: an edit here would otherwise be
   * overwritten by the next change to the matching desktop setting.
   */
  synced?: boolean;
}

const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export const THEME_KNOBS: readonly ThemeKnob[] = [
  {
    name: '--rs-preset',
    label: 'Preset',
    description: 'The tint in the glass, while the desktop follows the Seelen theme. A colour scheme replaces it.',
    group: 'palette',
    syntax: '<string>',
    initial: '"monochrome"',
    options: opts(['monochrome', 'Monochrome'], ['midnight', 'Midnight'], ['ember', 'Ember'], ['moss', 'Moss'], ['orchid', 'Orchid']),
  },
  {
    name: '--rs-accent',
    label: 'Accent override',
    description: 'Clear it to follow the preset or the colour scheme.',
    group: 'palette',
    syntax: '<color>',
    initial: 'transparent',
  },
  { name: '--rs-bar-opacity', label: 'Dock and toolbar fill', group: 'glass', syntax: '<number>', initial: '62', min: 0, max: 100, step: 1, unit: '%', synced: true },
  { name: '--rs-panel-opacity', label: 'Popup and menu fill', group: 'glass', syntax: '<number>', initial: '78', min: 0, max: 100, step: 1, unit: '%', synced: true },
  { name: '--rs-overlay-opacity', label: 'Start menu and switcher fill', group: 'glass', syntax: '<number>', initial: '85', min: 0, max: 100, step: 1, unit: '%', synced: true },
  { name: '--rs-frost', label: 'Frosted texture', group: 'glass', syntax: '<number>', initial: '100', min: 0, max: 150, step: 5, unit: '%', synced: true },
  // The three lengths have no range in the metadata; these are the ranges the desktop's own settings use.
  { name: '--rs-blur', label: 'Backdrop blur', group: 'glass', syntax: '<length-percentage>', initial: '14', min: 0, max: 48, step: 1, unit: 'px', synced: true },
  { name: '--rs-radius', label: 'Corner radius', group: 'shape', syntax: '<length-percentage>', initial: '20', min: 0, max: 36, step: 1, unit: 'px', synced: true },
  { name: '--rs-edge', label: 'Edge line strength', group: 'shape', syntax: '<number>', initial: '34', min: 0, max: 100, step: 1, unit: '%', synced: true },
  { name: '--rs-font-family', label: 'Interface font', group: 'type', syntax: '<family-name>', initial: '"Segoe UI Variable Text"', synced: true },
  { name: '--rs-font-size', label: 'Base text size', group: 'type', syntax: '<length-percentage>', initial: '14', min: 10, max: 18, step: 1, unit: 'px', synced: true },
  { name: '--rs-density', label: 'Density', group: 'type', syntax: '<number>', initial: '1', min: 0.6, max: 1.6, step: 0.05, unit: '×', synced: true },
  { name: '--rs-motion', label: 'Animation speed', description: '1 is the tuned pace, 0 stops motion, 2 takes twice as long.', group: 'motion', syntax: '<number>', initial: '1', min: 0, max: 2, step: 0.05, unit: '×', synced: true },
  {
    name: '--rs-motion-style',
    label: 'Animation style',
    group: 'motion',
    syntax: '<string>',
    initial: '"fluid"',
    options: opts(['fluid', 'Fluid'], ['spring', 'Spring'], ['snappy', 'Snappy'], ['gentle', 'Gentle']),
  },
  { name: '--rs-stagger', label: 'List stagger', group: 'motion', syntax: '<number>', initial: '1', min: 0, max: 3, step: 0.1, unit: '×', synced: true },
  { name: '--rs-entrance-blur', label: 'Entrance blur', description: 'Panels come into focus from this much blur as they arrive.', group: 'motion', syntax: '<number>', initial: '3', min: 0, max: 12, step: 1, unit: 'px' },
  { name: '--rs-dock-zoom', label: 'Magnification', description: 'How much a dock icon grows under the pointer.', group: 'dock', syntax: '<number>', initial: '14', min: 0, max: 40, step: 1, unit: '%' },
  { name: '--rs-dock-lift', label: 'Hover lift', group: 'dock', syntax: '<number>', initial: '5', min: 0, max: 16, step: 1, unit: 'px' },
  {
    name: '--rs-start-icon',
    label: 'Icon',
    group: 'start',
    syntax: '<string>',
    initial: '"surface"',
    options: opts(['surface', 'Surface'], ['orbit', 'Orbit'], ['petal', 'Petal'], ['spark', 'Spark'], ['windows', 'Windows'], ['pack', 'From the icon pack']),
  },
  { name: '--rs-start-color', label: 'Icon colour', description: 'Clear it to use the ink.', group: 'start', syntax: '<color>', initial: 'transparent' },
  {
    name: '--rs-start-finish',
    label: 'Icon finish',
    group: 'start',
    syntax: '<string>',
    initial: '"glass"',
    options: opts(['flat', 'Flat'], ['glass', 'Glass'], ['duotone', 'Duotone']),
  },
  { name: '--rs-start-size', label: 'Icon size', group: 'start', syntax: '<number>', initial: '70', min: 30, max: 100, step: 1, unit: '%' },
  { name: '--rs-start-glow', label: 'Glow', group: 'start', syntax: '<number>', initial: '40', min: 0, max: 100, step: 5, unit: '%' },
  {
    name: '--rs-start-hover',
    label: 'Hover animation',
    group: 'start',
    syntax: '<string>',
    initial: '"spin"',
    options: opts(['spin', 'Spin'], ['tilt', 'Tilt'], ['pulse', 'Pulse'], ['bloom', 'Bloom'], ['none', 'None']),
  },
  {
    name: '--rs-menu-layout',
    label: 'Layout',
    group: 'menu',
    syntax: '<string>',
    initial: '"rail"',
    options: opts(['rail', 'Rail'], ['classic', 'Classic']),
  },
  {
    name: '--rs-menu-position',
    label: 'Position',
    group: 'menu',
    syntax: '<string>',
    initial: '"center"',
    options: opts(['center', 'Centre'], ['bottom', 'Bottom'], ['top', 'Top']),
  },
  { name: '--rs-menu-offset', label: 'Edge offset', group: 'menu', syntax: '<number>', initial: '96', min: 0, max: 400, step: 2, unit: 'px' },
  { name: '--rs-menu-width', label: 'Width', group: 'menu', syntax: '<number>', initial: '860', min: 480, max: 1600, step: 10, unit: 'px' },
  { name: '--rs-menu-height', label: 'Height', group: 'menu', syntax: '<number>', initial: '560', min: 320, max: 1200, step: 10, unit: 'px' },
  { name: '--rs-tile-size', label: 'Tile size', group: 'menu', syntax: '<number>', initial: '88', min: 64, max: 140, step: 2, unit: 'px' },
  {
    name: '--rs-menu-entrance',
    label: 'Entrance',
    group: 'menu',
    syntax: '<string>',
    initial: '"rise"',
    options: opts(['rise', 'Rise'], ['drop', 'Drop'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['fade', 'Fade']),
  },
];

/** Theme variables the desktop writes for itself and nobody edits by hand. */
export const THEME_INTERNAL = /^--rs-(tint|scheme)/;

export function knobByName(name: string): ThemeKnob | undefined {
  return THEME_KNOBS.find((knob) => knob.name === name);
}

/** A stored value, as the dialog shows it: a number, a colour, or an unquoted string. */
export function decodeKnob(knob: ThemeKnob, stored: string | undefined): string | number {
  const raw = (stored ?? knob.initial).trim();
  switch (knob.syntax) {
    case '<string>':
      return raw.replace(/^(['"])(.*)\1$/, '$2');
    case '<family-name>': {
      const family = raw.replace(/^(['"])(.*)\1$/, '$2');
      return family === 'system-ui' ? '' : family;
    }
    case '<number>':
    case '<length-percentage>': {
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : parseFloat(knob.initial) || 0;
    }
    case '<color>':
      return raw;
  }
}

/** The string to store for a value the dialog produced. */
export function encodeKnob(knob: ThemeKnob, value: string | number): string {
  switch (knob.syntax) {
    case '<string>':
      return `"${String(value).replace(/["\\]/g, '')}"`;
    case '<family-name>': {
      const clean = String(value).replace(/["';{}\\]/g, '').trim();
      return clean ? `"${clean}"` : 'system-ui';
    }
    case '<number>':
      return String(Number(value));
    case '<length-percentage>':
      return `${Number(value)}px`;
    case '<color>':
      return String(value).trim() || 'transparent';
  }
}

/**
 * Only the settings a person set, for an exported appearance: internal ones
 * are the desktop's to write, and an unknown name is from some other build.
 */
export function shareableShell(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([name]) => !THEME_INTERNAL.test(name) && knobByName(name)));
}
