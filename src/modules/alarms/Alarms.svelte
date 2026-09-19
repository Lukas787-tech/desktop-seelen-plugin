<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { alarms, type Alarm, type Countdown } from '$lib/alarms.svelte';
  import {
    describeDays,
    describeWait,
    formatCountdown,
    formatStopwatch,
    parseDuration,
  } from '$lib/alarmtime';

  interface Props {
    /** True while windows hide this display; the stopwatch stops redrawing. */
    covered: boolean;
  }

  let { covered }: Props = $props();

  const cfg = $derived(config.current);

  $effect(() => alarms.acquire());
  $effect(() => alarms.plan(alarms.lease.held, cfg.alarmsRings, cfg.alarmsVolume));

  type Tab = 'timers' | 'stopwatch' | 'alarms';
  let tab = $state<Tab>(config.current.alarmsDefaultTab);

  // --- the clock the panel reads ----------------------------------------------
  // Once a second while a countdown runs; every frame for a running stopwatch
  // that is on screen; not at all otherwise.
  let now = $state(Date.now());
  let perf = $state(performance.now());

  const anyRunning = $derived(alarms.timers.some((t) => t.endsAt !== null && !t.done));

  $effect(() => {
    if (covered || (!anyRunning && tab !== 'alarms')) return;
    const timer = setInterval(() => (now = Date.now()), tab === 'alarms' ? 15_000 : 250);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (covered || tab !== 'stopwatch' || !alarms.stopwatch.running) return;
    let frame = requestAnimationFrame(function draw() {
      perf = performance.now();
      frame = requestAnimationFrame(draw);
    });
    return () => cancelAnimationFrame(frame);
  });

  // --- timers -----------------------------------------------------------------
  const PRESETS: readonly [label: string, ms: number][] = [
    ['1m', 60_000],
    ['3m', 180_000],
    ['5m', 300_000],
    ['10m', 600_000],
    ['15m', 900_000],
    ['25m', 1_500_000],
    ['1h', 3_600_000],
  ];

  let timerText = $state('');
  const parsed = $derived(parseDuration(timerText));

  function addFromText(event: SubmitEvent) {
    event.preventDefault();
    if (!parsed) return;
    alarms.addTimer(parsed.ms, parsed.label);
    timerText = '';
  }

  const timers = $derived(alarms.timers.slice().sort((a, b) => a.createdAt - b.createdAt));

  function progress(timer: Countdown): number {
    if (timer.duration <= 0) return 0;
    return Math.min(100, (1 - alarms.remaining(timer, now) / timer.duration) * 100);
  }

  // --- stopwatch --------------------------------------------------------------
  const elapsed = $derived(alarms.stopwatchElapsed(alarms.stopwatch.running ? perf : 0));
  const laps = $derived.by(() => {
    const totals = alarms.stopwatch.laps;
    // Oldest last in the list, so each lap's split is its total minus the next one's.
    const splits = totals.map((total, i) => total - (totals[i + 1] ?? 0));
    const best = splits.length > 1 ? Math.min(...splits) : -1;
    const worst = splits.length > 1 ? Math.max(...splits) : -1;
    return totals.map((total, i) => ({
      n: totals.length - i,
      total,
      split: splits[i] ?? 0,
      best: splits[i] === best,
      worst: splits[i] === worst,
    }));
  });

  // --- alarms -----------------------------------------------------------------
  let alarmTime = $state('07:00');
  let alarmLabel = $state('');
  let alarmDays = $state<number[]>([1, 2, 3, 4, 5]);
  let adding = $state(false);

  const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
  const dayLetter = (d: number) => new Date(2024, 0, 7 + d).toLocaleDateString(undefined, { weekday: 'narrow' });

  function toggleDay(day: number) {
    alarmDays = alarmDays.includes(day) ? alarmDays.filter((d) => d !== day) : [...alarmDays, day];
  }

  function addAlarm(event: SubmitEvent) {
    event.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(alarmTime)) return;
    alarms.addAlarm(alarmTime, alarmDays, alarmLabel);
    alarmLabel = '';
    adding = false;
  }

  function clockLabel(time: string): string {
    const [h, m] = time.split(':').map(Number);
    return new Date(2000, 0, 1, h ?? 0, m ?? 0).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !cfg.alarms24h,
    });
  }

  const sortedAlarms = $derived(alarms.alarms.slice().sort((a, b) => a.time.localeCompare(b.time)));

  function nextLabel(alarm: Alarm): string {
    const at = alarms.nextFor(alarm, now);
    return at === null ? 'Off' : describeWait(at - now);
  }
</script>

