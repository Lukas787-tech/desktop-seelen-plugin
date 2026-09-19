/**
 * Keeps an icon from being drawn larger than it actually is.
 *
 * Game mode draws an application's own icon in the middle of a tile the size of
 * a playing card. Some of those icons are a 256px PNG inside the executable and
 * look right at any size; plenty are 32 or 48 pixels, because that is all a
 * `.url` shortcut or an old program ever carried, and stretching one of those
 * across a tile is the blur the eye reads as "broken image" rather than as
 * "small icon".
 *
 * Nothing in the host API offers a bigger one, so the fix is to stop asking:
 * the element publishes the size it really is as `--natural`, and the stylesheet
 * takes the smaller of that and the room available. A small icon then sits
 * crisply in the middle of its tile, which is what every launcher that has the
 * same problem does.
 *
 * It re-measures on every load, because the same element is reused when the
 * icon packs change and resolve a different file for the same game.
 */
export function naturalSize(img: HTMLImageElement): { destroy(): void } {
  const measure = (): void => {
    const src = img.currentSrc || img.src;
    // A vector is the one kind that is right at any size, and the one kind
    // whose `naturalWidth` is a made-up default rather than a measurement.
    const size = /\.svgz?(\?|#|$)/i.test(src)
      ? 0
      : Math.max(img.naturalWidth, img.naturalHeight);
    img.style.setProperty('--natural', size ? `${size}px` : '100%');
  };

  if (img.complete) measure();
  img.addEventListener('load', measure);
  return {
    destroy(): void {
      img.removeEventListener('load', measure);
    },
  };
}
