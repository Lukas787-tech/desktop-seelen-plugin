import type { DesktopConfig } from './config.svelte';
import type { ModuleField } from './modules';
import { APPEARANCE_FIELDS } from './appearance-fields';
import { paletteFor } from './schemes';
import { THEME_KNOBS, decodeKnob, encodeKnob, type ThemeKnob } from './shell-theme';

/**
 * The AI appearance designer's pure half: what a model is told it may set, and
 * how its answer is turned back into settings.
 *
 * A model asked for JSON cannot be trusted to give exactly that - a fence round
 * it, a colour as a word, a radius as "16px", a font that is not installed, an
 * option that does not exist. So everything it returns is coerced against the
 * same declarations the dialog's own controls use: an option must be one of the
 * options, a number is clamped to the slider's range and snapped to its step, a
 * colour must be hex, a font must be installed. What cannot be made valid is
 * dropped and named, never written - a settings file holding a string where a
 * number belongs breaks every control that reads it.
 *
 * Kept free of Svelte, the host and the network so `npm test` can drive it.
 */

/** About how the desktop is used rather than how it looks: never the designer's to change. */
const NOT_FOR_THE_DESIGNER = new Set<string>([
  'fontSize',
  'followTheme',
  'animations',
  'styleShell',
  'gridSize',
  'snapToGrid',
  'lockLayout',
  'iconSize',
  'labelMode',
  'wallpaperEnabled',
  'wallpaperFit',
  'wallpaperMuted',
  'wallpaperPauseWhenCovered',
  'slideshowEnabled',
  'slideshowInterval',
  'slideshowRandomize',
]);

/** Every desktop setting a design may touch. */
export const VIBE_FIELDS: readonly ModuleField[] = Object.values(APPEARANCE_FIELDS)
  .flat()
  .filter((def) => !NOT_FOR_THE_DESIGNER.has(def.key));

/**
 * The shell settings a design may touch: the dock's and the start menu's own,
 * and - only while the shell is not following the desktop - the ones it would
 * otherwise follow. The palette is left to the colour scheme, which reaches the
 * shell by itself.
 */
export function vibeKnobs(styleShell: boolean): ThemeKnob[] {
  return THEME_KNOBS.filter((knob) => knob.group !== 'palette' && (!knob.synced || !styleShell));
}

/** Prompts that show what the designer is for; the dialog offers them as chips. */
export const VIBE_EXAMPLES: readonly string[] = [
  'Rainy café in Tokyo at night',
  'Clean Scandinavian morning',
  'Windows 95, but pastel',
  'Neon cyberpunk alley',
  'Cosy autumn cabin',
  'Deep ocean bioluminescence',
  'Hacker terminal, green on black',
  'Soft Ghibli meadow',
  'Brutalist concrete gallery',
  'Vaporwave sunset',
  'Monochrome e-ink reader',
  'Luxury black and gold',
];

/* ------------------------------------------------------------ the prompt -- */

function describeField(def: ModuleField): string {
  switch (def.type) {
    case 'switch':
      return 'true | false';
    case 'range':
    case 'number':
      return `number ${def.min ?? ''}..${def.max ?? ''}${def.step ? ` step ${def.step}` : ''}${def.unit ? ` ${def.unit.trim()}` : ''}`;
    case 'select': {
      const values = (def.options ?? []).map((o) =>
        def.key === 'colorScheme' && paletteFor(o.value)?.dark === false ? `${o.value} (light)` : o.value,
      );
      return `one of ${values.join(' | ')}`;
    }
    case 'color':
      return '"#rrggbb"';
    case 'font':
      return 'installed font name, or "" for the default';
    default:
      return 'text';
  }
}

function describeKnob(knob: ThemeKnob): string {
  if (knob.options) return `one of ${knob.options.map((o) => o.value).join(' | ')}`;
  switch (knob.syntax) {
    case '<color>':
      return '"#rrggbb", or "transparent" for automatic';
    case '<family-name>':
      return 'installed font name, or "" for the default';
    default:
      return `number ${knob.min ?? ''}..${knob.max ?? ''}${knob.step ? ` step ${knob.step}` : ''}${knob.unit ? ` ${knob.unit}` : ''}`;
  }
}

