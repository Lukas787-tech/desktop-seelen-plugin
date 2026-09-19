<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { icons } from '$lib/icons.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { addDays, fromDateKey, toDateKey } from '$lib/agenda';
  import { formatSpent, usage } from '$lib/usage.svelte';

  interface Props {
    covered: boolean;
  }

  let { covered }: Props = $props();

  const cfg = $derived(config.current);

  $effect(() => usage.acquire());
  $effect(() => usage.configure(cfg.usageIdleMinutes, cfg.usageIgnore));

  let tab = $state<'today' | 'week'>('today');
  const view = $derived(cfg.usageShowWeek ? tab : 'today');

  // The day key is re-read when the panel comes back into view, which is
  // the only time a stale "today" could be seen.
  let today = $state(toDateKey(new Date()));
  $effect(() => {
    if (covered) return;
    today = toDateKey(new Date());
    const timer = setInterval(() => (today = toDateKey(new Date())), 60_000);
    return () => clearInterval(timer);
  });

  const week = $derived(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)));

  function totalOf(day: string): number {
    return Object.values(usage.data.days[day] ?? {}).reduce((sum, s) => sum + s, 0);
  }

  function ranked(days: readonly string[]): { key: string; seconds: number }[] {
    const sums = new Map<string, number>();
    for (const day of days) {
      for (const [key, seconds] of Object.entries(usage.data.days[day] ?? {})) {
        sums.set(key, (sums.get(key) ?? 0) + seconds);
      }
    }
    return [...sums.entries()]
      .map(([key, seconds]) => ({ key, seconds }))
      .filter((row) => row.seconds >= 30)
      .sort((a, b) => b.seconds - a.seconds);
  }

  const todayTotal = $derived(totalOf(today));
  const average = $derived.by(() => {
    const previous = week.slice(0, 6).map(totalOf).filter((s) => s > 0);
    return previous.length ? previous.reduce((a, b) => a + b, 0) / previous.length : 0;
  });

  const rows = $derived(ranked(view === 'today' ? [today] : week).slice(0, Math.max(3, Math.round(cfg.usageMax))));
  const top = $derived(rows[0]?.seconds ?? 1);

  /** A steady colour per application, so a day's bar reads the same all week. */
  function hue(key: string): number {
    let hash = 11;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 3607;
    return hash % 360;
  }

  const stacks = $derived.by(() => {
    const leaders = ranked(week).slice(0, 5).map((r) => r.key);
    const most = Math.max(1, ...week.map(totalOf));
    return week.map((day) => {
      const row = usage.data.days[day] ?? {};
      const total = totalOf(day);
      const parts = leaders
        .filter((key) => (row[key] ?? 0) > 0)
        .map((key) => ({ key, share: ((row[key] ?? 0) / most) * 100 }));
      const rest = total - leaders.reduce((sum, key) => sum + (row[key] ?? 0), 0);
      if (rest > 0) parts.push({ key: 'other', share: (rest / most) * 100 });
      return {
        day,
        total,
        label: fromDateKey(day).toLocaleDateString(undefined, { weekday: 'narrow' }),
        parts,
      };
    });
  });

  function appName(key: string): string {
    if (key === 'other') return 'Everything else';
    return usage.data.apps[key]?.name ?? key.replace(/^\w+:/, '');
  }

  function iconOf(key: string): string | null {
    const app = usage.data.apps[key];
    if (!app || (!app.exe && !app.umid)) return null;
    return icons.resolve({ path: app.exe, umid: app.umid });
  }

  let confirming = $state(false);
  $effect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => (confirming = false), 5000);
    return () => clearTimeout(timer);
  });

  function menu(event: MouseEvent) {
    overlay.openMenu(event, [
      { label: 'Screen time', header: true },
      { label: 'Clear all history', danger: true, disabled: !usage.lease.held, action: () => (confirming = true) },
    ]);
  }

  const delta = $derived(average > 0 ? Math.round(((todayTotal - average) / average) * 100) : null);
</script>

