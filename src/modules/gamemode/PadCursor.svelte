<script lang="ts">
  import { padControl } from '$lib/padcontrol.svelte';
  import { config } from '$lib/config.svelte';

  const cfg = $derived(config.current);
  const size = $derived(cfg.padPointerSize);
</script>

<!--
  The pointer the right stick drives.

  Drawn rather than moved: a webview cannot move the system cursor, so what the
  user aims with is this, and `padcontrol.svelte.ts` dispatches the pointer and
  click events at whatever sits underneath it. `pointer-events: none` is
  essential - a cursor that could be hit by its own clicks would hit itself
  every time.
-->
{#if padControl.running && padControl.visible}
  <div
    class="cursor"
    class:pressing={padControl.pressing}
    style:left="{padControl.x}px"
    style:top="{padControl.y}px"
    style:--size="{size}px"
    aria-hidden="true"
  >
    <span class="dot"></span>
    <span class="ring"></span>
  </div>
{/if}

<style>
  .cursor {
    position: fixed;
    z-index: 9000;
    pointer-events: none;
    width: var(--size);
    height: var(--size);
    /* The hot spot is the centre of the dot, which is where the click is sent. */
    translate: -50% -50%;
  }

  .dot,
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }

  /* The pointer is drawn in the scheme's own ink and ground, so it stays
     visible on a light theme instead of being a white dot on white. */
  .dot {
    inset: 28%;
    background: var(--panel-fg);
    box-shadow: 0 1px 4px var(--panel-ground);
  }

  .ring {
    border: 2px solid color-mix(in oklab, var(--accent, #7aa2f7) 85%, var(--panel-fg));
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--panel-ground) 70%, transparent),
      0 2px 10px color-mix(in oklab, var(--panel-ground) 60%, transparent);
    transition:
      scale 120ms ease,
      opacity 120ms ease;
  }

  .cursor.pressing .ring {
    scale: 0.7;
    opacity: 0.85;
  }
</style>
