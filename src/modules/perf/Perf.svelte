<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { niceMax } from '$lib/charts';
  import { HISTORY, formatBytes, formatRate, system } from '$lib/system.svelte';
  import Graph from '../Graph.svelte';

  const cfg = $derived(config.current);

  $effect(() => system.acquire());

  type Tab = 'cpu' | 'memory' | 'disk' | 'network';
  // Which tab the panel opens on is a setting; switching afterwards is not.
  let tab = $state<Tab>(config.current.perfDefaultTab);

  const span = $derived(`${Math.max(1, Math.round((HISTORY * system.sampleSeconds) / 60))} min`);
  const graphHeight = $derived(cfg.perfShowCores && tab === 'cpu' ? 64 : 84);

  const memory = $derived(system.memory);
  const used = $derived(memory ? memory.total - memory.free : 0);
  const swapUsed = $derived(memory ? memory.swapTotal - memory.swapFree : 0);

  const diskTotal = $derived(
    Object.values(system.diskRates).reduce((sum, r) => sum + r.read + r.write, 0),
  );
  const diskMax = $derived(niceMax(Math.max(0, ...system.diskHistory), 1024 * 1024));
  const netMax = $derived(niceMax(Math.max(0, ...system.downHistory, ...system.upHistory), 64 * 1024));

  /** Busy disks and adapters first; a machine lists a lot of idle virtual ones. */
  const disks = $derived(
    system.disks
      .slice()
      .sort((a, b) => Number(a.isRemovable) - Number(b.isRemovable) || a.mountPoint.localeCompare(b.mountPoint)),
  );
  const adapters = $derived(
    system.network
      .map((stat) => ({ stat, rate: system.adapterRates[stat.name] ?? { down: 0, up: 0 } }))
      .filter(({ stat }) => stat.received + stat.transmitted > 0)
      .sort((a, b) => b.rate.down + b.rate.up - (a.rate.down + a.rate.up) || b.stat.received - a.stat.received),
  );

  const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
  const ghz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : '–');
</script>

