<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    adapters,
    internetConnected,
    localIp,
    signalBars,
    uniqueNetworks,
    wlan,
  } from '$lib/network.svelte';
  import type { WlanBssEntry } from '@seelen-ui/lib/types';

  const cfg = $derived(config.current);

  $effect(() => internetConnected.acquire());
  $effect(() => (cfg.networkShowIp ? localIp.acquire() : undefined));
  $effect(() => (cfg.networkShowAdapters ? adapters.acquire() : undefined));
  $effect(() => (cfg.networkShowWifi ? wlan.acquire() : undefined));

  /** The network whose password is being asked for, if any. */
  let asking = $state<string | null>(null);
  let password = $state('');

  const networks = $derived(uniqueNetworks(wlan.entries));
  const up = $derived(adapters.current.filter((a) => a.status === 'up'));

  function select(entry: WlanBssEntry) {
    if (entry.connected) {
      wlan.disconnect();
      return;
    }
    // Windows can reconnect to a saved profile and to an open network on its
    // own; anything else genuinely needs the key typed in.
    if (entry.known || !entry.secured) {
      wlan.connect(entry.ssid ?? '', null);
      return;
    }
    asking = entry.ssid;
    password = '';
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!asking) return;
    wlan.connect(asking, password);
    asking = null;
    password = '';
  }
</script>

<div class="m-body" data-no-drag>
  <div class="status">
    <span class="dot" class:on={internetConnected.current}></span>
    <span class="m-text">
      <span class="m-title">{internetConnected.current ? 'Online' : 'No internet'}</span>
      {#if cfg.networkShowIp && localIp.current}
        <span class="m-sub">{localIp.current}</span>
      {/if}
    </span>
    {#if cfg.networkShowWifi}
      <button class="m-btn" disabled={wlan.scanning} onclick={() => wlan.scan()}>
        {wlan.scanning ? 'Scanning...' : 'Scan'}
      </button>
    {/if}
  </div>

  {#if asking}
    <form class="ask" onsubmit={submit}>
      <input
        type="password"
        bind:value={password}
        placeholder="Password for {asking}"
        aria-label="Network password"
      />
      <button class="m-btn m-primary" type="submit">Join</button>
      <button class="m-btn" type="button" onclick={() => (asking = null)}>Cancel</button>
    </form>
  {/if}

  <ul class="m-list">
    {#if cfg.networkShowWifi}
      {#each networks as entry (entry.ssid)}
        <li>
          <button class="m-row" class:m-active={entry.connected} onclick={() => select(entry)}>
            <span class="bars" aria-label="{entry.signal}% signal">
              {#each [1, 2, 3, 4] as bar (bar)}
                <span class:lit={bar <= signalBars(entry.signal)}></span>
              {/each}
            </span>
            <span class="m-text">
              <span class="m-title">{entry.ssid}</span>
              <span class="m-sub">
                {entry.connected ? 'Connected' : entry.known ? 'Saved' : entry.auth}
              </span>
            </span>
            {#if entry.secured}<span class="m-glyph" title={entry.auth}>&#128274;</span>{/if}
          </button>
        </li>
      {:else}
        <li class="m-empty">
          {wlan.scanning ? 'Looking for networks...' : 'No wireless networks found.'}
        </li>
      {/each}
    {/if}

    {#if cfg.networkShowAdapters}
      {#each up as adapter (`${adapter.name}-${adapter.mac}`)}
        <li class="m-row">
          <span class="m-text">
            <span class="m-title">{adapter.description || adapter.name}</span>
            <span class="m-sub">{adapter.ipv4 ?? adapter.ipv6 ?? 'no address'}</span>
          </span>
          <span class="m-pill">{adapter.type}</span>
        </li>
      {/each}
    {/if}
  </ul>
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--panel-fg-muted);
  }

  .dot.on {
    background: var(--color-green-600, #4caf50);
  }

  .ask {
    display: flex;
    gap: 6px;
    flex: none;
  }

  .ask input {
    flex: 1;
    min-width: 0;
  }

  .bars {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 12px;
    width: 16px;
  }

  .bars span {
    width: 3px;
    border-radius: 1px;
    background: var(--panel-fg-muted);
    opacity: 0.3;
  }

  .bars span:nth-child(1) { height: 25%; }
  .bars span:nth-child(2) { height: 50%; }
  .bars span:nth-child(3) { height: 75%; }
  .bars span:nth-child(4) { height: 100%; }

  .bars span.lit {
    opacity: 1;
    background: var(--accent);
  }
</style>