<!-- Its own menu, for the one destructive action; everything else is in settings. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="m-body" data-no-drag oncontextmenu={menu}>
  {#if cfg.usageShowWeek}
    <nav class="m-tabs">
      <button class:m-on={view === 'today'} onclick={() => (tab = 'today')}>Today</button>
      <button class:m-on={view === 'week'} onclick={() => (tab = 'week')}>This week</button>
    </nav>
  {/if}

  {#if view === 'today'}
    <div class="head">
      <span class="m-stat big">{formatSpent(todayTotal)}</span>
      <span class="m-sub">
        {#if delta !== null}{Math.abs(delta)}% {delta >= 0 ? 'above' : 'below'} your average{:else}So far today{/if}
        {#if usage.data.switches[today]}· {usage.data.switches[today]} switches{/if}
      </span>
    </div>
  {:else}
    <div class="chart" role="img" aria-label="Screen time over the last seven days">
      {#each stacks as bar (bar.day)}
        <div class="column" title="{fromDateKey(bar.day).toLocaleDateString()}: {formatSpent(bar.total)}">
          <div class="stack">
            {#each bar.parts as part (part.key)}
              <span
                class="part"
                class:other={part.key === 'other'}
                style:height="{part.share}%"
                style:--hue={hue(part.key)}
              ></span>
            {/each}
          </div>
          <span class="day" class:today={bar.day === today}>{bar.label}</span>
        </div>
      {/each}
    </div>
    <span class="m-sub summary">
      {formatSpent(week.map(totalOf).reduce((a, b) => a + b, 0))} this week · {formatSpent(
        week.map(totalOf).reduce((a, b) => a + b, 0) / 7,
      )} a day
    </span>
  {/if}

  <ul class="m-list">
    {#each rows as row (row.key)}
      {@const src = iconOf(row.key)}
      <li class="m-row app">
        {#if src}<img class="m-icon" {src} alt="" />{:else}<span class="swatch" style:--hue={hue(row.key)}></span>{/if}
        <span class="m-text">
          <span class="line">
            <span class="m-title">{appName(row.key)}</span>
            <span class="m-value">{formatSpent(row.seconds)}</span>
          </span>
          <span class="m-bar"><span style:width="{(row.seconds / top) * 100}%" style:--hue={hue(row.key)}></span></span>
        </span>
      </li>
    {:else}
      <li class="m-empty">
        {usage.loaded ? 'Nothing counted yet. Time is counted while this panel is on a display.' : 'Loading...'}
      </li>
    {/each}
  </ul>

  <footer class="status">
    {#if confirming}
      <span class="m-sub">Delete every day counted so far?</span>
      <button class="m-btn m-danger" onclick={() => ((confirming = false), usage.clear())}>Delete</button>
      <button class="m-btn" onclick={() => (confirming = false)}>Keep</button>
    {:else if !usage.lease.held}
      <span class="m-sub">Counted by another display.</span>
    {:else if usage.away}
      <span class="m-sub">Away — not counting.</span>
    {:else if usage.current}
      <span class="live"></span>
      <span class="m-sub">Now: {usage.current.name}</span>
    {/if}
  </footer>
</div>

<style>
  .head {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .big {
    font-size: calc(var(--ui-size) * 2);
  }

  .chart {
    flex: none;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    height: 96px;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 0;
  }

  .stack {
    flex: 1;
    display: flex;
    flex-direction: column-reverse;
    border-radius: calc(5px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 10%, transparent);
  }

  .part {
    flex: none;
    background: oklch(0.7 0.12 var(--hue));
  }

  .part.other {
    background: color-mix(in oklab, var(--color-gray-400, #888) 50%, transparent);
  }

  .day {
    font-size: calc(9px * var(--text-scale, 1));
    text-align: center;
    color: var(--panel-fg-muted);
  }

  .day.today {
    color: var(--accent, #7aa2f7);
    font-weight: 600;
  }

  .summary {
    flex: none;
  }

  .app .m-text {
    gap: 3px;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .line .m-title {
    flex: 1;
    min-width: 0;
  }

  .app .m-bar > span {
    background: oklch(0.7 0.12 var(--hue));
  }

  .swatch {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: calc(5px * var(--round, 1));
    background: oklch(0.7 0.12 var(--hue));
  }

  .status {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
  }

  .live {
    width: 6px;
    height: 6px;
    border-radius: calc(999px * var(--round, 1));
    background: var(--color-green-600, #4fbf7a);
  }
</style>
