import { coalesced, hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import type { MonitorBrightness, RadioDevice } from '@seelen-ui/lib/types';

/**
 * Display brightness, per physical monitor.
 *
 * Only panels that answer DDC/CI (or an internal laptop panel) appear here, so
 * an empty list is the normal case on a desktop with older monitors rather
 * than a failure.
 *
 * The entries are keyed by WMI instance name, which is not the monitor id the
 * rest of this widget uses, so a replica cannot pick out "its own" display -
 * every controllable monitor is offered instead.
 */
export const brightness = hostValue<MonitorBrightness[]>({
  label: 'brightness',
  initial: [],
  load: () => invoke(SeelenCommand.GetAllMonitorsBrightness),
  listen: (apply) => subscribe(SeelenEvent.SystemMonitorsBrightnessChanged, (e) => apply(e.payload)),
});

/** Wi-Fi, bluetooth and any other radio Windows lets us switch. */
export const radios = hostValue<RadioDevice[]>({
  label: 'radios',
  initial: [],
  load: () => invoke(SeelenCommand.GetRadios),
  listen: (apply) => subscribe(SeelenEvent.RadiosChanged, (e) => apply(e.payload)),
});

/**
 * The levels a monitor will accept.
 *
 * `availableLevels` is authoritative when the panel reports one; some report
 * none and take any percentage.
 */
export function levelsOf(monitor: MonitorBrightness): number[] {
  if (monitor.availableLevels.length > 1) return monitor.availableLevels;
  return Array.from({ length: 101 }, (_, i) => i);
}

/** Snaps to the nearest level the monitor actually accepts. */
export function setBrightness(monitor: MonitorBrightness, wanted: number): void {
  const levels = levelsOf(monitor);
  let level = levels[0] ?? wanted;
  for (const candidate of levels) {
    if (Math.abs(candidate - wanted) < Math.abs(level - wanted)) level = candidate;
  }
  // DDC/CI takes tens of milliseconds per request, so a dragged slider only
  // ever sends the newest level; see `coalesced`.
  sendBrightness(monitor.instanceName, () =>
    invoke(SeelenCommand.SetMonitorBrightness, { instanceName: monitor.instanceName, level }),
  );
}

const sendBrightness = coalesced('brightness');

export function setRadio(device: RadioDevice, enabled: boolean): void {
  tell('radios', invoke(SeelenCommand.SetRadioState, { kind: device.kind, enabled }));
}

/** Instance names are WMI paths; the tail is the only part worth showing. */
export function shortMonitorName(instanceName: string): string {
  const parts = instanceName.split('\\').filter(Boolean);
  return parts[1] ?? parts[0] ?? instanceName;
}
