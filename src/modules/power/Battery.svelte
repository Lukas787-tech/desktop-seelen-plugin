<script lang="ts">
  import { config } from '$lib/config.svelte';
  import {
    batteries,
    chargeRatio,
    formatDuration,
    healthRatio,
    onMains,
    powerMode,
    powerStatus,
    secondsRemaining,
  } from '$lib/power.svelte';

  const cfg = $derived(config.current);

  $effect(() => batteries.acquire());
  $effect(() => powerStatus.acquire());
  $effect(() => (cfg.batteryShowPowerMode ? powerMode.acquire() : undefined));

  const packs = $derived(batteries.current);
  const status = $derived(powerStatus.current);
  const remaining = $derived(secondsRemaining(status));
</script>

<div class="m-body">
  <div class="source">
    <span class="m-title">{onMains(status) ? 'Plugged in' : 'On battery'}</span>
    {#if cfg.batteryShowPowerMode && powerMode.current}
      <span class="m-pill">{powerMode.current}</span>
    {/if}
  </div>

  {#each packs as battery, i (`${battery.serialNumber ?? battery.model ?? 'battery'}-${i}`)}
    {@const charge = chargeRatio(battery)}
    <div class="pack">
      <div class="line">
        <span class="m-sub">{battery.model ?? battery.vendor ?? `Battery ${i + 1}`}</span>
        <span class="m-value">{(charge * 100).toFixed(0)}%</span>
      </div>
      <div class="m-bar"><span style:width="{charge * 100}%"></span></div>
      <div class="line">
        <span class="m-sub">
          {battery.state}{#if remaining}&nbsp;&middot; {formatDuration(remaining)} left{/if}
        </span>
        {#if cfg.batteryShowRate && battery.energyRate > 0}
          <span class="m-sub">{battery.energyRate.toFixed(1)} W</span>
        {/if}
      </div>
      {#if cfg.batteryShowHealth}
        <span class="m-sub">Health {(healthRatio(battery) * 100).toFixed(0)}% of design capacity</span>
      {/if}
    </div>
  {:else}
    <p class="m-empty">
      No battery reported &mdash; this machine runs on mains power.
    </p>
  {/each}
</div>

<style>
  .source {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
  }

  .pack {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
</style>
