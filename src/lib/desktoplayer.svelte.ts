import { SeelenCommand, SeelenEvent, Widget, invoke, subscribe, type UnSubscriber } from './seelen';
import { noteAction, noteError } from './diagnostics';
import type { FocusedApp, UserAppWindow } from '@seelen-ui/lib/types';

/**
 * Explorer's desktop window: `Progman` on current builds, while older ones hand
 * the foreground to the `WorkerW` that holds the icons instead.
 */
function isExplorerDesktop(app: FocusedApp): boolean {
  return app.class === 'Progman' || app.class === 'WorkerW';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Brings the surface back in front after Windows' own "Show desktop".
 *
 * Win+D, the taskbar's corner button and the three-finger swipe all make
 * Explorer's `Progman` the foreground window and lift it over every window -
 * this surface included - so Windows' stock wallpaper is what shows, until some
 * application takes the foreground and Explorer puts `Progman` back at the
 * bottom. That is the "open an app and close it again" workaround.
 *
 * The surface could never follow `Progman` up because of how the host builds
 * it: a Desktop-preset widget is created with Tauri's `always_on_bottom`, and
 * tao enforces that in `WM_WINDOWPOSCHANGING` by rewriting *every* z-order
 * change to `HWND_BOTTOM`. `set_self_z_order`, `setAlwaysOnTop` and the rest
 * were each accepted and each turned back into "bottom" before Windows saw it.
 *
 * So the pin is released first. When `Progman` takes the foreground the surface
 * drops `always_on_bottom`, goes topmost and straight back to not-topmost, which
 * leaves it at the top of the normal band, over `Progman`. That is the only time
 * it is anywhere but the bottom, and at that moment `Progman` is covering every
 * application window anyway, so there is nothing for the surface to hide.
 *
 * It goes back down, pinned again, as soon as an application window comes up:
 * one taking the foreground, or one appearing or being restored without it.
 * Seelen's own windows and the shell's chrome do not count - the dock, the
 * start menu, this surface taking the keyboard - because they do not end
 * Explorer's show-desktop state, and sinking for them would bury the surface
 * again.
 *
 * Every replica runs its own: `Progman` spans all displays, and each replica
 * can only move its own window.
 */
export class DesktopLayer {
  /** True while the surface is raised over Explorer's desktop. */
  lifted = $state(false);

  /** Every application window the host knows about, and the ones that are up. */
  #known = new Set<number>();
  #up = new Set<number>();
  /** The window that last took the foreground. */
  #foreground: number | null = null;
  /** Window calls run one at a time, so a sink can never land inside a lift. */
  #queue: Promise<void> = Promise.resolve();

  /**
   * Starts watching and returns the teardown. Never rejects: the surface has to
   * come up whether or not this can run, so a failure is recorded instead.
   */
  async start(): Promise<UnSubscriber> {
    const offs: UnSubscriber[] = [];
    try {
      this.#track(await invoke(SeelenCommand.GetUserAppWindows));
      offs.push(
        await subscribe(SeelenEvent.GlobalFocusChanged, ({ payload }) => {
          this.#onFocus(payload as FocusedApp);
        }),
      );
      offs.push(
        await subscribe(SeelenEvent.UserAppWindowsChanged, ({ payload }) => {
          this.#onWindows(payload as UserAppWindow[]);
        }),
      );
      // Started, or reloaded, while the desktop is already being shown.
      this.#onFocus(await invoke(SeelenCommand.GetFocusedApp));
    } catch (err) {
      console.error('[desktop layer] unavailable', err);
      noteError(`desktop layer: ${messageOf(err)}`);
    }

    return () => {
      for (const off of offs.splice(0)) off();
      if (this.lifted) this.#sink('stopped');
    };
  }

  #onFocus(app: FocusedApp): void {
    this.#foreground = app.hwnd;
    if (isExplorerDesktop(app)) {
      if (!this.lifted) this.#lift();
      return;
    }
    // A window too new to be in the list yet is caught by `#onWindows` instead.
    if (this.lifted && (this.#known.has(app.hwnd) || this.#known.has(app.ownerHwnd))) {
      this.#sink(`${app.name || app.title} took the foreground`);
    }
  }

  #onWindows(windows: UserAppWindow[]): void {
    const before = this.#up;
    this.#track(windows);
    if (!this.lifted) return;

    // Show desktop leaves every window up underneath `Progman`, so a window
    // that is up now and was not before is one the user just brought back.
    const cameUp = windows.find((w) => !w.isIconic && !before.has(w.hwnd));
    if (cameUp) {
      this.#sink(`${cameUp.appName || cameUp.title} came up`);
    } else if (this.#foreground !== null && this.#known.has(this.#foreground)) {
      this.#sink('an application holds the foreground');
    }
  }

  #track(windows: UserAppWindow[]): void {
    this.#known = new Set(windows.map((w) => w.hwnd));
    this.#up = new Set(windows.filter((w) => !w.isIconic).map((w) => w.hwnd));
  }

  /**
   * Over `Progman`. The pin has to go first or tao turns the raise back into
   * `HWND_BOTTOM`, and the calls go through tao's own queue in order, so the
   * raise cannot overtake the release. Topmost-then-not is what leaves the
   * window at the top of the normal band rather than over the dock.
   */
  #lift(): void {
    this.lifted = true;
    this.#run('raised over the desktop', async (window) => {
      await window.setAlwaysOnBottom(false);
      await window.setAlwaysOnTop(true);
      await window.setAlwaysOnTop(false);
    });
  }

  /** Back under every window, and pinned there again. */
  #sink(reason: string): void {
    this.lifted = false;
    this.#run(`back to the bottom - ${reason}`, (window) => window.setAlwaysOnBottom(true));
  }

  #run(label: string, steps: (window: typeof Widget.self.window) => Promise<void>): void {
    this.#queue = this.#queue.then(async () => {
      try {
        await steps(Widget.self.window);
        noteAction(`desktop layer: ${label}`);
      } catch (err) {
        console.error(`[desktop layer] ${label} failed`, err);
        noteError(`desktop layer: ${label} failed ${messageOf(err)}`);
      }
    });
  }
}
