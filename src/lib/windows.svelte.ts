import { hostValue, tell } from './live.svelte';
import { noteAction, noteError } from './diagnostics';
import { SeelenCommand, SeelenEvent, Widget, invoke, subscribe } from './seelen';
import type { UserAppWindow } from '@seelen-ui/lib/types';

/**
 * Every user-facing window the host tracks, newest-focused first.
 *
 * The list is the same one Seelen's own dock is built from, so it is already
 * filtered down to real application windows - tool windows, hidden windows and
 * the host's own widgets do not appear.
 */
export const openWindows = hostValue<UserAppWindow[]>({
  label: 'windows',
  initial: [],
  load: () => invoke(SeelenCommand.GetUserAppWindows),
  listen: (apply) => subscribe(SeelenEvent.UserAppWindowsChanged, (e) => apply(e.payload)),
});

/** The display this replica draws on, for "this display only" filtering. */
export function ownMonitorId(): string | null {
  return Widget.self.decoded.monitorId ?? null;
}

/**
 * Sorted for a list a person reads: most recently focused first.
 *
 * `lastForegroundAt` is 0 for a window that has never been focused since the
 * host started tracking, which would sink it to the bottom whatever its title;
 * those fall back to alphabetical order among themselves.
 */
export function sortWindows(windows: readonly UserAppWindow[]): UserAppWindow[] {
  return windows.slice().sort((a, b) => {
    if (a.lastForegroundAt !== b.lastForegroundAt) return b.lastForegroundAt - a.lastForegroundAt;
    return (a.appName || a.title).localeCompare(b.appName || b.title);
  });
}

/**
 * Puts a window away when it is up, and brings it back when it is down - the
 * host's own toggle, as the dock uses it. `wasFocused` is the caller's claim
 * about which of the two it means, not the window's real focus state.
 */
export function toggleWindow(hwnd: number, wasFocused: boolean): void {
  tell('windows', invoke(SeelenCommand.WegToggleWindowState, { hwnd, wasFocused }));
}

/**
 * Brings a window up and gives it the keyboard - what clicking its row means.
 *
 * `request_focus` on its own is not enough, and the case it misses is the only
 * one this panel is ever read in: the surface is behind every window, so it is
 * looked at when the windows are *down*, and almost every row in the list is a
 * minimised window. Asking to focus a minimised window leaves it minimised,
 * which is a click that does nothing at all.
 *
 * `weg_toggle_window_state` with `wasFocused: false` is the host's own "this
 * was put away, bring it back" - the restoring half of the toggle the dock
 * uses, and the half `showDesktop` already relies on. It is sent only for a
 * window that is actually down, and the state is re-read first rather than
 * taken from the row that was clicked: it is a *toggle*, so sending it to a
 * window that is already up risks putting away the window the user just asked
 * for.
 *
 * The outcome is checked rather than assumed: the list is re-read shortly
 * after and the result recorded, because nothing else here can tell the
 * difference between a command the host accepted and a window that actually
 * came back.
 */
export async function activateWindow(hwnd: number, label: string): Promise<void> {
  try {
    const before = await invoke(SeelenCommand.GetUserAppWindows);
    if (before.find((w) => w.hwnd === hwnd)?.isIconic) {
      await invoke(SeelenCommand.WegToggleWindowState, { hwnd, wasFocused: false });
    }
    await invoke(SeelenCommand.RequestFocus, { hwnd });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    noteError(`windows: activate ${label} ${message}`);
    return;
  }

  // Long enough for the restore and the foreground change to have landed, and
  // short enough that the answer still belongs to this click.
  await new Promise((done) => setTimeout(done, 400));
  try {
    const after = await invoke(SeelenCommand.GetUserAppWindows);
    const window = after.find((w) => w.hwnd === hwnd);
    if (!window) noteAction(`windows: activate ${label} - gone from the list`);
    else noteAction(`windows: activate ${label} - ${window.isIconic ? 'STILL MINIMISED' : 'up'}`);
  } catch {
    // The check is a courtesy; failing it changes nothing on screen.
  }
}

/** Asks the window to close, exactly as its own close button would. */
export function closeWindow(hwnd: number): void {
  tell('windows', invoke(SeelenCommand.WegCloseApp, { hwnd }));
}

/**
 * What we minimised the last time the desktop was revealed, so a second call
 * puts it back. Module-level because the palette is rebuilt on every summon.
 */
let minimisedByUs: number[] = [];

/**
 * Reveals the desktop by minimising the windows, not by asking Windows to
 * "show the desktop".
 *
 * Win+D and the taskbar's corner button both focus Explorer's `Progman` and
 * lift it out of the bottom of the z-order, over this surface. `DesktopLayer`
 * climbs back over it, but only once the stock wallpaper has already flashed
 * up, and Windows' version leaves every window up underneath.
 *
 * Minimising each window instead reveals exactly the same thing and never
 * touches `Progman`, so the surface never has to move at all.
 *
 * Toggles: a second call restores what the first one minimised, as Win+D does.
 */
export async function showDesktop(): Promise<void> {
  // Read the list rather than taking it from the store: this is called from the
  // palette too, which holds no subscription of its own.
  let open: UserAppWindow[];
  try {
    open = await invoke(SeelenCommand.GetUserAppWindows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    noteError(`windows: show desktop ${message}`);
    return;
  }

  const up = open.filter((w) => !w.isIconic);

  if (up.length) {
    // `wasFocused: true` is the minimise half of the host's toggle: it reads as
    // "this was up, put it away" rather than as the window's real focus state.
    for (const w of up) {
      toggleWindow(w.hwnd, true);
    }
    minimisedByUs = up.map((w) => w.hwnd);
    return;
  }

  // Nothing is up, so this is the second press: put back what we put away, or
  // everything that is down if this replica has no memory of doing it.
  const remembered = minimisedByUs.filter((hwnd) => open.some((w) => w.hwnd === hwnd));
  const toRestore = remembered.length ? remembered : open.map((w) => w.hwnd);
  for (const hwnd of toRestore) {
    toggleWindow(hwnd, false);
  }
  minimisedByUs = [];
}
