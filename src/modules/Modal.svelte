<script lang="ts">
  import type { Snippet } from 'svelte';
  import { config } from '$lib/config.svelte';

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

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
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
    font-size: 13px;
    font-weight: 600;
  }

  .close {
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }

  .close:hover {
    color: var(--panel-fg);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }
</style>
