<script lang="ts">
  import { config } from '$lib/config.svelte';

  const cfg = $derived(config.current);

  let now = $state(new Date());

  // One timer, aligned so it ticks close to the start of each second or minute
  // rather than drifting. Seconds off means a 60x cheaper wakeup.
  $effect(() => {
    const periodMs = cfg.clockShowSeconds ? 1000 : 60_000;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      now = new Date();
      const delay = periodMs - (Date.now() % periodMs);
      timer = setTimeout(tick, delay);
    };
    tick();

    return () => clearTimeout(timer);
  });

  const time = $derived(
    now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: cfg.clockShowSeconds ? '2-digit' : undefined,
      hour12: !cfg.clock24h,
    }),
  );

  const date = $derived(
    now.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );
</script>

<div class="clock">
  <time datetime={now.toISOString()}>{time}</time>
  {#if cfg.clockShowDate}
    <span class="date">{date}</span>
  {/if}
</div>

<style>
  .clock {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }

  time {
    font-family: var(--display-font);
    font-size: calc(var(--ui-size) * 3);
    font-weight: 200;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  .date {
    font-size: calc(var(--ui-size) * 0.93);
    color: var(--panel-fg-muted);
  }
</style>
