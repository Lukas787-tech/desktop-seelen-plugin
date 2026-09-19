import type { DesktopConfig } from './config.svelte';
import { schemeAccents, schemePolarity, schemeVars } from './schemes';

/**
 * Turns the surface's appearance settings into the custom properties and
 * `data-*` attributes every other stylesheet in this package reads.
 *
 * It lives here rather than in each component for the usual reason - fifteen
 * `style:--x` directives spread across four files drift - but also because
 * several of these values cannot be expressed in CSS at all. `--panel-ground`
 * has to choose between a relative-colour expression and a plain colour
 * depending on whether a tint is asked for, and CSS has no conditional; the
 * same is true of whether a font name is prepended to the stack, and of which
 * forty colours a scheme sets. Each is one line here.
 *
 * ## Two channels, and which one a setting uses
 *
 * - **Custom properties** for anything that is a number or a finished value:
 *   a radius, a weight, a blur. They are resolved on `body` (see below) and
 *   inherited as they are.
 * - **`data-*` attributes on `body`** for anything drawn *in the accent* - a
 *   gradient edge, a glowing shadow, an accent wash, a striped meter. A colour
 *   composed into a custom property here would be fixed at `body`, so a user
 *   stylesheet that gave one panel its own `--accent` could not recolour that
 *   panel's glow. Written as rules keyed on an attribute, each is resolved on
 *   the element it paints, and `[data-module='clock'] { --accent: gold }`
 *   reaches all of it. The attributes double as hooks for exactly that kind of
 *   stylesheet - see the README's "Ricing" section.
 *
 * ## Following the active theme
 *
 * Seelen injects an active theme's `sharedStyles` into *every* widget that
 * opts into theming, this surface included - so when `@ralfm/surface` is
 * enabled, its `--rs-*` tokens are already present in this document.
 * `followTheme` makes the ground and the accent `var(--rs-ground, <own>)` and
 * `var(--rs-accent, <own>)`, which resolve to the theme's palette when one is
 * active and fall back to this widget's own settings when none is.
 *
 * A colour scheme outranks it. The theme's `--rs-ground` is itself a relative
 * colour of `--color-gray-50`, so following the theme while a scheme redefines
 * that ramp would rotate the scheme's ground to the theme preset's hue - a Nord
 * that is not Nord. Choosing a scheme is the more specific request, so it wins.
 */

/** What the surface uses when no font is chosen and no theme is providing one. */
const UI_FALLBACK =
  "var(--rs-font, var(--font-family, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif))";

const MONO_FALLBACK = "'Cascadia Code', Consolas, ui-monospace, monospace";

/** The adaptive ground, before any tint of our own. */
const BASE_GROUND = 'var(--color-gray-50, #16161e)';

/**
 * The shadows that are finished values. `block` and `glow` are drawn in the
 * accent, per panel, by `data-shadow` rules in `base.css`, so their entry here
 * only has to be something harmless underneath those rules.
 */
const SHADOWS: Record<DesktopConfig['panelShadow'], string> = {
  none: 'none',
  soft: 'var(--shadow-m, 2px 2px 8px rgb(0 0 0 / 0.18))',
  medium: '0 6px 18px rgb(0 0 0 / 0.3)',
  deep: '0 14px 36px rgb(0 0 0 / 0.45)',
  hard: '6px 6px 0 0 rgb(0 0 0 / 0.78)',
  block: 'none',
  glow: 'none',
};

/**
 * One multiplier over every pad and gap in `modules.css`. Not three sets of
 * measurements: a density that is a number can be interpolated, and a row that
 * is `calc(4px * var(--density))` cannot fall out of step with the list around
 * it the way a second hand-written set of paddings would.
 */
const DENSITY: Record<DesktopConfig['density'], string> = {
  compact: '0.72',
  cosy: '1',
  roomy: '1.3',
};

/**
 * The same idea for corners: every control radius in the package is
 * `calc(<its tuned radius> * var(--round))`, so one setting squares off or
 * rounds out a hundred buttons, fields and tracks together and they keep their
 * proportions to one another. Pill is not infinite on purpose - a card or a
 * text area multiplied by a large number stops being a card - and anything
 * that was already a pill stays one at every setting but square.
 */
const ROUND: Record<DesktopConfig['controlShape'], string> = {
  square: '0',
  subtle: '0.5',
  rounded: '1',
  round: '1.6',
  pill: '2.6',
};

const SCROLLBARS: Record<DesktopConfig['scrollbars'], string> = {
  thin: 'thin',
  hidden: 'none',
  auto: 'auto',
};

/** The keyframe a panel arrives on; all of them live in `motion.css`. */
const ENTRANCES: Record<DesktopConfig['entranceStyle'], string> = {
  rise: 'fx-panel-in',
  fade: 'fx-fade',
  zoom: 'fx-zoom',
  drop: 'fx-drop',
  slide: 'fx-slide-in',
  blur: 'fx-focus-in',
  none: 'none',
};

