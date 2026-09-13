<script lang="ts">
  import { config } from '$lib/config.svelte';

  const cfg = $derived(config.current);

  function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  let today = $state(startOfDay(new Date()));
  /** Months away from the current one; reset by clicking the title. */
  let offset = $state(0);

  // Re-date at midnight rather than on a ticking timer: reading `today` makes
  // this effect re-arm itself each time the day rolls over.
  $effect(() => {
    void today;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const timer = setTimeout(() => (today = startOfDay(new Date())), midnight - now.getTime() + 500);
    return () => clearTimeout(timer);
  });

  const shown = $derived(new Date(today.getFullYear(), today.getMonth() + offset, 1));

  const title = $derived(
    shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  /** Weekday initials in the user's locale, starting on the chosen day. */
  const weekdays = $derived.by(() => {
    const first = cfg.calendarStartMonday ? 1 : 0;
    // 2024-01-07 was a Sunday, which makes the reference week easy to index.
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(2024, 0, 7 + ((first + i) % 7));
      return date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
    });
  });

  interface Day {
    date: Date;
    inMonth: boolean;
    isToday: boolean;
    isWeekend: boolean;
  }

  /** ISO-8601 week number, which is what a week column is expected to show. */
  function isoWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const weekday = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - weekday);
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.ceil((d.getTime() - yearStart) / 86_400_000 / 7 + 1 / 7);
  }

  const weeks = $derived.by(() => {
    const firstDay = cfg.calendarStartMonday ? 1 : 0;
    const start = new Date(shown);
    // Back up to the first cell of the grid, which usually sits in the
    // previous month.
    start.setDate(1 - ((start.getDay() - firstDay + 7) % 7));

    const todayTime = today.getTime();
    const rows: { week: number; days: Day[] }[] = [];

    for (let row = 0; row < 6; row++) {
      const days: Day[] = [];
      for (let col = 0; col < 7; col++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + row * 7 + col);
        days.push({
          date,
          inMonth: date.getMonth() === shown.getMonth(),
          isToday: date.getTime() === todayTime,
          isWeekend: date.getDay() === 0 || date.getDay() === 6,
        });
      }
      // A month spans six rows only when it starts late; drop an all-spill row
      // rather than leaving a blank line under every short month.
      if (row === 5 && !days.some((d) => d.inMonth)) break;
      rows.push({ week: isoWeek(days[0]?.date ?? shown), days });
    }
    return rows;
  });
</script>

<div class="calendar">
  <header data-no-drag>
    <button class="nav" aria-label="Previous month" onclick={() => offset--}>&lsaquo;</button>
    <button class="title" title="Back to this month" onclick={() => (offset = 0)}>{title}</button>
    <button class="nav" aria-label="Next month" onclick={() => offset++}>&rsaquo;</button>
  </header>

  <table>
    <thead>
      <tr>
        {#if cfg.calendarWeekNumbers}<th class="week" aria-label="Week"></th>{/if}
        {#each weekdays as day, i (i)}
          <th>{day}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each weeks as row (row.days[0]?.date.getTime())}
        <tr>
          {#if cfg.calendarWeekNumbers}<td class="week">{row.week}</td>{/if}
          {#each row.days as day (day.date.getTime())}
            <td
              class:out={!day.inMonth}
              class:today={day.isToday}
              class:weekend={cfg.calendarHighlightWeekend && day.isWeekend}
            >
              <span>{day.date.getDate()}</span>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .calendar {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    container-type: size;
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    cursor: default;
  }

  .title {
    flex: 1;
    padding: 2px 4px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--panel-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    text-align: center;
    cursor: pointer;
  }

  .nav {
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }

  .title:hover,
  .nav:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    color: var(--panel-fg);
  }

  table {
    flex: 1;
    min-height: 0;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
  }

  th {
    padding-bottom: 2px;
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--panel-fg-muted);
  }

  td {
    text-align: center;
    font-size: 11px;
    padding: 0;
  }

  td span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.7em;
    height: 1.7em;
    border-radius: 999px;
  }

  .out {
    opacity: 0.3;
  }

  .weekend:not(.today) span {
    color: var(--panel-fg-muted);
  }

  .today span {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .week {
    font-size: 9px;
    color: var(--panel-fg-muted);
    width: 1.6em;
  }
</style>
