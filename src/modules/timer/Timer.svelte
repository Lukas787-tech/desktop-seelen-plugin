<script lang="ts">
  import { config } from '$lib/config.svelte';

  const cfg = $derived(config.current);

  type Phase = 'work' | 'break';

  let phase = $state<Phase>('work');
  let running = $state(false);
  /**
   * Seconds left, and the source of truth while paused.
   *
   * Seeded from the store rather than the derived above, which would only ever
   * capture its first value here; the effect below keeps it in step afterwards.
   */
  let left = $state(config.current.timerWorkMinutes * 60);
  /** When the current run ends, so a slow tick can never lose time. */
  let endsAt = $state(0);

  const total = $derived((phase === 'work' ? cfg.timerWorkMinutes : cfg.timerBreakMinutes) * 60);

  // A paused timer follows the setting, so changing the length in the dialog
  // shows up straight away instead of at the next reset.
  $effect(() => {
    if (!running) left = total;
  });

  // Counts down against a wall-clock deadline rather than by subtracting a
  // tick, which is what keeps it honest if the machine sleeps mid-run.
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const remaining = Math.round((endsAt - Date.now()) / 1000);
      if (remaining > 0) {
        left = remaining;
        return;
      }
      left = 0;
      complete();
    }, 250);
    return () => clearInterval(timer);
  });

  function start() {
    endsAt = Date.now() + left * 1000;
    running = true;
  }

  function pause() {
    left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    running = false;
  }

  function reset() {
    running = false;
    left = total;
  }

  /** Moves to the other phase, whether the run finished or was skipped. */
  function switchPhase(autoStart: boolean) {
    phase = phase === 'work' ? 'break' : 'work';
    const next = (phase === 'work' ? cfg.timerWorkMinutes : cfg.timerBreakMinutes) * 60;
    left = next;
    running = autoStart;
    if (autoStart) endsAt = Date.now() + next * 1000;
  }

  function complete() {
    if (cfg.timerChime) chime();
    switchPhase(cfg.timerAutoContinue);
  }

  /**
   * Two short tones through WebAudio.
   *
   * No asset to ship, no file to load, and it stops existing the moment it has
   * played - the surface holds no audio context between runs.
   */
  function chime() {
    try {
      const context = new AudioContext();
      const now = context.currentTime;
      for (const [i, frequency] of [880, 1320].entries()) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.frequency.value = frequency;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, now + i * 0.25);
        gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.25 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.22);
        osc.connect(gain).connect(context.destination);
        osc.start(now + i * 0.25);
        osc.stop(now + i * 0.25 + 0.24);
      }
      setTimeout(() => void context.close().catch(() => {}), 1200);
    } catch (err) {
      console.error('[timer] could not play the chime', err);
    }
  }

  const clock = $derived(
    `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
  );
  const progress = $derived(total > 0 ? ((total - left) / total) * 100 : 0);
</script>

<div class="m-body" data-no-drag>
  <div class="head">
    <span class="m-pill" class:m-on={running}>{phase === 'work' ? 'Focus' : 'Break'}</span>
    <span class="clock">{clock}</span>
  </div>

  <div class="m-bar"><span style:width="{progress}%"></span></div>

  <div class="m-actions">
    <button class="m-btn m-primary" onclick={() => (running ? pause() : start())}>
      {running ? 'Pause' : left === total ? 'Start' : 'Resume'}
    </button>
    <button class="m-btn" onclick={reset} disabled={left === total && !running}>Reset</button>
    <button class="m-btn" onclick={() => switchPhase(false)}>
      {phase === 'work' ? 'Break' : 'Focus'}
    </button>
  </div>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
  }

  .clock {
    font-family: var(--display-font);
    font-size: calc(var(--ui-size) * 2.43);
    font-weight: 200;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  .m-actions {
    margin-top: auto;
  }
</style>
