<script lang="ts">
  interface Props {
    value: string;
    /** 1 rolls a new digit up from below, as a clock counting up; -1 drops it from above. */
    direction?: 1 | -1;
  }

  let { value, direction = 1 }: Props = $props();

  const chars = $derived([...value]);
</script>

<!--
  A number whose digits roll into place as they change.

  Keyed by position *and* character, so only a digit that actually changed is
  replaced - and so animated - while the rest stay exactly where they are. The
  plain string is kept once for screen readers; the rolling copy beside it is
  decoration.
-->
<span class="ticker" style:--dir={direction}>
  <span class="text">{value}</span>
  <span class="roll" aria-hidden="true">
    {#each chars as char, i (`${i}:${char}`)}
      <span class:digit={char >= '0' && char <= '9'}>{char}</span>
    {/each}
  </span>
</span>

<style>
  .ticker {
    position: relative;
    display: inline-flex;
  }

  .text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .roll {
    display: inline-flex;
    white-space: pre;
  }

  .roll > span {
    display: inline-block;
  }

  .digit {
    animation: fx-digit var(--dur-slow) var(--ease) backwards;
    animation-delay: var(--lag, 0ms);
  }
</style>
