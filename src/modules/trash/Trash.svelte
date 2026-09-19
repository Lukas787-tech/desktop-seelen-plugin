<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { emptyTrash, openTrash, trash } from '$lib/trash.svelte';
  import { formatBytes } from '$lib/system.svelte';

  const cfg = $derived(config.current);

  $effect(() => trash.acquire());

  let confirming = $state(false);

  // A confirmation left armed turns a later, idle click on "Empty" into an
  // immediate and unrecoverable delete, so it disarms itself after a while.
  $effect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => (confirming = false), 6000);
    return () => clearTimeout(timer);
  });
  /** The last failure the host reported, shown until the next attempt. */
  let failure = $state<string | null>(null);

  const info = $derived(trash.current);
  const empty = $derived(info.itemCount === 0);

  function press() {
    if (cfg.trashConfirmEmpty && !confirming) {
      confirming = true;
      return;
    }
    failure = null;
    emptyTrash((message) => (failure = message));
    confirming = false;
  }

  function open() {
    failure = null;
    openTrash((message) => (failure = message));
  }
</script>

<div class="m-body" data-no-drag>
  <div class="count">
    <span class="value">{info.itemCount}</span>
    <span class="m-sub">
      {info.itemCount === 1 ? 'item' : 'items'}
      {#if !empty}&nbsp;&middot; {formatBytes(info.sizeInBytes)}{/if}
    </span>
  </div>

  <div class="m-actions">
    <button class="m-btn" onclick={open}>Open</button>
    <button class="m-btn" class:m-danger={!confirming} class:m-primary={confirming} disabled={empty} onclick={press}>
      {confirming ? 'Delete everything' : 'Empty'}
    </button>
    {#if confirming}
      <button class="m-btn" onclick={() => (confirming = false)}>Cancel</button>
    {/if}
  </div>

  {#if failure}
    <p class="failed" role="status">Windows would not do that: {failure}</p>
  {/if}
</div>

<style>
  .count {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .value {
    font-size: calc(28px * var(--text-scale, 1));
    font-weight: var(--display-weight, 200);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .m-actions {
    margin-top: auto;
  }

  .failed {
    font-size: calc(10px * var(--text-scale, 1));
    line-height: 1.35;
    color: var(--color-red-700, #f77);
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
