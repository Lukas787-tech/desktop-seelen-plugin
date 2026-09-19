<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { formatBytes, formatRate, system } from '$lib/system.svelte';

  const cfg = $derived(config.current);

  $effect(() => system.acquire());

  /** Builds an SVG polyline for a 0-100 series, newest sample on the right. */
  function sparkline(values: number[], width = 100, height = 28): string {
    if (values.length < 2) return '';
    const step = width / (values.length - 1);
    return values
      .map((v, i) => {
        const y = height - (Math.max(0, Math.min(100, v)) / 100) * height;
        return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const memory = $derived(system.memory);
  const usedBytes = $derived(memory ? memory.total - memory.free : 0);

  // Only the fixed, internal disks are interesting on a desktop panel.
  const disks = $derived(system.disks.filter((d) => !d.isRemovable));
</script>

<div class="sysmon">
  {#if cfg.sysmonCpu}
    <div class="metric">
      <div class="head">
        <span class="label">CPU</span>
        <span class="value">{system.cpuUsage.toFixed(0)}%</span>
      </div>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={sparkline(system.cpuHistory)} />
      </svg>
      <span class="sub">{system.cores.length} cores</span>
    </div>
  {/if}

  {#if cfg.sysmonRam}
    <div class="metric">
      <div class="head">
        <span class="label">Memory</span>
        <span class="value">{(system.memoryUsedRatio * 100).toFixed(0)}%</span>
      </div>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={sparkline(system.ramHistory)} />
      </svg>
      {#if memory}
        <span class="sub">{formatBytes(usedBytes)} / {formatBytes(memory.total)}</span>
      {/if}
    </div>
  {/if}

  {#if cfg.sysmonNet}
    <div class="metric row">
      <span class="label">Network</span>
      <span class="sub net">
        <span title="Download">&#8595; {formatRate(system.downloadRate)}</span>
        <span title="Upload">&#8593; {formatRate(system.uploadRate)}</span>
      </span>
    </div>
  {/if}

  {#if cfg.sysmonDisk}
    {#each disks as disk (disk.mountPoint)}
      {@const used = disk.totalSpace - disk.availableSpace}
      {@const pct = disk.totalSpace > 0 ? (used / disk.totalSpace) * 100 : 0}
      <div class="metric">
        <div class="head">
          <span class="label">{disk.mountPoint}</span>
          <span class="value">{pct.toFixed(0)}%</span>
        </div>
        <div class="track">
          <div class="fill" style:width="{pct}%"></div>
        </div>
        <span class="sub">{formatBytes(disk.availableSpace)} free</span>
      </div>
    {/each}
  {/if}
</div>

<style>
  .sysmon {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric.row {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .label {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .value {
    font-size: calc(13px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
  }

  .sub {
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .net {
    display: flex;
    gap: 10px;
  }

  svg {
    width: 100%;
    height: 28px;
  }

  /* The document accent, so the lines follow the theme like everything else. */
  polyline {
    stroke: var(--accent, #7aa2f7);
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .track {
    height: 4px;
    border-radius: calc(999px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .fill {
    height: 100%;
    background: var(--accent, #7aa2f7);
  }
</style>
