import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import type { Battery, PowerMode, PowerStatus } from '@seelen-ui/lib/types';

/** Charge, health and rate for every battery the machine reports. */
export const batteries = hostValue<Battery[]>({
  label: 'power',
  initial: [],
  load: () => invoke(SeelenCommand.GetBatteries),
  listen: (apply) => subscribe(SeelenEvent.BatteriesStatus, (e) => apply(e.payload)),
});

/** Windows' own summary: mains or battery, and its estimate of what is left. */
export const powerStatus = hostValue<PowerStatus | null>({
  label: 'power',
  initial: null,
  load: () => invoke(SeelenCommand.GetPowerStatus),
  listen: (apply) => subscribe(SeelenEvent.PowerStatus, (e) => apply(e.payload)),
});

/** The active power plan, e.g. `Balanced`. */
export const powerMode = hostValue<PowerMode | null>({
  label: 'power',
  initial: null,
  load: () => invoke(SeelenCommand.GetPowerMode),
  listen: (apply) => subscribe(SeelenEvent.PowerMode, (e) => apply(e.payload)),
});

/** `acLineStatus` is 0 offline, 1 online and 255 unknown. */
export function onMains(status: PowerStatus | null): boolean {
  return status?.acLineStatus === 1;
}

/**
 * Seconds of runtime left, or null when Windows does not know yet.
 *
 * It reports -1 while it has no estimate, which is most of the first minute
 * after unplugging.
 */
export function secondsRemaining(status: PowerStatus | null): number | null {
  const seconds = status?.batteryLifeTime ?? -1;
  return seconds > 0 ? seconds : null;
}

/** `2 h 05 m`, the shape a battery estimate is usually read in. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} m`;
  return `${minutes} m`;
}

/** Every power action the host exposes, in the order a Start menu lists them. */
export const SESSION_ACTIONS = [
  { id: 'lock', label: 'Lock', command: SeelenCommand.Lock, confirm: false },
  { id: 'logout', label: 'Sign out', command: SeelenCommand.LogOut, confirm: true },
  { id: 'sleep', label: 'Sleep', command: SeelenCommand.Suspend, confirm: false },
  { id: 'hibernate', label: 'Hibernate', command: SeelenCommand.Hibernate, confirm: false },
  { id: 'restart', label: 'Restart', command: SeelenCommand.Restart, confirm: true },
  { id: 'shutdown', label: 'Shut down', command: SeelenCommand.Shutdown, confirm: true },
] as const;

export type SessionActionId = (typeof SESSION_ACTIONS)[number]['id'];

export function runSessionAction(command: (typeof SESSION_ACTIONS)[number]['command']): void {
  tell('power', invoke(command));
}

/**
 * Charge as a 0-1 ratio.
 *
 * Derived from the energy counters rather than `percentage`, whose scale the
 * host does not document - energy over its full charge is unambiguous.
 */
export function chargeRatio(battery: Battery): number {
  if (battery.energyFull > 0) return clamp01(battery.energy / battery.energyFull);
  return clamp01(battery.percentage > 1 ? battery.percentage / 100 : battery.percentage);
}

/** How much of the battery's design capacity is left, as a 0-1 ratio. */
export function healthRatio(battery: Battery): number {
  if (battery.energyFullDesign <= 0) return 1;
  return clamp01(battery.energyFull / battery.energyFullDesign);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
