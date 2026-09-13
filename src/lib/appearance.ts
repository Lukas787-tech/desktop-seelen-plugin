import type { DesktopConfig } from './config.svelte';

/**
 * Turns the surface's appearance settings into the handful of CSS custom
 * properties every other stylesheet in this package reads.
 *
 * It lives here rather than in each component for the usual reason - fifteen
 * `style:--x` directives spread across four files drift - but also because two
 * of these values cannot be expressed in CSS at all. `--panel-ground` has to
 * choose between a relative-colour expression and a plain colour depending on
 * whether a tint is asked for, and CSS has no conditional; the same is true of
 * whether a font name is prepended to the stack. Both are one line here.
 *
 * ## Following the active theme
 *
 * Seelen injects an active theme's `sharedStyles` into *every* widget that
 * opts into theming, this surface included - so when `@ralfm/surface` is
 * enabled, its `--rs-*` tokens are already present in this document even
 * though none of this package's own CSS used to look at them. That is why the
 * shell could be restyled by a theme preset and the desktop stayed exactly as
 * it was.
 *
 * `followTheme` closes that: the ground and the accent become
 * `var(--rs-ground, <own>)` and `var(--rs-accent, <own>)`, which resolve to
 * the theme's palette when one is active and fall back to this widget's own
 * settings when none is. No detection, no scripting - just a fallback chain.
 */

/** What the surface uses when no font is chosen and no theme is providing one. */
const UI_FALLBACK =
  "var(--rs-font, var(--font-family, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif))";

/** The adaptive ground, before any tint of our own. */
const BASE_GROUND = 'var(--color-gray-50, #16161e)';

const SHADOWS: Record<DesktopConfig['panelShadow'], string> = {
  none: 'none',
  soft: 'var(--shadow-m, 2px 2px 8px rgb(0 0 0 / 0.18))',
  medium: '0 6px 18px rgb(0 0 0 / 0.3)',
  deep: '0 14px 36px rgb(0 0 0 / 0.45)',
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
 * A family name from Seelen's font picker, made safe to drop into a CSS
 * declaration. The picker returns whatever the system reported, and a name
 * carrying a quote or a semicolon would otherwise end the declaration early -
 * this is a style attribute built from user input, so it is escaped like one.
 */
function fontStack(name: string, fallback: string): string {
  const clean = name.replace(/["';{}\\]/g, '').trim();
  return clean ? `"${clean}", ${fallback}` : fallback;
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
 * chroma the ground already carries round to 240deg.
 */
function ground(cfg: DesktopConfig): string {
  const base = cfg.followTheme ? `var(--rs-ground, ${BASE_GROUND})` : BASE_GROUND;
  if (cfg.surfaceChroma <= 0) return base;
  return `oklch(from ${base} l calc(c + ${cfg.surfaceChroma / 100}) ${cfg.surfaceHue})`;
}

/**
 * Every appearance-derived custom property, as name/value pairs.
 *
 * ## Why these go on `body` and not on the surface element
 *
 * `base.css` composes `--panel-bg` out of `--panel-ground` and `--panel-alpha`
 * on `:root`, and a custom property's `var()`s are substituted *where the
 * property is declared*, not where it is eventually used. A `--panel-alpha`
 * set further down the tree therefore cannot reach a `--panel-bg` that was
 * already computed at the root - the panels simply kept the defaults, which is
 * exactly what happened the first time this was written against the surface's
 * own element.
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

  return [
    ['--ui-font', ui],
    // The display font falls back to the interface font, not to the platform
    // stack: leaving it empty should mean "same as everything else".
    ['--display-font', fontStack(cfg.displayFont, ui)],
    ['--ui-size', `${cfg.fontSize}px`],

    ['--panel-ground', ground(cfg)],
    ['--panel-alpha', String(cfg.panelOpacity / 100)],
    ['--panel-blur', `${cfg.panelBlur}px`],
    ['--panel-edge', `${cfg.panelBorder}%`],
    ['--panel-shadow', SHADOWS[cfg.panelShadow] ?? SHADOWS.soft],
    ['--panel-texture', cfg.panelTexture ? 'var(--surface-sheen), var(--surface-grain)' : 'none'],
    ['--surface-radius', `${cfg.cornerRadius}px`],

    ['--density', DENSITY[cfg.density] ?? DENSITY.cosy],
    ['--icon-radius', `${cfg.iconRadius}px`],

    /*
     * One accent for the whole document. Every module used to set this on its
     * own root from `cfg.accentColor`, which meant twenty places to teach
     * about `followTheme` - and twenty places for it to be forgotten.
     */
    ['--accent', cfg.followTheme ? `var(--rs-accent, ${cfg.accentColor})` : cfg.accentColor],
  ];
}

/** Writes them onto `body`. Safe to call on every config change. */
export function applySurfaceVars(cfg: DesktopConfig): void {
  const target = document.body.style;
  for (const [name, value] of surfaceVars(cfg)) target.setProperty(name, value);
}