<div class="m-body" data-no-drag>
  <nav class="m-tabs">
    <button class:m-on={tab === 'cpu'} onclick={() => (tab = 'cpu')}>
      CPU <span class="figure">{Math.round(system.cpuUsage)}%</span>
    </button>
    <button class:m-on={tab === 'memory'} onclick={() => (tab = 'memory')}>
      RAM <span class="figure">{pct(system.memoryUsedRatio)}</span>
    </button>
    <button class:m-on={tab === 'disk'} onclick={() => (tab = 'disk')}>Disk</button>
    <button class:m-on={tab === 'network'} onclick={() => (tab = 'network')}>Net</button>
  </nav>

  {#if tab === 'cpu'}
    <div class="head">
      <span class="m-stat big">{system.cpuUsage.toFixed(0)}<small>%</small></span>
      <span class="m-text">
        <span class="m-title" title={system.cpuBrand}>{system.cpuBrand || 'Processor'}</span>
        <span class="m-sub">{system.cores.length} logical cores · {ghz(system.cpuFrequency)}</span>
      </span>
    </div>
    <Graph
      series={[{ values: system.cpuHistory, max: 100, fill: cfg.perfFillGraph }]}
      slots={HISTORY}
      height={graphHeight}
      grid={cfg.perfShowGrid ? 3 : 0}
      caption="100% · {span}"
    />
    {#if cfg.perfShowCores}
      <div class="cores m-scroll" role="list" aria-label="Load per core">
        {#each system.cores as core, i (`${core.name}-${i}`)}
          <span
            class="core"
            role="listitem"
            title="{core.name}: {Math.round(core.usage)}%"
            style:--load={Math.round(core.usage)}
          >
            <span class="fill"></span>
            <span class="n">{Math.round(core.usage)}</span>
          </span>
        {/each}
      </div>
    {/if}
  {:else if tab === 'memory'}
    <div class="head">
      <span class="m-stat big">{(system.memoryUsedRatio * 100).toFixed(0)}<small>%</small></span>
      <span class="m-text">
        <span class="m-title">{formatBytes(used)} in use</span>
        <span class="m-sub">{memory ? `${formatBytes(memory.free)} available of ${formatBytes(memory.total)}` : 'Waiting for the host...'}</span>
      </span>
    </div>
    <Graph
      series={[{ values: system.ramHistory, max: 100, fill: cfg.perfFillGraph }]}
      slots={HISTORY}
      height={graphHeight}
      grid={cfg.perfShowGrid ? 3 : 0}
      caption="100% · {span}"
    />
    <div class="m-scroll bars">
      <div class="bar-row">
        <span class="m-sub">Memory</span>
        <div class="m-bar"><span style:width={pct(system.memoryUsedRatio)}></span></div>
        <span class="m-value">{pct(system.memoryUsedRatio)}</span>
      </div>
      {#if memory && memory.swapTotal > 0}
        <div class="bar-row">
          <span class="m-sub">Page file</span>
          <div class="m-bar swap"><span style:width={pct(system.swapUsedRatio)}></span></div>
          <span class="m-value">{pct(system.swapUsedRatio)}</span>
        </div>
        <span class="m-sub">{formatBytes(swapUsed)} of {formatBytes(memory.swapTotal)} page file in use</span>
      {/if}
    </div>
  {:else if tab === 'disk'}
    <div class="head">
      <span class="m-stat mid">{formatRate(diskTotal)}</span>
      <span class="m-sub">read and write, every disk</span>
    </div>
    <Graph
      series={[{ values: system.diskHistory, max: diskMax, fill: cfg.perfFillGraph }]}
      slots={HISTORY}
      height={graphHeight}
      grid={cfg.perfShowGrid ? 3 : 0}
      caption="{formatRate(diskMax)} · {span}"
    />
    <ul class="m-list">
      {#each disks as disk (disk.mountPoint)}
        {@const usedRatio = disk.totalSpace > 0 ? 1 - disk.availableSpace / disk.totalSpace : 0}
        {@const rate = system.diskRates[disk.mountPoint]}
        <li class="disk">
          <div class="line">
            <span class="m-title">{disk.mountPoint}</span>
            <span class="m-sub name">{disk.name}{disk.isRemovable ? ' · removable' : ''}</span>
            <span class="m-value">{pct(usedRatio)}</span>
          </div>
          <div class="m-bar" class:full={usedRatio > 0.9}><span style:width={pct(usedRatio)}></span></div>
          <div class="line">
            <span class="m-sub">{formatBytes(disk.availableSpace)} free of {formatBytes(disk.totalSpace)}</span>
            {#if rate && rate.read + rate.write > 0}
              <span class="m-sub io">R {formatRate(rate.read)} · W {formatRate(rate.write)}</span>
            {/if}
          </div>
        </li>
      {:else}
        <li class="m-empty">No disks reported.</li>
      {/each}
    </ul>
  {:else}
    <div class="head net">
      <span class="m-text">
        <span class="m-value down">&#8595; {formatRate(system.downloadRate)}</span>
        <span class="m-value up">&#8593; {formatRate(system.uploadRate)}</span>
      </span>
    </div>
    <Graph
      series={[
        { values: system.downHistory, max: netMax, fill: cfg.perfFillGraph },
        { values: system.upHistory, max: netMax, tone: 'warm' },
      ]}
      slots={HISTORY}
      height={graphHeight}
      grid={cfg.perfShowGrid ? 3 : 0}
      caption="{formatRate(netMax)} · {span}"
    />
    <ul class="m-list">
      {#each adapters as { stat, rate } (stat.name)}
        <li class="m-row adapter">
          <span class="m-text">
            <span class="m-title">{stat.name}</span>
            <span class="m-sub">{formatBytes(stat.received)} in · {formatBytes(stat.transmitted)} out</span>
          </span>
          <span class="m-sub rates">
            <span>&#8595; {formatRate(rate.down)}</span>
            <span>&#8593; {formatRate(rate.up)}</span>
          </span>
        </li>
      {:else}
        <li class="m-empty">No network traffic reported yet.</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .figure {
    font-size: calc(10px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .big {
    font-size: calc(var(--ui-size) * 2.3);
  }

  .mid {
    font-size: calc(var(--ui-size) * 1.6);
  }

  small {
    font-size: 0.5em;
    margin-left: 1px;
  }

  .cores {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
    gap: 3px;
    align-content: start;
  }

  .core {
    position: relative;
    height: 22px;
    border-radius: calc(5px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
  }

  .core .fill {
    position: absolute;
    inset: auto 0 0;
    height: calc(var(--load) * 1%);
    background: color-mix(in oklab, var(--accent, #7aa2f7) calc(35% + var(--load) * 0.6%), transparent);
    transition: height 0.4s ease;
  }

  .core .n {
    position: relative;
    display: grid;
    place-items: center;
    height: 100%;
    font-size: calc(9px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
    color: var(--panel-fg);
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 2px;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 5.2em 1fr 3em;
    align-items: center;
    gap: 8px;
  }

  .bar-row .m-value {
    text-align: right;
    font-size: calc(11px * var(--text-scale, 1));
  }

  .swap > span {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 20%, #f2a65a);
  }

  .m-bar.full > span {
    background: var(--color-red-600, #e5534b);
  }

  .disk {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: calc(5px * var(--density)) 0;
    border-bottom: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
  }

  .disk:last-child {
    border-bottom: 0;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  .line .name {
    flex: 1;
    min-width: 0;
  }

  .io {
    margin-left: auto;
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .net .m-text {
    flex-direction: row;
    gap: 14px;
  }

  .down {
    color: var(--accent, #7aa2f7);
  }

  .up {
    color: color-mix(in oklab, var(--accent, #7aa2f7) 20%, #f2a65a);
  }

  .rates {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-variant-numeric: tabular-nums;
  }
</style>