/** Numbers written into CSS, without a float's sixteen digits of noise. */
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/**
 * A family name from Seelen's font picker, made safe to drop into a CSS
 * declaration. The picker returns whatever the system reported, and a name
 * carrying a quote or a semicolon would otherwise end the declaration early -
 * this is a style attribute built from user input, so it is escaped like one.
 */
function fontStack(name: string, fallback: string): string {
  const clean = (name ?? '').replace(/["';{}\\]/g, '').trim();
  return clean ? `"${clean}", ${fallback}` : fallback;
}

/** Whether the theme's palette is in charge, rather than a scheme or the widget's own pickers. */
function themed(cfg: DesktopConfig): boolean {
  return cfg.followTheme && cfg.colorScheme === 'theme';
}

/**
 * The ground, optionally tinted.
 *
 * Relative colour syntax rather than a blend, for the reason the shell theme
 * documents at length: `--color-gray-50` is contrast-adaptive, so mixing a
 * colour into it moves its lightness as well as its hue and a tinted panel
 * ends up visibly thinner than a neutral one. Taking `l` untouched and adding
 * chroma changes the colour and nothing else.
 *
 * At zero chroma the expression is skipped entirely rather than written with a
 * `0`, because `oklch(from x l calc(c + 0) 240)` still *rotates* whatever
 * chroma the ground already carries round to 240deg - which, under a scheme,
 * would be the scheme's own colour.
 */
function ground(cfg: DesktopConfig): string {
  const base = themed(cfg) ? `var(--rs-ground, ${BASE_GROUND})` : BASE_GROUND;
  if (cfg.surfaceChroma <= 0) return base;
  return `oklch(from ${base} l calc(c + ${cfg.surfaceChroma / 100}) ${cfg.surfaceHue})`;
}

/**
 * The accent pair.
 *
 * One accent for the whole document. Every module used to set this on its own
 * root from `cfg.accentColor`, which meant twenty places to teach about
 * `followTheme` - and twenty places for it to be forgotten.
 */
function accents(cfg: DesktopConfig): [string, string] {
  const fromScheme = cfg.schemeAccent ? schemeAccents(cfg.colorScheme) : null;
  if (fromScheme) return [fromScheme.accent, fromScheme.accent2];
  const accent = themed(cfg) ? `var(--rs-accent, ${cfg.accentColor})` : cfg.accentColor;
  return [accent, cfg.accentColor2];
}

/**
 * The panel's backdrop filter, or `none`.
 *
 * `none` rather than `blur(0px)` when nothing is asked for: an unblurred,
 * unsaturated backdrop filter still has the compositor read back what is behind
 * every panel on every frame, which is the single most expensive thing a panel
 * can do and buys nothing at zero.
 */
function backdrop(cfg: DesktopConfig): string {
  const parts: string[] = [];
  if (cfg.panelBlur > 0) parts.push(`blur(${cfg.panelBlur}px)`);
  if (cfg.backdropSaturation !== 100) parts.push(`saturate(${num(clamp(cfg.backdropSaturation, 0, 300) / 100)})`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * Every appearance-derived custom property, as name/value pairs.
 *
 * ## Why these go on `body` and not on the surface element
 *
 * `base.css` composes several tokens out of these on `:root, body`, and a
 * custom property's `var()`s are substituted *where the property is declared*,
 * not where it is eventually used. A value set further down the tree therefore
 * cannot reach a composition that was already computed higher up - the panels
 * simply kept the defaults, which is exactly what happened the first time this
 * was written against the surface's own element.
 *
 * They go on `body`, which is the element `base.css` composes on, so the
 * composition sees them. `body` rather than `:root` for a second reason:
 * `@ralfm/surface` declares its palette there too - a style query cannot match
 * the element carrying the value it tests, so the theme has nowhere higher to
 * put it - and `--panel-ground: var(--rs-ground, ...)` only finds the theme's
 * colour if it is resolved on the same element the theme declared it on.
 *
 * Each monitor replica is its own document, so there is nothing shared to
 * collide over.
 */
export function surfaceVars(cfg: DesktopConfig): Array<[string, string]> {
  const ui = fontStack(cfg.fontFamily, UI_FALLBACK);
  const [accent, accent2] = accents(cfg);
  const edge = clamp(cfg.panelBorder, 0, 100);

  return [
    ['--ui-font', ui],
    // The display font falls back to the interface font, not to the platform
    // stack: leaving it empty should mean "same as everything else".
    ['--display-font', fontStack(cfg.displayFont, ui)],
    ['--mono-font', fontStack(cfg.monoFont, MONO_FALLBACK)],
    ['--ui-size', `${cfg.fontSize}px`],
    // Every fixed text size in the package is multiplied by this, so the base
    // size really does move the whole surface and not only the few labels that
    // were written against `--ui-size`. 14px is the size they were tuned at.
    ['--text-scale', num(clamp(cfg.fontSize, 6, 40) / 14)],
    ['--ui-weight', String(cfg.fontWeight)],
    ['--display-weight', String(cfg.displayWeight)],
    ['--title-weight', String(cfg.titleWeight)],
    ['--ui-tracking', cfg.letterSpacing ? `${num(cfg.letterSpacing / 100)}em` : 'normal'],
    ['--panel-text-shadow', cfg.textShadow ? '0 1px 2px rgb(0 0 0 / 0.6)' : 'none'],

    // Before the ground, which reads the ramp a scheme redefines.
    ...schemeVars(cfg),
    ['--panel-ground', ground(cfg)],
    ['--panel-alpha', num(clamp(cfg.panelOpacity, 0, 100) / 100)],
    ['--panel-blur', `${cfg.panelBlur}px`],
    ['--panel-backdrop', backdrop(cfg)],
    ['--panel-edge', `${edge}%`],
    ['--panel-edge-n', num(edge / 100)],
    ['--panel-border-width', `${clamp(cfg.panelBorderWidth, 0, 12)}px`],
    ['--panel-border-style', cfg.panelBorderStyle],
    ['--panel-shadow', SHADOWS[cfg.panelShadow] ?? SHADOWS.soft],
    // Two layers either way: `.panel` sizes its background layers by position,
    // so a texture that was one `none` would hand its grain size to the fill.
    ['--panel-texture', cfg.panelTexture ? 'var(--surface-sheen), var(--surface-grain)' : 'none, none'],
    ['--surface-radius', `${cfg.cornerRadius}px`],
    ['--panel-pad', `${clamp(cfg.panelPadding, 0, 48)}px`],

    ['--density', DENSITY[cfg.density] ?? DENSITY.cosy],
    ['--round', ROUND[cfg.controlShape] ?? ROUND.rounded],
    ['--icon-radius', `${cfg.iconRadius}px`],
    ['--bar-h', `${clamp(cfg.barThickness, 1, 24)}px`],
    ['--scrollbar-width', SCROLLBARS[cfg.scrollbars] ?? SCROLLBARS.thin],

    // Multiplies every duration in `motion.css`; see there for how it defers
    // to the shell theme's own speed when that is present.
    ['--motion', cfg.animations ? num(clamp(cfg.motionScale, 0, 400) / 100) : '0'],
    ['--stagger', num(clamp(cfg.staggerScale, 0, 500) / 100)],
    ['--entrance', ENTRANCES[cfg.entranceStyle] ?? ENTRANCES.rise],

    ['--accent', accent],
    ['--accent-2', accent2],
  ];
}

/**
 * The `data-*` attributes on `body`, by `dataset` name.
 *
 * Every one is also a hook a user stylesheet can key on - `body[data-scheme=
 * 'nord']` is a supported selector, not an implementation detail.
 */
export function surfaceData(cfg: DesktopConfig): Record<string, string> {
  return {
    scheme: cfg.colorScheme,
    border: cfg.panelBorderColor,
    borderMotion: cfg.borderAnimation && cfg.animations ? 'on' : 'off',
    shadow: cfg.panelShadow,
    fill: cfg.panelFill,
    bar: cfg.barStyle,
    shape: cfg.controlShape,
    labels: cfg.iconLabelStyle,
    motion: cfg.animations ? 'on' : 'off',
  };
}

/** What was last written, so an unchanged value is never written again. */
let written = new Map<string, string>();

/**
 * Writes the properties and attributes onto `body`. Safe to call on every
 * config change.
 *
 * Only what changed is touched. The effect that calls this re-runs for any
 * appearance setting, and with seventy properties a blanket rewrite would
 * restyle the whole document per tick of a dragged slider even where the value
 * is the same. Names that are no longer produced - the forty a scheme sets,
 * after switching back to the theme - are removed, or the old palette would
 * stay painted underneath the new setting.
 */
export function applySurfaceVars(cfg: DesktopConfig): void {
  const body = document.body;
  const style = body.style;
  const next = new Map(surfaceVars(cfg));

  for (const [name, value] of next) {
    if (written.get(name) !== value) style.setProperty(name, value);
  }
  for (const name of written.keys()) {
    if (!next.has(name)) style.removeProperty(name);
  }
  written = next;

  for (const [key, value] of Object.entries(surfaceData(cfg))) {
    if (body.dataset[key] !== value) body.dataset[key] = value;
  }

  // Native controls, scrollbars and the date picker follow a light scheme too.
  const polarity = schemePolarity(cfg.colorScheme, cfg.schemeGround) ?? '';
  if (style.colorScheme !== polarity) style.colorScheme = polarity;
}

let userSheet: HTMLStyleElement | null = null;

/**
 * The user's own stylesheet, applied after everything this package ships.
 *
 * A `<style>` built through the DOM rather than parsed markup, so nothing in
 * the text - a stray `</style>` included - can become anything other than CSS.
 * It is re-appended on every change: the host injects theme styles into the
 * document at runtime, and staying last is what lets a rule of equal
 * specificity win without the user reaching for `!important`.
 */
export function applyUserCss(css: string): void {
  const text = css ?? '';
  if (!text.trim()) {
    userSheet?.remove();
    userSheet = null;
    return;
  }
  userSheet ??= Object.assign(document.createElement('style'), { id: 'desktop-user-css' });
  if (userSheet.textContent !== text) userSheet.textContent = text;
  if (userSheet !== document.head.lastElementChild) document.head.appendChild(userSheet);
}
