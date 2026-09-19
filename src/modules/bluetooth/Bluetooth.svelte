<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    bluetoothDevices,
    connectDevice,
    deviceGlyph,
    disconnectDevice,
    forgetDevice,
    sortDevices,
    startScanning,
    stopScanning,
  } from '$lib/bluetooth.svelte';
  import { radios, setRadio } from '$lib/quick.svelte';
  import type { BluetoothDevice } from '@seelen-ui/lib/types';

  const cfg = $derived(config.current);

  $effect(() => bluetoothDevices.acquire());
  $effect(() => (cfg.bluetoothShowRadio ? radios.acquire() : undefined));

  let scanning = $state(false);

  // A scan left running would keep the radio busy after the panel is hidden,
  // so it is always stopped on the way out.
  $effect(() => () => {
    if (scanning) stopScanning();
  });

  const radio = $derived(radios.current.find((r) => r.kind === 'Bluetooth') ?? null);

  const listed = $derived(
    sortDevices(
      cfg.bluetoothPairedOnly
        ? bluetoothDevices.current.filter((d) => d.paired)
        : bluetoothDevices.current,
    ),
  );

  function toggleScan() {
    scanning = !scanning;
    if (scanning) startScanning();
    else stopScanning();
  }

  function press(device: BluetoothDevice) {
    if (device.connected) {
      if (device.canDisconnect) disconnectDevice(device.id);
      return;
    }
    if (device.canConnect) connectDevice(device.id);
  }

  function status(device: BluetoothDevice): string {
    if (device.connected) return 'Connected';
    if (device.paired) return 'Paired';
    return device.canPair ? 'Pair from Windows Settings' : 'Nearby';
  }
</script>

<div class="m-body" data-no-drag>
  <div class="top">
    {#if cfg.bluetoothShowRadio && radio}
      <label class="m-row m-click">
        <span class="m-text"><span class="m-title">Bluetooth</span></span>
        <input
          type="checkbox"
          class="m-switch"
          role="switch"
          checked={radio.is_enabled}
          onchange={(e) => setRadio(radio, e.currentTarget.checked)}
        />
      </label>
    {/if}
    <button class="m-btn" onclick={toggleScan}>{scanning ? 'Stop scan' : 'Scan'}</button>
  </div>

  <ul class="m-list">
    {#each listed as device (device.id)}
      <li class="m-row" class:on={device.connected}>
        <span class="m-glyph">{deviceGlyph(device)}</span>
        <button class="open" onclick={() => press(device)}>
          <span class="m-text">
            <span class="m-title">{device.name || 'Unnamed device'}</span>
            <span class="m-sub">{status(device)}</span>
          </span>
        </button>
        {#if device.paired}
          <button
            class="m-quiet"
            title="Forget this device"
            aria-label="Forget {device.name}"
            onclick={() => forgetDevice(device.id)}
          >
            &times;
          </button>
        {/if}
      </li>
    {:else}
      <li class="m-empty">
        {cfg.bluetoothPairedOnly ? 'No paired devices.' : 'No devices. Start a scan to look.'}
      </li>
    {/each}
  </ul>
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .top label {
    flex: 1;
    cursor: pointer;
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    text-align: left;
    cursor: pointer;
  }

  .m-row:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .on .m-title {
    color: var(--panel-fg);
  }
</style>