export interface VibeRequest {
  prompt: string;
  /** Change the current design rather than make one from nothing. */
  adjust: boolean;
  /** The desktop's current values, for an adjustment. */
  current: Partial<Record<string, unknown>>;
  /** The theme's stored values, for an adjustment. */
  currentShell: Record<string, string>;
  /** Installed families; empty when they could not be listed. */
  fonts: readonly string[];
  /** Whether the shell follows the desktop, which decides which shell settings are free. */
  styleShell: boolean;
  /** Whether to design the dock and start menu too. */
  includeShell: boolean;
}

const FONT_LIMIT = 250;

export function buildVibePrompt(req: VibeRequest): { system: string; user: string } {
  const knobs = req.includeShell ? vibeKnobs(req.styleShell) : [];
  const fonts = req.fonts.length
    ? req.fonts.slice(0, FONT_LIMIT).join('; ')
    : 'could not be listed; use only fonts every Windows PC has: Segoe UI Variable Text, Bahnschrift, Cascadia Code, Consolas, Georgia, Tahoma, Trebuchet MS, Verdana';

  const system = [
    `You design the look of a Windows desktop: translucent widget panels floating over the wallpaper${
      knobs.length ? ', plus a Seelen UI dock, start button and start menu' : ''
    }.`,
    'The user describes a vibe. Choose settings that express it clearly and hold together as one design.',
    '',
    'Answer with one JSON object and nothing else:',
    `{"name": "a 2-4 word name", "summary": "one sentence on what you chose", "desktop": {"setting": value}${
      knobs.length ? ', "shell": {"--variable": value}' : ''
    }}`,
    '',
    'Rules:',
    '- Use only the settings listed below, each with a value in its listed form. Numbers are JSON numbers; colours are "#rrggbb" strings.',
    '- Decide the colour first: a colorScheme that fits the vibe, or "custom" with schemeGround, schemeInk, accentColor and accentColor2. Then make the panels, edges, shadow, type, controls and motion agree with it.',
    '- Keep text readable: a light ground needs dark ink, a dark ground light ink. Keep panelOpacity at 55 or more unless the vibe asks for glass, clarity or minimalism.',
    '- Fonts must be exact names from the installed list, or "" for the default. Change a font only when the vibe calls for a distinct typeface.',
    req.adjust
      ? '- You are adjusting the current design: include only the settings you change.'
      : '- Include every setting that shapes the vibe; anything you leave out goes back to its default.',
    '',
    'Desktop settings:',
    ...VIBE_FIELDS.map((def) => `- ${def.key}: ${describeField(def)} (${def.label}${def.description ? `: ${def.description}` : ''})`),
    ...(knobs.length
      ? [
          '',
          'Shell settings, keyed by CSS variable:',
          ...knobs.map((knob) => `- ${knob.name}: ${describeKnob(knob)} (${knob.label}${knob.description ? `: ${knob.description}` : ''})`),
        ]
      : []),
    '',
    `Installed fonts: ${fonts}`,
  ].join('\n');

  if (!req.adjust) return { system, user: `Vibe: ${req.prompt.trim()}` };

  const desktop = Object.fromEntries(VIBE_FIELDS.map((def) => [def.key, req.current[def.key]]));
  const shell = Object.fromEntries(knobs.map((knob) => [knob.name, decodeKnob(knob, req.currentShell[knob.name])]));
  const current = JSON.stringify(knobs.length ? { desktop, shell } : { desktop });
  return { system, user: `The current design:\n${current}\n\nChange it: ${req.prompt.trim()}` };
}

/* ------------------------------------------------------------ the answer -- */

