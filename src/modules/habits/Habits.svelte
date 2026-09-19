<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { menuSeparator } from '$lib/menu';
  import { addDays, fromDateKey, toDateKey } from '$lib/agenda';
  import { completion, dailyStreak, doneInWeek, parseHabit, weekStart, weeklyStreak } from '$lib/habits';
  import { HABIT_COLOURS, habits, type Habit } from '$lib/habits.svelte';

  const cfg = $derived(config.current);

  $effect(() => habits.acquire());

  // The day rolls over at midnight; checking each minute is cheap and exact enough.
  let today = $state(toDateKey(new Date()));
  $effect(() => {
    const timer = setInterval(() => {
      const now = toDateKey(new Date());
      if (now !== today) today = now;
    }, 60_000);
    return () => clearInterval(timer);
  });

  const span = $derived(Math.max(5, Math.min(14, Math.round(cfg.habitsDays))));
  const days = $derived(Array.from({ length: span }, (_, i) => addDays(today, i - span + 1)));
  const mondayFirst = $derived(cfg.calendarStartMonday);

  let draft = $state('');
  let selected = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  let renameDraft = $state('');

  function add(event: SubmitEvent) {
    event.preventDefault();
    const parsed = parseHabit(draft);
    if (!parsed) return;
    habits.add(parsed.name, parsed.perWeek);
    draft = '';
  }

  function streakOf(habit: Habit): { value: number; unit: string } {
    const done = (date: string) => habits.isDone(habit.id, date);
    return habit.perWeek >= 7
      ? { value: dailyStreak(done, today), unit: 'd' }
      : { value: weeklyStreak(done, today, habit.perWeek, mondayFirst), unit: 'w' };
  }

  function thisWeek(habit: Habit): number {
    return doneInWeek((date) => habits.isDone(habit.id, date), weekStart(today, mondayFirst));
  }

  function startRename(habit: Habit) {
    renaming = habit.id;
    renameDraft = habit.name;
  }

  function commitRename() {
    if (renaming && renameDraft.trim()) habits.update(renaming, { name: renameDraft.trim() });
    renaming = null;
  }

  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function menu(event: MouseEvent, habit: Habit, index: number, count: number) {
    overlay.openMenu(event, [
      { label: habit.name, header: true },
      { label: 'Rename', action: () => startRename(habit) },
      {
        label: 'How often',
        items: [7, 6, 5, 4, 3, 2, 1].map((n) => ({
          label: n === 7 ? 'Every day' : `${n} times a week`,
          checked: habit.perWeek === n,
          action: () => habits.update(habit.id, { perWeek: n }),
        })),
      },
      {
        label: 'Colour',
        items: Object.keys(HABIT_COLOURS).map((name) => ({
          label: name[0]?.toUpperCase() + name.slice(1),
          checked: habit.colour === name,
          action: () => habits.update(habit.id, { colour: name }),
        })),
      },
      { label: 'Move up', disabled: index === 0, action: () => habits.move(habit.id, -1) },
      { label: 'Move down', disabled: index === count - 1, action: () => habits.move(habit.id, 1) },
      menuSeparator,
      { label: 'Delete, with its history', danger: true, action: () => habits.remove(habit.id) },
    ]);
  }

  // --- history ------------------------------------------------------------------
  const WEEKS = 16;

  /** Sixteen weeks of one habit, or of all of them as a share done per day. */
  const heat = $derived.by(() => {
    const list = habits.habits;
    const focus = list.find((h) => h.id === selected) ?? null;
    const start = addDays(weekStart(today, mondayFirst), -(WEEKS - 1) * 7);
    const columns: { date: string; level: number; future: boolean }[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const column = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(start, w * 7 + d);
        let level = 0;
        if (date <= today) {
          if (focus) level = habits.isDone(focus.id, date) ? 1 : 0;
          else if (list.length) level = list.filter((h) => habits.isDone(h.id, date)).length / list.length;
        }
        column.push({ date, level, future: date > today });
      }
      columns.push(column);
    }
    return {
      columns,
      colour: focus ? (HABIT_COLOURS[focus.colour] ?? 'var(--accent)') : 'var(--accent, #7aa2f7)',
      title: focus ? focus.name : 'All habits',
      rate: focus ? completion((date) => habits.isDone(focus.id, date), today, 30) : null,
    };
  });

  const letter = (date: string) => fromDateKey(date).toLocaleDateString(undefined, { weekday: 'narrow' });
</script>

