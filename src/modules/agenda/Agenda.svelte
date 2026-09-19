<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { menuSeparator } from '$lib/menu';
  import {
    addDays,
    dayLabel,
    formatDuration,
    formatTime,
    fromDateKey,
    parseQuickAdd,
    toDateKey,
    type Occurrence,
  } from '$lib/agenda';
  import { agenda, colourOf } from '$lib/agenda-store.svelte';
  import AgendaEdit from './AgendaEdit.svelte';

  const cfg = $derived(config.current);

  $effect(() => agenda.acquire());
  $effect(() => agenda.plan(cfg.agendaReminders && agenda.lease.held));

  /** Half a minute is fine-grained enough for "now" and for past events dimming. */
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  const today = $derived(toDateKey(new Date(now)));
  const horizon = $derived(Math.max(1, Math.round(cfg.agendaDaysAhead)));

  // --- quick add --------------------------------------------------------------
  let draft = $state('');
  const parsed = $derived(
    draft.trim() ? parseQuickAdd(draft, new Date(now), { monthFirst: cfg.agendaMonthFirst }) : null,
  );

  function defaultRemind(): number | null {
    return cfg.agendaDefaultRemind === 'none' ? null : Number(cfg.agendaDefaultRemind);
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!parsed) return;
    // A timed event takes the default reminder; an all-day one would ring at midnight.
    agenda.add(parsed, parsed.remind ?? (parsed.time ? defaultRemind() : null));
    selected = null;
    draft = '';
  }

  const summary = $derived.by(() => {
    if (!parsed) return '';
    const parts = [dayLabel(parsed.date, today)];
    if (parsed.time) parts.push(formatTime(parsed.time, cfg.clock24h));
    if (parsed.duration) parts.push(formatDuration(parsed.duration));
    if (parsed.repeat !== 'none') parts.push(parsed.repeat);
    const remind = parsed.remind ?? (parsed.time ? defaultRemind() : null);
    if (remind !== null) parts.push(`🔔 ${remind ? `${remind} min` : 'at start'}`);
    return parts.join(' · ');
  });

  // --- what is on -------------------------------------------------------------
  /** A day picked on the week strip narrows the list to it. */
  let selected = $state<string | null>(null);

  const occurrences = $derived(agenda.between(today, addDays(today, Math.max(horizon, 7) - 1)));

  const week = $derived(
    Array.from({ length: 7 }, (_, i) => {
      const key = addDays(today, i);
      const on = occurrences.filter((o) => o.date === key);
      return {
        key,
        weekday: fromDateKey(key).toLocaleDateString(undefined, { weekday: 'narrow' }),
        day: fromDateKey(key).getDate(),
        dots: on.slice(0, 3).map((o) => colourOf(o.event)),
        count: on.length,
      };
    }),
  );

  const groups = $derived.by(() => {
    const last = addDays(today, horizon - 1);
    const byDay = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences) {
      if (selected ? occurrence.date !== selected : occurrence.date > last) continue;
      const list = byDay.get(occurrence.date);
      if (list) list.push(occurrence);
      else byDay.set(occurrence.date, [occurrence]);
    }
    return [...byDay.entries()].map(([date, items]) => ({ date, label: dayLabel(date, today), items }));
  });

  function phaseOf(occurrence: Occurrence): 'past' | 'now' | 'later' {
    if (occurrence.allDay) return 'later';
    const end = occurrence.end ?? occurrence.start + 30 * 60_000;
    if (end <= now) return 'past';
    return occurrence.start <= now ? 'now' : 'later';
  }

  function when(occurrence: Occurrence): string {
    if (occurrence.allDay || !occurrence.event.time) return 'All day';
    const start = formatTime(occurrence.event.time, cfg.clock24h);
    if (!occurrence.end) return start;
    const end = new Date(occurrence.end);
    const endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    return `${start}–${formatTime(endTime, cfg.clock24h)}`;
  }

  function edit(eventId: string | null, date?: string) {
    overlay.openDialog(AgendaEdit, { eventId, date: date ?? selected ?? today, onclose: () => overlay.closeDialog() });
  }

  function menu(event: MouseEvent, occurrence: Occurrence) {
    const item = occurrence.event;
    overlay.openMenu(event, [
      { label: item.title, header: true },
      { label: 'Edit...', action: () => edit(item.id) },
      { label: 'Duplicate', action: () => agenda.duplicate(item) },
      menuSeparator,
      {
        label: item.repeat === 'none' ? 'Delete' : 'Delete every time',
        danger: true,
        action: () => agenda.remove(item.id),
      },
    ]);
  }

  function ringLabel(occurrence: Occurrence): string {
    const minutes = Math.round((occurrence.start - now) / 60_000);
    if (occurrence.allDay) return 'Today';
    if (minutes > 0) return `Starts in ${minutes} min`;
    if (minutes === 0) return 'Starting now';
    return `Started ${-minutes} min ago`;
  }
</script>

