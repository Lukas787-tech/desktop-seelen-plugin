import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import { NotificationsMode } from '@seelen-ui/lib/types';
import type { AppNotification, Toast } from '@seelen-ui/lib/types';

/** Everything currently sitting in Windows' Action Center, newest first. */
export const notifications = hostValue<AppNotification[]>({
  label: 'notifications',
  initial: [],
  load: () => invoke(SeelenCommand.GetNotifications),
  listen: (apply) => subscribe(SeelenEvent.Notifications, (e) => apply(e.payload)),
});

/** Windows' "focus assist": true while notifications are being held back. */
export const focusAssist = hostValue<boolean>({
  label: 'notifications',
  initial: false,
  load: () => invoke(SeelenCommand.GetFocusAssist),
  listen: (apply) => subscribe(SeelenEvent.FocusAssistChanged, (e) => apply(e.payload)),
});

/** Which notifications get through while focus assist is on. */
export const notificationsMode = hostValue<NotificationsMode>({
  label: 'notifications',
  initial: NotificationsMode.All,
  load: () => invoke(SeelenCommand.GetNotificationsMode),
  listen: (apply) => subscribe(SeelenEvent.NotificationsModeChanged, (e) => apply(e.payload)),
});

export const NOTIFICATION_MODES: readonly { label: string; value: NotificationsMode }[] = [
  { label: 'Everything', value: NotificationsMode.All },
  { label: 'Priority only', value: NotificationsMode.PriorityOnly },
  { label: 'Alarms only', value: NotificationsMode.AlarmsOnly },
];

export function setFocusAssist(enabled: boolean): void {
  tell('notifications', invoke(SeelenCommand.SetFocusAssist, { enabled }));
}

export function setNotificationsMode(mode: NotificationsMode): void {
  tell('notifications', invoke(SeelenCommand.SetNotificationsMode, { mode }));
}

export function dismiss(id: number): void {
  tell('notifications', invoke(SeelenCommand.NotificationsClose, { id }));
}

export function dismissAll(): void {
  tell('notifications', invoke(SeelenCommand.NotificationsCloseAll));
}

/**
 * Opens what the notification points at, as clicking the toast would.
 *
 * The launch string and activation type come from the toast itself; a
 * notification with no launch argument still activates its app, which is the
 * behaviour Action Center has.
 */
export function activate(notification: AppNotification): void {
  tell(
    'notifications',
    invoke(SeelenCommand.ActivateNotification, {
      id: notification.id,
      umid: notification.appUmid,
      args: notification.content['@launch'] ?? '',
      activationType: notification.content['@activationType'],
      inputData: {},
    }),
  );
}

/**
 * The text lines of a toast, in order.
 *
 * A toast is the Windows XML schema mapped into JSON: text can sit directly in
 * the binding or inside a group's subgroups (the two-column layouts), so both
 * have to be walked to get a title and a body out of it.
 */
export function toastLines(toast: Toast): string[] {
  const lines: string[] = [];
  for (const child of toast.visual.binding.$value) {
    if ('text' in child) {
      const value = child.text.$value.trim();
      if (value) lines.push(value);
    } else if ('group' in child) {
      for (const subgroup of child.group.subgroup) {
        for (const inner of subgroup.$value) {
          if ('text' in inner) {
            const value = inner.text.$value.trim();
            if (value) lines.push(value);
          }
        }
      }
    }
  }
  return lines;
}

/** `now`, `3 m`, `2 h`, then the date - the usual notification stamp. */
export function relativeTime(epochMs: number, now = Date.now()): string {
  const seconds = Math.round((now - epochMs) / 1000);
  if (!Number.isFinite(seconds) || seconds < 45) return 'now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return new Date(epochMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
