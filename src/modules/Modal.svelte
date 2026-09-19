<script lang="ts">
  import type { Snippet } from 'svelte';
  import { config } from '$lib/config.svelte';
  import { fadeLayer, pop } from '$lib/motion';

  interface Props {
    title: string;
    onclose: () => void;
    children: Snippet;
    width?: number;
  }

  let { title, onclose, children, width = 520 }: Props = $props();

  const cfg = $derived(config.current);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<!--
  The dim fades in and the dialog rises out of it; both leave faster than they
  came. Global transitions, because the block that removes a dialog is wherever
  its opener put it - sometimes a component or two up, inside another block -
  and a local transition only plays for the block it sits in directly.
-->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onclick={onclose}
  in:fadeLayer|global={{ duration: 300 }}
  out:fadeLayer|global={{ duration: 200 }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="dialog panel"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={title}
    style:width="{width}px"
    style:border-radius="{cfg.cornerRadius}px"
    onclick={(e) => e.stopPropagation()}
    in:pop|global={{ duration: 480, y: 22, scale: 0.94 }}
    out:pop|global={{ duration: 180, y: 10, scale: 0.97 }}
  >
    <header>
      <h2>{title}</h2>
      <button class="close" onclick={onclose} aria-label="Close">&times;</button>
    </header>
    <div class="body">{@render children()}</div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.45);
    backdrop-filter: blur(2px);
    cursor: default;
  }

  .dialog {
    max-width: 92vw;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    flex: none;
    border-bottom: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  h2 {
    font-size: calc(13px * var(--text-scale, 1));
    font-weight: 600;
  }

  /* Turns a quarter toward the pointer, the way the panel menu button does. */
  .close {
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: calc(20px * var(--text-scale, 1));
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
    border-radius: calc(6px * var(--round, 1));
    transition:
      color var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease),
      rotate var(--dur-slow) var(--ease-spring),
      scale var(--dur) var(--ease-spring);
  }

  .close:hover {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    rotate: 90deg;
  }

  .close:active {
    scale: 0.85;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }
</style>