<div class="m-body" data-no-drag>
  {#if alarms.ringing.length}
    <div class="ringing" role="alert">
      {#each alarms.ringing as entry (entry.key)}
        <div class="ring">
          <span class="bell" aria-hidden="true">{entry.kind === 'alarm' ? '⏰' : '⏲️'}</span>
          <span class="m-text">
            <span class="m-title">{entry.label}</span>
            <span class="m-sub">{entry.kind === 'alarm' ? 'Alarm' : 'Timer done'}</span>
          </span>
          <button class="m-btn" onclick={() => alarms.snooze(entry)}>
            {entry.kind === 'alarm' ? 'Snooze 5' : '+5 min'}
          </button>
          <button class="m-btn m-primary" onclick={() => alarms.dismiss(entry.key)}>Stop</button>
        </div>
      {/each}
    </div>
  {/if}

  <nav class="m-tabs">
    <button class:m-on={tab === 'timers'} onclick={() => (tab = 'timers')}>
      Timers{#if anyRunning}<span class="dot"></span>{/if}
    </button>
    <button class:m-on={tab === 'stopwatch'} onclick={() => (tab = 'stopwatch')}>
      Stopwatch{#if alarms.stopwatch.running}<span class="dot"></span>{/if}
    </button>
    <button class:m-on={tab === 'alarms'} onclick={() => (tab = 'alarms')}>Alarms</button>
  </nav>

  {#if tab === 'timers'}
    <form class="add" onsubmit={addFromText}>
      <input
        bind:value={timerText}
        placeholder="10m, 1:30, tea 4m..."
        aria-label="New timer"
      />
      <button class="m-btn m-primary" type="submit" disabled={!parsed}>
        {parsed ? `Start ${formatCountdown(parsed.ms)}` : 'Start'}
      </button>
    </form>
    <div class="presets">
      {#each PRESETS as [label, ms] (label)}
        <button class="m-chip" onclick={() => alarms.addTimer(ms, '')}>{label}</button>
      {/each}
    </div>

    <ul class="m-list">
      {#each timers as timer (timer.id)}
        {@const left = alarms.remaining(timer, now)}
        {@const running = timer.endsAt !== null && !timer.done}
        <li class="timer" class:done={timer.done || (running && left <= 0)}>
          <div class="line">
            <span class="m-stat count">{formatCountdown(left)}</span>
            <span class="m-text">
              <span class="m-title">{timer.label || formatCountdown(timer.duration)}</span>
              <span class="m-sub">
                {timer.done ? 'Done' : running ? 'Running' : left === timer.duration ? 'Ready' : 'Paused'}
                {#if timer.label}· {formatCountdown(timer.duration)}{/if}
              </span>
            </span>
            <span class="m-actions">
              {#if timer.done}
                <button class="m-btn" title="Start again" onclick={() => alarms.restart(timer)}>&#8635;</button>
              {:else if running}
                <button class="m-btn" title="Add a minute" onclick={() => alarms.extend(timer)}>+1</button>
                <button class="m-btn" title="Pause" onclick={() => alarms.pause(timer)}>&#10074;&#10074;</button>
              {:else}
                <button class="m-btn m-primary" title="Start" onclick={() => alarms.resume(timer)}>&#9654;</button>
                {#if left !== timer.duration}
                  <button class="m-btn" title="Reset" onclick={() => alarms.reset(timer)}>&#8635;</button>
                {/if}
              {/if}
              <button class="m-quiet" title="Remove" aria-label="Remove timer" onclick={() => alarms.removeTimer(timer.id)}>
                &times;
              </button>
            </span>
          </div>
          <div class="m-bar"><span style:width="{progress(timer)}%"></span></div>
        </li>
      {:else}
        <li class="m-empty">Pick a length above, or type one. Timers keep running on every display.</li>
      {/each}
    </ul>
  {:else if tab === 'stopwatch'}
    <div class="watch">
      <span class="m-stat elapsed">{formatStopwatch(elapsed)}</span>
      <div class="m-actions">
        <button class="m-btn m-primary wide" onclick={() => alarms.toggleStopwatch()}>
          {alarms.stopwatch.running ? 'Stop' : elapsed > 0 ? 'Resume' : 'Start'}
        </button>
        {#if alarms.stopwatch.running}
          <button class="m-btn wide" onclick={() => alarms.lap()}>Lap</button>
        {:else}
          <button class="m-btn wide" disabled={elapsed === 0} onclick={() => alarms.resetStopwatch()}>Reset</button>
        {/if}
      </div>
    </div>
    <ul class="m-list">
      {#each laps as lap (lap.n)}
        <li class="m-row lap" class:best={lap.best} class:worst={lap.worst}>
          <span class="m-sub">Lap {lap.n}</span>
          <span class="m-value split">{formatStopwatch(lap.split)}</span>
          <span class="m-sub total">{formatStopwatch(lap.total)}</span>
        </li>
      {/each}
    </ul>
  {:else}
    {#if adding || !alarms.alarms.length}
      <form class="new-alarm" onsubmit={addAlarm}>
        <div class="add">
          <input type="time" bind:value={alarmTime} aria-label="Alarm time" required />
          <input bind:value={alarmLabel} placeholder="Label" aria-label="Alarm label" />
        </div>
        <div class="days" role="group" aria-label="Repeat on">
          {#each WEEK as day (day)}
            <button
              type="button"
              class="m-chip day"
              class:m-on={alarmDays.includes(day)}
              aria-pressed={alarmDays.includes(day)}
              onclick={() => toggleDay(day)}
            >
              {dayLetter(day)}
            </button>
          {/each}
          <span class="m-sub repeat">{describeDays(alarmDays)}</span>
        </div>
        <div class="m-actions">
          <button class="m-btn m-primary" type="submit">Add alarm</button>
          {#if alarms.alarms.length}
            <button class="m-btn" type="button" onclick={() => (adding = false)}>Cancel</button>
          {/if}
        </div>
      </form>
    {:else}
      <button class="m-btn add-button" onclick={() => (adding = true)}>+ New alarm</button>
    {/if}

    <ul class="m-list">
      {#each sortedAlarms as alarm (alarm.id)}
        <li class="m-row alarm" class:off={!alarm.enabled}>
          <span class="m-stat when">{clockLabel(alarm.time)}</span>
          <span class="m-text">
            <span class="m-title">{alarm.label || describeDays(alarm.days)}</span>
            <span class="m-sub">
              {#if alarm.label}{describeDays(alarm.days)} ·{/if}
              {alarm.snoozeUntil && alarm.snoozeUntil > now ? 'Snoozed' : nextLabel(alarm)}
            </span>
          </span>
          <input
            type="checkbox"
            class="m-switch"
            role="switch"
            aria-label="Alarm on"
            checked={alarm.enabled}
            onchange={(e) => alarms.setEnabled(alarm, e.currentTarget.checked)}
          />
          <button class="m-quiet" title="Remove" aria-label="Remove alarm" onclick={() => alarms.removeAlarm(alarm.id)}>
            &times;
          </button>
        </li>
      {/each}
    </ul>
    {#if alarms.alarms.length && !alarms.lease.held}
      <p class="m-sub note">Another display is the one that rings.</p>
    {/if}
  {/if}
</div>

<style>
  .ringing {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ring {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: calc(9px * var(--round, 1));
    background: color-mix(in oklab, var(--accent, #7aa2f7) 30%, transparent);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      background: color-mix(in oklab, var(--accent, #7aa2f7) 48%, transparent);
    }
  }

  .bell {
    font-size: calc(18px * var(--text-scale, 1));
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: calc(999px * var(--round, 1));
    background: var(--accent, #7aa2f7);
  }

  .add {
    flex: none;
    display: flex;
    gap: 6px;
  }

  .add input {
    flex: 1;
    min-width: 0;
  }

  .add input[type='time'] {
    flex: none;
    width: 7.5em;
  }

  .presets {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .timer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: calc(6px * var(--density)) 6px;
    border-radius: calc(8px * var(--round, 1));
  }

  .timer.done {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 16%, transparent);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .count {
    font-size: calc(var(--ui-size) * 1.6);
    min-width: 3.2em;
  }

  .watch {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 6px 0 2px;
  }

  .elapsed {
    font-size: calc(var(--ui-size) * 2.6);
  }

  .wide {
    min-width: 6em;
  }

  .lap .split {
    margin-left: auto;
  }

  .lap .total {
    width: 5.5em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .lap.best .split {
    color: var(--color-green-700, #5fbf7a);
  }

  .lap.worst .split {
    color: var(--color-red-700, #f77);
  }

  .new-alarm {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .days {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .day {
    width: 22px;
    padding: 2px 0;
    text-align: center;
  }

  .repeat {
    margin-left: 6px;
  }

  .add-button {
    flex: none;
    align-self: flex-start;
  }

  .alarm .when {
    font-size: calc(var(--ui-size) * 1.45);
    min-width: 3.3em;
  }

  .alarm.off .when,
  .alarm.off .m-title {
    opacity: 0.5;
  }

  .note {
    flex: none;
    text-align: center;
  }
</style>
