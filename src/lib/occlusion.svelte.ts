import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import type { PhysicalMonitor, Rect, UserAppWindow } from '@seelen-ui/lib/types';

/** Fraction of the display that must be hidden before we treat it as covered. */
const COVERED_THRESHOLD = 0.9;

function area(r: Rect): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
}

function intersectionArea(a: Rect, b: Rect): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/**
 * Tracks whether this display is hidden behind application windows.
 *
 * The desktop surface sits below every app window, so while something covers
 * the display nothing we paint is visible — which is exactly when a video
 * wallpaper should stop decoding. Coverage is taken as the largest single
 * window's overlap rather than a true union: computing an exact union costs
 * more than it is worth, and the case that matters (one maximised or
 * fullscreen window) is measured precisely either way.
 */
export class OcclusionWatcher {
  covered = $state(false);

  #monitor: PhysicalMonitor | null = null;

  setMonitor(monitor: PhysicalMonitor | null): void {
    this.#monitor = monitor;
    void this.#recompute();
  }

  /** Subscribes to window changes; returns the unsubscribe handle. */
  async start(): Promise<UnSubscriber> {
    await this.#recompute();
    return subscribe(SeelenEvent.UserAppWindowsChanged, (event) => {
      this.#apply(event.payload as UserAppWindow[]);
    });
  }

  async #recompute(): Promise<void> {
    try {
      this.#apply(await invoke(SeelenCommand.GetUserAppWindows));
    } catch (err) {
      // If we cannot tell, assume visible — a running wallpaper is a far
      // better failure than a permanently frozen one.
      console.error('[occlusion] could not read window list', err);
      this.covered = false;
    }
  }

  #apply(windows: UserAppWindow[]): void {
    const monitor = this.#monitor;
    if (!monitor) {
      this.covered = false;
      return;
    }

    const monitorArea = area(monitor.rect);
    if (monitorArea <= 0) {
      this.covered = false;
      return;
    }

    let worst = 0;
    for (const w of windows) {
      if (w.monitor !== monitor.id || w.isIconic) continue;
      if (w.isFullscreen || w.isZoomed) {
        worst = 1;
        break;
      }
      if (!w.rect) continue;
      worst = Math.max(worst, intersectionArea(monitor.rect, w.rect) / monitorArea);
      if (worst >= COVERED_THRESHOLD) break;
    }

    this.covered = worst >= COVERED_THRESHOLD;
  }
}