<!-- Re-reads on the way in, for what the other display changed; not a control. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="m-body" data-no-drag onpointerenter={() => void agenda.file.refresh()}>
  {#each agenda.ringing as occurrence (occurrence.key)}
    <div class="ringing" role="alert" style:--tone={colourOf(occurrence.event)}>
      <span aria-hidden="true">🔔</span>
      <span class="m-text">
        <span class="m-title">{occurrence.event.title}</span>
        <span class="m-sub">{ringLabel(occurrence)}</span>
      </span>
      <button class="m-btn" onclick={() => agenda.dismiss(occurrence.key)}>Dismiss</button>
    </div>
  {/each}

  <form class="quick" onsubmit={submit}>
    <input
      bind:value={draft}
      placeholder="Add: Dentist fri 14:30 remind 15m"
      aria-label="Add an event"
    />
    <button class="m-btn" type="button" title="New event with every option" onclick={() => edit(null)}>
      &#8943;
    </button>
  </form>
  {#if draft.trim()}
    <p class="m-sub preview" class:bad={!parsed}>
      {parsed ? `“${parsed.title}” · ${summary} — Enter to add` : 'Add a name as well as a time.'}
    </p>
  {/if}

  {#if cfg.agendaShowWeek}
    <div class="week" role="group" aria-label="The next seven days">
      {#each week as day (day.key)}
        <button
          class="daycell"
          class:today={day.key === today}
          class:on={selected === day.key}
          title={day.count ? `${day.count} on ${dayLabel(day.key, today)}` : dayLabel(day.key, today)}
          onclick={() => (selected = selected === day.key ? null : day.key)}
          ondblclick={() => edit(null, day.key)}
        >
          <span class="wd">{day.weekday}</span>
          <span class="dn">{day.day}</span>
          <span class="dots">
            {#each day.dots as dot, i (i)}<i style:background={dot}></i>{/each}
          </span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="m-scroll list">
    {#each groups as group (group.date)}
      <div class="m-label" class:first={group.date === today}>{group.label}</div>
      {#each group.items as occurrence (occurrence.key)}
        {@const phase = phaseOf(occurrence)}
        <button
          class="m-row m-click event"
          class:past={phase === 'past'}
          style:--tone={colourOf(occurrence.event)}
          onclick={() => edit(occurrence.event.id)}
          oncontextmenu={(e) => menu(e, occurrence)}
        >
          <span class="bar"></span>
          <span class="time">{when(occurrence)}</span>
          <span class="m-text">
            <span class="m-title">{occurrence.event.title}</span>
            {#if occurrence.event.note}
              <span class="m-sub">{occurrence.event.note.split('\n')[0]}</span>
            {/if}
          </span>
          {#if phase === 'now'}<span class="m-pill m-on">now</span>{/if}
          {#if occurrence.event.repeat !== 'none'}<span class="m-glyph" title="Repeats">&#8635;</span>{/if}
          {#if occurrence.event.remind !== null && !occurrence.allDay}<span class="m-glyph" title="Reminder">🔔</span>{/if}
        </button>
      {/each}
    {:else}
      <p class="m-empty">
        {selected ? `Nothing on ${dayLabel(selected, today).toLowerCase()}.` : `Nothing in the next ${horizon} days.`}
        Type above to add something.
      </p>
    {/each}
  </div>
</div>

<style>
  .ringing {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: calc(9px * var(--round, 1));
    background: color-mix(in oklab, var(--tone) 32%, transparent);
  }

  .quick {
    flex: none;
    display: flex;
    gap: 6px;
  }

  .quick input {
    flex: 1;
    min-width: 0;
  }

  .preview {
    flex: none;
    margin-top: -4px;
    white-space: normal;
  }

  .preview.bad {
    color: var(--color-orange-700, #f2a65a);
  }

  .week {
    flex: none;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }

  .daycell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 3px 0 4px;
    border: 0;
    border-radius: calc(8px * var(--round, 1));
    font: inherit;
    color: var(--panel-fg);
    background: transparent;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .daycell:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .daycell:active {
    scale: 0.92;
    transition-duration: var(--dur-fast);
  }

  .daycell.on {
    background: color-mix(in oklab, var(--color-gray-300, #666) 36%, transparent);
  }

  .wd {
    font-size: calc(9px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    text-transform: uppercase;
  }

  .dn {
    display: grid;
    place-items: center;
    width: 1.8em;
    height: 1.8em;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(11px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
  }

  .today .dn {
    background: var(--accent, #7aa2f7);
    color: #fff;
    font-weight: 600;
  }

  .dots {
    display: flex;
    gap: 2px;
    height: 4px;
  }

  .dots i {
    width: 4px;
    height: 4px;
    border-radius: calc(999px * var(--round, 1));
  }

  .list {
    display: flex;
    flex-direction: column;
    margin: 0 -6px;
    padding: 0 6px;
  }

  .m-label.first {
    color: var(--accent, #7aa2f7);
  }

  .event {
    position: relative;
    padding-left: 10px;
  }

  .bar {
    position: absolute;
    left: 3px;
    top: 5px;
    bottom: 5px;
    width: 3px;
    border-radius: calc(999px * var(--round, 1));
    background: var(--tone);
  }

  .time {
    flex: none;
    min-width: 4.4em;
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .event.past {
    opacity: 0.5;
  }

  .m-glyph {
    width: auto;
    font-size: calc(10px * var(--text-scale, 1));
  }
</style>
