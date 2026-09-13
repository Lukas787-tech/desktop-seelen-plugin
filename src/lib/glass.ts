/**
 * Works out what colour the surface's own panels are actually showing, so the
 * shell can be given the same one.
 *
 * ## Why this exists
 *
 * Every previous attempt to make a dock look like a desktop panel tried to do
 * it with the theme alone - a denser fill, a stronger sheen, a coarser grain -
 * and every one of them was wrong in the same way. Put the two side by side
 * over a real wallpaper and the difference is not texture at all: it is colour.
 *
 * A desktop panel is 24% of a dark ground over a *blurred wallpaper*, so what
 * you see is mostly the wallpaper, averaged. Over a moonlit blue wallpaper it
 * is a pale blue-grey; over a sunset it is warm. It changes when the wallpaper
 * changes, because it is mostly made of wallpaper. A dock cannot blur, so its
 * colour is whatever ground the theme names, and the theme's ground is a fixed
 * near-black - tinted by the preset, which at the high fill a non-blurring
 * panel needs comes out as a solid brown or navy bar. No amount of grain fixes
 * a bar that is brown next to panels that are blue.
 *
 * So the colour is measured instead. The widget already has the wallpaper in
 * its own document; averaging it and compositing the panel's own alpha over
 * the result gives exactly the colour its panels display. That colour goes to
 * the theme through the settings file, and the shell uses it as its ground.
 * The dock is then made of the same wallpaper the desktop panels are made of,
 * and the two match by construction rather than by tuning.
 *
 * ## What it cannot do
 *
 * One colour for the whole wallpaper, not one per bar. `byTheme` holds a
 * single value, a dock can sit on any edge, and two monitors with different
 * wallpapers would otherwise fight over it. Measured against a real wallpaper
 * the whole-image average actually matched *better* than sampling under each
 * bar, because the desktop's own panels are scattered across the screen and
 * the average splits the difference the same way.
 *
 * And it is the wallpaper's colour, not the screen's: a dock over a maximised
 * window is tinted by the wallpaper behind that window rather than by the
 * window. Real acrylic samples what is actually there; nothing available to a
 * widget can. This is still the closest available, and it is what the desktop
 * does too.
 */

/**
 * The brightest glass the shell's text can still be read on.
 *
 * The ink is a near-white that adapts to the active *theme*, not to the
 * wallpaper, so a white wallpaper measured faithfully would give a white bar
 * with white labels on it. Above this the measured colour is mixed back toward
 * the ground until it clears - which gives up the exact match only in the
 * cases where an exact match would be unreadable.
 */
const MAX_LUMA = 0.55;

type Rgb = [number, number, number];

function luma([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function readable(colour: Rgb, ground: Rgb): Rgb {
  const bright = luma(colour);
  if (bright <= MAX_LUMA) return colour;
  const floor = luma(ground);
  if (floor >= bright) return colour;
  const t = Math.min(1, (bright - MAX_LUMA) / (bright - floor));
  return colour.map((v, i) => v * (1 - t) + (ground[i] as number) * t) as Rgb;
}

/** How the last sample went, for the diagnostics file. */
export interface TintResult {
  /** An `rgb(...)` string, or null when no colour could be measured. */
  tint: string | null;
  /** Why, in a few words. Written to diagnostics so a failure is visible. */
  note: string;
}

/**
 * Resolves a CSS colour expression to `[r, g, b]` through the engine.
 *
 * Wrapped in `color-mix` deliberately. The theme's ground is relative-colour
 * syntax - `oklch(from ... l calc(c + x) h)` - and reading a bare `var()` that
 * holds it back out of `getComputedStyle` does not serialise to a usable
 * colour; measured, it comes back as nonsense. Passing it through `color-mix`
 * forces the engine to resolve it first.
 */
function resolveColour(expr: string): [number, number, number] | null {
  const probe = document.createElement('div');
  probe.style.backgroundColor = `color-mix(in oklab, ${expr} 100%, transparent)`;
  document.body.appendChild(probe);
  const parts = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g);
  probe.remove();
  if (!parts || parts.length < 3) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Loads an image for pixel reading, preferring a CORS-clean fetch. */
function load(url: string, anonymous: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // The wallpaper is served from `asset.localhost` while the widget runs on
    // `tauri.localhost`, so it is cross-origin and the canvas would be tainted
    // without this. Whether the asset protocol answers with the CORS header is
    // the host's business, hence the plain retry below.
    if (anonymous) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = url;
  });
}

/** The average colour of an image, via a downscale the GPU does for us. */
function average(img: HTMLImageElement): [number, number, number] | null {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Throws a SecurityError if the source tainted the canvas, which is the one
  // failure that cannot be worked around from inside the webview.
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i] as number;
    g += data[i + 1] as number;
    b += data[i + 2] as number;
  }
  const n = data.length / 4;
  return [r / n, g / n, b / n];
}

/**
 * The colour this surface's panels are showing, given the wallpaper behind
 * them and the panel opacity they are drawn at.
 *
 * @param url    A still of the wallpaper. For a video this is its thumbnail -
 *               sampling a frame would mean the colour changed continuously,
 *               and every change here is a write to the settings file.
 * @param alpha  The surface's own panel opacity, 0-1.
 */
export async function sampleWallpaperTint(
  url: string | null,
  alpha: number,
): Promise<TintResult> {
  if (!url) return { tint: null, note: 'no wallpaper' };

  let img: HTMLImageElement;
  try {
    img = await load(url, true);
  } catch {
    try {
      img = await load(url, false);
    } catch {
      return { tint: null, note: 'wallpaper did not load' };
    }
  }

  let mean: [number, number, number] | null;
  try {
    mean = average(img);
  } catch (err) {
    return { tint: null, note: `canvas tainted: ${String(err)}` };
  }
  if (!mean) return { tint: null, note: 'no 2d context' };

  const ground = (resolveColour('var(--panel-ground)') ?? [22, 22, 30]) as Rgb;
  const a = Math.min(1, Math.max(0, alpha));
  const mix = mean.map((c, i) => c * (1 - a) + (ground[i] as number) * a) as Rgb;
  const [r, g, b] = readable(mix, ground).map(Math.round);

  return { tint: `rgb(${r}, ${g}, ${b})`, note: 'measured' };
}
