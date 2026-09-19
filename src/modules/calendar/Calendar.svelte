<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { occurrencesBetween, toDateKey } from '$lib/agenda';
  import { agenda, colourOf } from '$lib/agenda-store.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import AgendaEdit from '../agenda/AgendaEdit.svelte';

  const cfg = $derived(config.current);

  // The Agenda's events as dots under their days - but only while the Agenda
  // module is on, so a calendar on its own still reads no file at all.
  $effect(() => (cfg.moduleAgenda ? agenda.file.acquire() : undefined));

  function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  let today = $state(startOfDay(new Date()));
  /** Months away from the current one; reset by clicking the title. */
  let offset = $state(0);
  /** Which way the last month change went, so the new grid slides in from that side. */
  let direction = $state<1 | -1>(1);

  function step(delta: 1 | -1) {
    direction = delta;
    offset += delta;
  }

  function backToToday() {
    if (offset === 0) return;
    direction = offset > 0 ? -1 : 1;
    offset = 0;
  }

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

  /** Up to three event colours per visible day. */
  const busy = $derived.by(() => {
    const map = new Map<string, string[]>();
    const first = weeks[0]?.days[0]?.date;
    const last = weeks[weeks.length - 1]?.days[6]?.date;
    if (!cfg.moduleAgenda || !first || !last) return map;
    for (const occurrence of occurrencesBetween(agenda.events, toDateKey(first), toDateKey(last))) {
      const list = map.get(occurrence.date) ?? [];
      if (list.length < 3) list.push(colourOf(occurrence.event));
      map.set(occurrence.date, list);
    }
    return map;
  });

  function addOn(date: Date) {
    if (!cfg.moduleAgenda) return;
    overlay.openDialog(AgendaEdit, { eventId: null, date: toDateKey(date), onclose: () => overlay.closeDialog() });
  }
</script>

<div class="calendar">
  <header data-no-drag>
    <button class="nav" aria-label="Previous month" onclick={() => step(-1)}>&lsaquo;</button>
    <button class="title" title="Back to this month" onclick={backToToday}>
      {#key title}<span class="title-text" style:--dir={direction}>{title}</span>{/key}
    </button>
    <button class="nav" aria-label="Next month" onclick={() => step(1)}>&rsaquo;</button>
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
    <!-- Keyed on the month, so each change replaces the grid and slides the new one in. -->
    {#key shown.getTime()}
      <tbody style:--dir={direction}>
        {#each weeks as row (row.days[0]?.date.getTime())}
          <tr>
            {#if cfg.calendarWeekNumbers}<td class="week">{row.week}</td>{/if}
            {#each row.days as day (day.date.getTime())}
              {@const dots = busy.get(toDateKey(day.date))}
              <td
                class:out={!day.inMonth}
                class:today={day.isToday}
                class:weekend={cfg.calendarHighlightWeekend && day.isWeekend}
                title={cfg.moduleAgenda ? 'Double-click to add to the agenda' : undefined}
                ondblclick={() => addOn(day.date)}
              >
                <span>{day.date.getDate()}</span>
                {#if dots}
                  <i class="dots" aria-label="{dots.length} or more events">
                    {#each dots as dot, i (i)}<b style:background={dot}></b>{/each}
                  </i>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    {/key}
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
    border-radius: calc(6px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg);
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    font-weight: 500;
    text-align: center;
    cursor: pointer;
    overflow: hidden;
  }

  .title-text {
    display: inline-block;
    animation: fx-slide var(--dur-slow) var(--ease) backwards;
  }

  .nav {
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: calc(6px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: calc(15px * var(--text-scale, 1));
    line-height: 1;
    cursor: pointer;
  }

  .title,
  .nav {
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .title:hover,
  .nav:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    color: var(--panel-fg);
  }

  .nav:active {
    scale: 0.82;
    transition-duration: var(--dur-fast);
  }

  table {
    flex: 1;
    min-height: 0;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
  }

  /* The month slides in from the side it was paged toward. */
  tbody {
    animation: fx-slide var(--dur-slow) var(--ease) backwards;
    animation-delay: var(--lag, 0ms);
  }

  th {
    padding-bottom: 2px;
    font-size: calc(9px * var(--text-scale, 1));
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--panel-fg-muted);
  }

  td {
    position: relative;
    text-align: center;
    font-size: calc(11px * var(--text-scale, 1));
    padding: 0;
  }

  .dots {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 1px;
    display: flex;
    justify-content: center;
    gap: 2px;
    pointer-events: none;
  }

  .dots b {
    width: 3px;
    height: 3px;
    border-radius: calc(999px * var(--round, 1));
    animation: fx-pop-in var(--dur-slow) var(--ease-pop) backwards;
    animation-delay: calc(var(--lag, 0ms) + var(--dur));
  }

  td span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.7em;
    height: 1.7em;
    border-radius: calc(999px * var(--round, 1));
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  td:not(.today):hover span {
    background: color-mix(in oklab, var(--color-gray-300, #666) 28%, transparent);
    scale: 1.1;
  }

  .out {
    opacity: 0.3;
  }

  .weekend:not(.today) span {
    color: var(--panel-fg-muted);
  }

  /* Today pops into its circle a moment after the grid has settled. */
  .today span {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    box-shadow: 0 2px 10px color-mix(in oklab, var(--accent, #7aa2f7) 45%, transparent);
    animation: fx-pop-in var(--dur-slow) var(--ease-pop) backwards;
    animation-delay: calc(var(--lag, 0ms) + var(--dur));
  }

  .week {
    font-size: calc(9px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    width: 1.6em;
  }
</style>