<!-- Re-reads on the way in, for what the other display changed; not a control. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="m-body" data-no-drag onpointerenter={() => void habits.file.refresh()}>
  {#if habits.habits.length}
    <div class="grid" style:--span={span}>
      <span class="corner"></span>
      {#each days as date (date)}
        <span class="dayhead" class:today={date === today} title={fromDateKey(date).toLocaleDateString()}>
          <b>{letter(date)}</b>{fromDateKey(date).getDate()}
        </span>
      {/each}
    </div>

    <ul class="m-scroll rows">
      {#each habits.habits as habit, index (habit.id)}
        {@const colour = HABIT_COLOURS[habit.colour] ?? 'var(--accent)'}
        {@const streak = streakOf(habit)}
        <li
          class="grid row"
          class:selected={selected === habit.id}
          style:--span={span}
          style:--tone={colour}
          oncontextmenu={(e) => menu(e, habit, index, habits.habits.length)}
        >
          {#if renaming === habit.id}
            <input
              class="rename"
              bind:value={renameDraft}
              use:autofocus
              aria-label="Habit name"
              onkeydown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') renaming = null;
              }}
              onblur={commitRename}
            />
          {:else}
            <button
              class="name"
              title={habit.perWeek < 7 ? `${habit.name} - ${thisWeek(habit)} of ${habit.perWeek} this week` : habit.name}
              onclick={() => (selected = selected === habit.id ? null : habit.id)}
              ondblclick={() => startRename(habit)}
            >
              <span class="label">{habit.name}</span>
              {#if cfg.habitsShowStreak && streak.value > 0}
                <span class="streak">🔥{streak.value}{streak.unit}</span>
              {:else if habit.perWeek < 7}
                <span class="m-sub">{thisWeek(habit)}/{habit.perWeek}</span>
              {/if}
            </button>
          {/if}
          {#each days as date (date)}
            {@const on = habits.isDone(habit.id, date)}
            <button
              class="tick"
              class:on
              class:today={date === today}
              aria-pressed={on}
              aria-label="{habit.name} on {fromDateKey(date).toLocaleDateString()}"
              onclick={() => habits.toggle(habit.id, date)}
            ></button>
          {/each}
        </li>
      {/each}
    </ul>

    {#if cfg.habitsShowHeatmap}
      <div class="history">
        <div class="history-head">
          <span class="m-sub">{heat.title}</span>
          {#if heat.rate !== null}<span class="m-sub">{Math.round(heat.rate * 100)}% of the last 30 days</span>{/if}
        </div>
        <div class="heat" style:--tone={heat.colour}>
          {#each heat.columns as column, w (w)}
            <div class="week">
              {#each column as cell (cell.date)}
                <span
                  class="cell"
                  class:future={cell.future}
                  style:--level={cell.level}
                  title="{fromDateKey(cell.date).toLocaleDateString()}{cell.future ? '' : ` · ${Math.round(cell.level * 100)}%`}"
                ></span>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <p class="m-empty intro">
      Something to do every day, or a few times a week: type it below, e.g. <em>Read</em> or <em>Gym 3x/week</em>.
    </p>
  {/if}

  <form class="add" onsubmit={add}>
    <input bind:value={draft} placeholder="New habit, e.g. Gym 3x/week" aria-label="New habit" />
  </form>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(var(--span), 18px);
    gap: 4px;
    align-items: center;
  }

  .dayhead {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: calc(9px * var(--text-scale, 1));
    line-height: 1.15;
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .dayhead b {
    font-weight: 600;
  }

  .dayhead.today {
    color: var(--accent, #7aa2f7);
  }

  /* Room for three habits before the history below may take any more. */
  .rows {
    list-style: none;
    margin: 0 -4px;
    padding: 0 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 76px;
  }

  .row {
    padding: 3px 0;
    border-radius: calc(7px * var(--round, 1));
  }

  .row.selected {
    background: color-mix(in oklab, var(--tone) 14%, transparent);
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 4px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    text-align: left;
    color: var(--panel-fg);
    background: none;
    cursor: pointer;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .streak {
    flex: none;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .rename {
    min-width: 0;
    padding: 2px 6px;
  }

  .tick {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: calc(999px * var(--round, 1));
    cursor: pointer;
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
    transition:
      background-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease),
      scale var(--dur-slow) var(--ease-spring);
  }

  .tick:hover {
    background: color-mix(in oklab, var(--tone) 40%, transparent);
    scale: 1.14;
  }

  /* Pressed in and sprung back out, so ticking a day off lands with a bounce. */
  .tick:active {
    scale: 0.78;
    transition-duration: var(--dur-fast);
  }

  .tick.today {
    box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--tone) 80%, transparent);
  }

  .tick.on {
    background: var(--tone);
    box-shadow: 0 0 10px color-mix(in oklab, var(--tone) 45%, transparent);
  }

  .tick.on.today {
    box-shadow:
      inset 0 0 0 1.5px color-mix(in oklab, var(--tone) 80%, transparent),
      0 0 10px color-mix(in oklab, var(--tone) 45%, transparent);
  }

  .history {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .history-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  /*
   * Fixed-size cells rather than cells that share the panel's width: a history
   * stretched to a wide panel grew seven rows tall enough to push the habits
   * themselves out of view.
   */
  .heat {
    display: grid;
    grid-template-columns: repeat(16, 9px);
    justify-content: space-between;
    gap: 2px;
  }

  .week {
    display: grid;
    grid-template-rows: repeat(7, 9px);
    gap: 2px;
  }

  .cell {
    width: 9px;
    height: 9px;
    border-radius: calc(2px * var(--round, 1));
    background: color-mix(
      in oklab,
      var(--tone) calc(var(--level) * 85%),
      color-mix(in oklab, var(--color-gray-300, #666) 16%, transparent)
    );
  }

  .cell.future {
    opacity: 0.25;
  }

  .add {
    flex: none;
  }

  .add input {
    width: 100%;
  }

  .intro {
    flex: 1;
  }
</style>
