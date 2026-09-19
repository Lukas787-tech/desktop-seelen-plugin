import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import { SystrayIconAction } from '@seelen-ui/lib/types';
import type { SysTrayIcon } from '@seelen-ui/lib/types';

/**
 * The notification-area icons, as Seelen's own toolbar reads them.
 *
 * The host tracks the tray itself - which icons exist, their tooltips, and an
 * extracted image for each - and forwards clicks to the owning application
 * through the same message the real taskbar would send, so a left click opens
 * what it opens there and a right click raises the app's own menu at the
 * pointer.
 */
export const trayIcons = hostValue<SysTrayIcon[]>({
  label: 'tray',
  initial: [],
  load: () => invoke(SeelenCommand.GetSystemTrayIcons),
  listen: (apply) => subscribe(SeelenEvent.SystemTrayChanged, (e) => apply(e.payload as SysTrayIcon[])),
});

export { SystrayIconAction };

export function trayAction(icon: SysTrayIcon, action: SystrayIconAction): void {
  tell('tray', invoke(SeelenCommand.SendSystemTrayIconAction, { id: icon.stable_id, action }));
}

/** A stable key for a keyed list, from whichever identity the icon carries. */
export function trayKey(icon: SysTrayIcon): string {
  const id = icon.stable_id;
  return 'Guid' in id ? `guid:${id.Guid}` : `uid:${id.HandleUid[0]}:${id.HandleUid[1]}`;
}

/** The first line of the tooltip, which is where an app puts its name. */
export function trayLabel(icon: SysTrayIcon): string {
  const first = icon.tooltip.split(/\r?\n/)[0]?.trim();
  return first || 'Unnamed icon';
}
