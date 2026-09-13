import { SeelenEvent, Widget, subscribe, type UnSubscriber } from './seelen';
import { resolveOwnMonitor } from './monitor';
import type { PhysicalMonitor } from '@seelen-ui/lib/types';

/**
 * Makes this replica cover exactly its own display.
 *
 * The Desktop preset deliberately applies no geometry (`applyDesktopPreset` is
 * a no-op in the SDK), and we opt out of `saveAndRestoreLastRect` because that
 * persists a single rect in localStorage shared by every monitor replica. So
 * covering the display is our job, and we redo it whenever the display layout
 * changes — resolution switch, DPI change, monitor plugged or unplugged.
 */
export async function fitToOwnMonitor(): Promise<PhysicalMonitor | null> {
  const monitor = await resolveOwnMonitor();
  if (!monitor) return null;

  // `setPosition` takes physical pixels, which is exactly what `rect` already is.
  await Widget.self.setPosition({
    left: monitor.rect.left,
    top: monitor.rect.top,
    right: monitor.rect.right,
    bottom: monitor.rect.bottom,
  });

  return monitor;
}

/**
 * Keeps the surface pinned to its display, calling `onFit` after each refit so
 * callers can update anything derived from the geometry.
 */
export function keepFittedToMonitor(
  onFit: (monitor: PhysicalMonitor | null) => void,
): Promise<UnSubscriber> {
  const refit = () => {
    void fitToOwnMonitor().then(onFit);
  };
  refit();
  return subscribe(SeelenEvent.SystemMonitorsChanged, refit);
}
