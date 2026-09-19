<script lang="ts">
  import { ACTION_LABELS, glyphFor, resolveLayout, type Bindings, type PadAction } from '$lib/gamepad';
  import { pad } from '$lib/gamepad.svelte';
  import { config } from '$lib/config.svelte';

  interface Props {
    bindings: Bindings;
    /** Which actions to show, in order; the rest are left to be discovered. */
    actions: readonly PadAction[];
    /** Overrides for the wording, where a section means something else by it. */
    labels?: Partial<Record<PadAction, string>>;
  }

  let { bindings, actions, labels = {} }: Props = $props();

  const cfg = $derived(config.current);

  /*
   * Which family's glyphs to draw.
   *
   * The pad's own id when it is plugged in, the user's choice when they made
   * one, and Xbox when there is no pad at all - the hints are worth showing
   * before a controller is connected, and something has to be drawn.
   */
  const layout = $derived(resolveLayout(cfg.padLayout, pad.primary?.id ?? ''));
</script>

<footer class="legend">
  {#each actions as action (action)}
    <span class="hint">
      <kbd>{glyphFor(bindings[action], layout)}</kbd>
      {labels[action] ?? ACTION_LABELS[action]}
    </span>
  {/each}

  {#if !pad.connected}
    <span class="hint none">No controller — arrow keys, Enter and Escape work too</span>
  {/if}
</footer>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 22px;
    padding: 14px 44px;
    font-size: calc(13px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    /* Over the shelves rather than beside them, so the rows can run the full
       height of the screen and slide under it. */
    background: linear-gradient(
      to top,
      color-mix(in oklab, var(--panel-ground) 70%, transparent),
      transparent
    );
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  .hint.none {
    margin-inline-start: auto;
    opacity: 0.75;
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 26px;
    height: 26px;
    padding-inline: 7px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    font-weight: 700;
    color: var(--panel-fg);
    background: var(--gm-surface-strong);
    border: var(--gm-edge);
    border-radius: var(--gm-pill);
  }
</style>
