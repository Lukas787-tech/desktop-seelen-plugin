import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import type { BluetoothDevice } from '@seelen-ui/lib/types';

/**
 * Bluetooth devices known to Windows.
 *
 * Paired devices are always listed; unpaired ones only appear while a scan is
 * running. Pairing itself is not offered: the host has a pin-confirmation
 * command but emits no event carrying the pin request, so a widget cannot
 * complete the exchange - Windows' own Settings can.
 */
export const bluetoothDevices = hostValue<BluetoothDevice[]>({
  label: 'bluetooth',
  initial: [],
  load: () => invoke(SeelenCommand.GetBluetoothDevices),
  listen: (apply) => subscribe(SeelenEvent.BluetoothDevicesChanged, (e) => apply(e.payload)),
});

export function startScanning(): void {
  tell('bluetooth', invoke(SeelenCommand.StartBluetoothScanning));
}

export function stopScanning(): void {
  tell('bluetooth', invoke(SeelenCommand.StopBluetoothScanning));
}

export function connectDevice(id: string): void {
  tell('bluetooth', invoke(SeelenCommand.ConnectBluetoothDevice, { id }));
}

export function disconnectDevice(id: string): void {
  tell('bluetooth', invoke(SeelenCommand.DisconnectBluetoothDevice, { id }));
}

export function forgetDevice(id: string): void {
  tell('bluetooth', invoke(SeelenCommand.ForgetBluetoothDevice, { id }));
}

/** Connected first, then paired, then everything a scan turned up. */
export function sortDevices(devices: readonly BluetoothDevice[]): BluetoothDevice[] {
  const rank = (d: BluetoothDevice) => (d.connected ? 0 : d.paired ? 1 : 2);
  return devices
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (a.name || '').localeCompare(b.name || ''));
}

/** A rough glyph per device class, so a list of names is scannable. */
export function deviceGlyph(device: BluetoothDevice): string {
  switch (device.class.major) {
    case 'AudioVideo':
      return '\u{1F3A7}';
    case 'Phone':
      return '\u{1F4F1}';
    case 'Computer':
      return '\u{1F4BB}';
    case 'Peripheral':
      return '\u2328';
    case 'Wearable':
      return '\u231A';
    case 'Imaging':
      return '\u{1F5A8}';
    case 'Health':
      return '\u2695';
    case 'Toy':
      return '\u{1F3AE}';
    default:
      return '\u25CF';
  }
}
