import { Settings } from './seelen';
import { noteError } from './diagnostics';
import type { DesktopConfig } from './config.svelte';
import {
  ShellSyncPlanner,
  applyPlan,
  barFill,
  tierFills,
  type ShellPlan,
} from './shellplan';

/**
 * Mirrors the surface's appearance settings into `@ralfm/surface`'s theme
 * variables, so the dock, the start menu and every popup are dressed by the
 * same choices as the desktop.
 *
 * ## Why it has to work this way
 *
 * A theme is static CSS. It cannot read another widget's settings, and the
 * shell widgets are separate webviews, so nothing this surface computes at
 * runtime can reach them directly. What *is* shared is the settings file: a
 * theme's own variables live in `settings.byTheme[themeId]`, the host pushes
 * them into every widget's `:root` and re-applies on change. Writing there is
 * therefore the one channel between the two, and it is a channel the host
 * already keeps live - the dock restyles without a restart.
 *
 * ## Push on change, not on difference
 *
 * The subtle part, and the one this got wrong first.
 *
 * The obvious rule - "write whenever the theme's value differs from ours" -
 * makes the theme's own settings unusable. Editing one of them changes the
 * settings file; the host broadcasts that change; this widget's config store
 * re-reads and hands out a fresh object; the effect re-runs; the rule sees a
 * difference and writes the widget's value straight back over the edit. The
 * slider springs back to where it was, every time, and there is no way to tell
 * from inside the loop that a human moved it.
 *
 * So the rule is *push on change*: a variable is written only when this
 * surface's own setting for it has changed since the last push. A value the
 * user edits in the theme is then simply left alone until the corresponding
 * widget setting is touched, at which point the widget's value wins - which is
 * what "apply these to the shell" should mean, and no more than that.
 *
 * Two openings make that complete:
 *
 *  - **The first push of a session seeds rather than overwrites.** Only
 *    variables missing from the theme are filled in, so a restart never stomps
 *    a value tuned in a previous one, while a fresh install still arrives
 *    dressed.
 *  - **Turning the switch off and on forces a full push.** That is the one
 *    unambiguous "apply these now" gesture the user has, so it applies them.
 *
 * ## What is synced, and what deliberately is not
 *
 * Geometry, typography, density and the frosted texture. The palette goes the
 * *other* way - `followTheme` in `appearance.ts` takes the theme's ground and
 * accent for the desktop - and syncing colour in both directions would be a
 * second loop of the same shape as the one above.
 *
 * All three fill tiers are synced - the bar, the popups and the full-screen
 * layers - but *through a conversion* rather than directly. `barFill` and
 * `tierFills` in `shellplan.ts` carry that argument; in short, the surface's
 * panels blur what is behind them and the shell's cannot, so the same number
 * does not describe the same material at both ends, and the fill has to stand
 * in for the blur the shell will never have.
 *
 * That is also why the blur setting is synced despite reaching almost nothing
 * directly: it is the main thing the fills are computed *from*. Only the bar
 * used to be converted, and only through a flat floor, which meant the blur
 * slider moved and nothing in the shell changed.
 *
 * Changing any of those conversions changes what an already-stored value
 * means, and the planner only seeds at startup, so a value written by an older
 * mapping stays until a widget setting moves. Switching "Apply these to the
 * Seelen shell" off and on re-derives the whole set, which is the gesture that
 * exists for exactly this.
 *
 * The texture is the exception among the material settings, and the reason is
 * that same fact read the other way: precisely *because* a shell panel cannot
 * blur, the sheen and grain are the whole of what makes one look like glass
 * there. It is the one material choice worth carrying across.
 */

/** The theme this surface dresses. Also its key in `byTheme`. */
const THEME_ID = '@ralfm/surface';

/** Matches the density multipliers in `appearance.ts`. */
const DENSITY: Record<DesktopConfig['density'], string> = {
  compact: '0.72',
  cosy: '1',
  roomy: '1.3',
};

/** A family name as a CSS `<family-name>`, which is what the setting registers. */
function family(name: string): string {
  const clean = name.replace(/["';{}\\]/g, '').trim();
  return clean ? `"${clean}"` : 'system-ui';
}

/**
 * The theme variables this surface's settings determine.
 *
 * `tint` is the colour this surface's own panels are currently showing,
 * measured from the wallpaper by `glass.ts`. It is the single most important
 * thing sent to the shell: a dock given the right colour reads as the same
 * material as a desktop panel, and one given the theme's fixed ground does not,
 * however its texture is tuned. Null when there is no wallpaper to measure or
 * the canvas could not be read, in which case the theme keeps its own ground.
 */
export function shellVars(cfg: DesktopConfig, tint: string | null): Record<string, string> {
  const bar = barFill(cfg.panelOpacity, cfg.panelBlur, tint !== null);
  const tiers = tierFills(bar);
  return {
    '--rs-tint': tint ?? 'transparent',
    '--rs-radius': `${cfg.cornerRadius}px`,
    '--rs-blur': `${cfg.panelBlur}px`,
    '--rs-edge': String(cfg.panelBorder),
    /*
     * Not `cfg.panelOpacity` itself. The surface's panels blur what is behind
     * them and the shell's cannot, so the same number describes a different
     * material at each end - see `barFill`, which converts one to the other and
     * takes account of whether a measured colour is being sent along with it.
     */
    '--rs-bar-opacity': String(bar),
    '--rs-panel-opacity': String(tiers.panel),
    '--rs-overlay-opacity': String(tiers.overlay),
    '--rs-motion': cfg.animations ? '1' : '0',
    '--rs-frost': cfg.panelTexture ? '100' : '0',
    '--rs-font-family': family(cfg.fontFamily),
    '--rs-font-size': `${cfg.fontSize}px`,
    '--rs-density': DENSITY[cfg.density] ?? DENSITY.cosy,
  };
}

interface RawThemeSettings {
  byTheme: Record<string, Record<string, string> | undefined>;
}

const planner = new ShellSyncPlanner();

/** Variables waiting to be written, and which of them may overwrite. */
const pending = new Map<string, string>();
const forced = new Set<string>();

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> = Promise.resolve();

export function syncShellStyle(
  cfg: DesktopConfig,
  enabled: boolean,
  tint: string | null = null,
): void {
  const plan = planner.next(shellVars(cfg, tint), enabled);

  if (!enabled) {
    pending.clear();
    forced.clear();
    return;
  }

  // Accumulate across the debounce window rather than replacing: two settings
  // changed in quick succession are one write of both, not a write of the last.
  for (const [name, value] of plan.writes) {
    pending.set(name, value);
    if (plan.overwrite.has(name)) forced.add(name);
    else forced.delete(name);
  }
  if (!pending.size) return;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    const batch: ShellPlan = { writes: [...pending.entries()], overwrite: new Set(forced) };
    pending.clear();
    forced.clear();

    inFlight = inFlight
      .then(async () => {
        // Re-read rather than cache: the host owns this file and rewrites it
        // whole, so anything stale here would be written back over its work.
        const settings = await Settings.getAsync();
        const raw = settings.inner as unknown as RawThemeSettings;
        const current = (raw.byTheme[THEME_ID] ??= {});
        if (!applyPlan(batch, current)) return;
        await settings.save();
      })
      .catch((err) => {
        noteError(`shell style sync failed: ${String(err)}`);
      });
  }, 400);
}