/** The first JSON object in a reply, whether it came bare, fenced or with prose round it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? (fenced[1] ?? '') : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function hex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const digits = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return `#${digits.toLowerCase()}`;
}

function numberIn(raw: unknown, min?: number, max?: number, step?: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  let value = clamp(n);
  if (step) {
    const base = min ?? 0;
    value = clamp(Number((base + Math.round((value - base) / step) * step).toFixed(4)));
  }
  return value;
}

function option(raw: unknown, options: readonly { value: string; label: string }[]): string | null {
  if (typeof raw !== 'string') return null;
  // A model copying "(light)" from the scheme list, or answering with a label.
  const wanted = raw.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
  return options.find((o) => o.value.toLowerCase() === wanted || o.label.toLowerCase() === wanted)?.value ?? null;
}

function fontName(raw: unknown, fonts: readonly string[]): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/["';{}\\]/g, '').trim().slice(0, 80);
  if (!clean) return '';
  if (!fonts.length) return clean;
  return fonts.find((family) => family.toLowerCase() === clean.toLowerCase()) ?? null;
}

function flag(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

/** A desktop value the control would accept, or `undefined` for none. */
export function coerceField(def: ModuleField, raw: unknown, fonts: readonly string[]): unknown {
  let value: unknown = null;
  switch (def.type) {
    case 'switch':
      value = flag(raw);
      break;
    case 'range':
    case 'number':
      value = numberIn(raw, def.min, def.max, def.step);
      break;
    case 'select':
      value = option(raw, def.options ?? []);
      break;
    case 'color':
      value = hex(raw);
      break;
    case 'font':
      value = fontName(raw, fonts);
      break;
    default:
      value = typeof raw === 'string' ? raw.slice(0, 200) : null;
  }
  return value === null ? undefined : value;
}

/** A theme value in its stored form, or `undefined` for none. */
export function coerceKnob(knob: ThemeKnob, raw: unknown, fonts: readonly string[]): string | undefined {
  if (knob.options) {
    const value = option(raw, knob.options);
    return value === null ? undefined : encodeKnob(knob, value);
  }
  switch (knob.syntax) {
    case '<color>': {
      if (raw === '' || raw === null || raw === 'transparent') return 'transparent';
      return hex(raw) ?? undefined;
    }
    case '<family-name>': {
      const family = fontName(raw, fonts);
      return family === null ? undefined : encodeKnob(knob, family);
    }
    default: {
      const n = numberIn(raw, knob.min, knob.max, knob.step);
      return n === null ? undefined : encodeKnob(knob, n);
    }
  }
}

export interface VibeDesign {
  name: string;
  summary: string;
  desktop: Partial<DesktopConfig>;
  /** Theme values in their stored form, ready to write. */
  shell: Record<string, string>;
  /** What the model sent that could not be used, by name. */
  dropped: string[];
}

export type VibeParse = { ok: true; design: VibeDesign } | { ok: false; error: string };

function line(raw: unknown, limit: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function parseVibe(
  text: string,
  options: { fonts: readonly string[]; styleShell: boolean; includeShell: boolean },
): VibeParse {
  const data = extractJson(text);
  if (!isObject(data)) {
    return { ok: false, error: 'The model did not answer with a design. Try again, or try another model.' };
  }

  // A model that forgets the "desktop" wrapper and lists settings at the top is still understood.
  const desktopIn = isObject(data.desktop) ? data.desktop : data;
  const shellIn = isObject(data.shell) ? data.shell : {};
  const dropped: string[] = [];

  const fields = new Map<string, ModuleField>(VIBE_FIELDS.map((def) => [def.key, def]));
  const desktop: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(desktopIn)) {
    if (key === 'name' || key === 'summary' || key === 'desktop' || key === 'shell') continue;
    const def = fields.get(key);
    const value = def ? coerceField(def, raw, options.fonts) : undefined;
    if (value === undefined) dropped.push(key);
    else desktop[key] = value;
  }

  const shell: Record<string, string> = {};
  if (options.includeShell) {
    const knobs = new Map(vibeKnobs(options.styleShell).map((knob) => [knob.name, knob]));
    for (const [name, raw] of Object.entries(shellIn)) {
      const knob = knobs.get(name);
      const value = knob ? coerceKnob(knob, raw, options.fonts) : undefined;
      if (value === undefined) dropped.push(name);
      else shell[name] = value;
    }
  }

  if (!Object.keys(desktop).length && !Object.keys(shell).length) {
    return { ok: false, error: 'The model answered, but with no settings this desktop has.' };
  }

  return {
    ok: true,
    design: {
      name: line(data.name, 40) || 'Untitled vibe',
      summary: line(data.summary, 240),
      desktop: desktop as Partial<DesktopConfig>,
      shell,
      dropped,
    },
  };
}
