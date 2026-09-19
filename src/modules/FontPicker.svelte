<script lang="ts">
  import { fonts } from '$lib/fonts.svelte';

  interface Props {
    value: string;
    /** Shown, and chosen, for an empty value - "Theme default", "Same as interface". */
    placeholder: string;
    label: string;
    onchange: (family: string) => void;
  }

  let { value, placeholder, label, onchange }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let root = $state<HTMLElement | null>(null);
  let search = $state<HTMLInputElement | null>(null);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? fonts.families.filter((family) => family.toLowerCase().includes(q)) : fonts.families;
  });

  /** A family typed that the list does not have: still offered, since it may be installed later or be a web font in a user stylesheet. */
  const typedExtra = $derived(
    query.trim() && !fonts.families.some((family) => family.toLowerCase() === query.trim().toLowerCase()) ? query.trim() : '',
  );

  function face(family: string): string {
    return `"${family.replace(/["\\]/g, '')}", var(--ui-font)`;
  }

  function toggle(): void {
    open = !open;
    if (!open) return;
    query = '';
    void fonts.load();
    // After the list renders, so the field exists to take focus.
    queueMicrotask(() => search?.focus());
  }

  function pick(family: string): void {
    onchange(family);
    open = false;
  }

  function keys(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Close the picker, not the whole dialog around it.
      event.stopPropagation();
      open = false;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = typedExtra || filtered[0];
      if (first) pick(first);
    }
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }}
/>

<div class="picker" bind:this={root}>
  <button
    class="current"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="{label}: {value || placeholder}"
    style:font-family={value ? face(value) : undefined}
    onclick={toggle}
  >
    <span class="name">{value || placeholder}</span>
    <span class="chevron" aria-hidden="true">&#9662;</span>
  </button>

  {#if open}
    <div class="drop">
      <input
        bind:this={search}
        bind:value={query}
        type="text"
        spellcheck="false"
        placeholder={fonts.families.length ? `Search ${fonts.families.length} fonts` : 'Loading fonts...'}
        aria-label="Search fonts"
        onkeydown={keys}
      />
      <div class="list" role="listbox" aria-label={label}>
        {#if !query.trim()}
          <button role="option" aria-selected={!value} class:on={!value} onclick={() => pick('')}>
            {placeholder}
          </button>
        {/if}
        {#if typedExtra}
          <button role="option" aria-selected="false" style:font-family={face(typedExtra)} onclick={() => pick(typedExtra)}>
            Use "{typedExtra}"
          </button>
        {/if}
        <!-- Each in its own face, so choosing a font is looking at it. Off-screen
             rows skip layout and paint, which is what keeps a few hundred faces
             from costing anything until they are scrolled to. -->
        {#each filtered as family (family)}
          <button
            role="option"
            aria-selected={family === value}
            class:on={family === value}
            style:font-family={face(family)}
            onclick={() => pick(family)}
          >
            {family}
          </button>
        {/each}
        {#if fonts.families.length && !filtered.length && !typedExtra}
          <p class="none">No installed font matches.</p>
        {/if}
      </div>
      {#if fonts.families.length && !fonts.fromHost}
        <p class="note">Showing the fonts Windows ships; the installed list could not be read.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    flex: none;
    width: 200px;
  }

  .current {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    font-size: calc(12px * var(--text-scale, 1));
    text-align: left;
    color: var(--panel-fg);
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
    cursor: pointer;
  }

  .current:hover {
    background: color-mix(in oklab, var(--color-gray-100, #333) 70%, transparent);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    flex: none;
    font-size: 9px;
    color: var(--panel-fg-muted);
  }

  .drop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-50, #16161e) 97%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--color-gray-300, #666) 40%, transparent),
      0 12px 32px rgb(0 0 0 / 0.35);
    animation: fx-pop var(--dur) var(--ease) backwards;
  }

  input {
    padding: 6px 8px;
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg);
    border-radius: calc(7px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 60%, transparent);
  }

  input:focus {
    outline: none;
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent);
  }

  .list {
    max-height: 260px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .list button {
    flex: none;
    padding: 5px 8px;
    font-size: calc(13px * var(--text-scale, 1));
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--panel-fg);
    border-radius: calc(6px * var(--round, 1));
    cursor: pointer;
    content-visibility: auto;
    contain-intrinsic-size: auto 26px;
  }

  .list button:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .list button.on {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 28%, transparent);
  }

  .none,
  .note {
    margin: 4px 6px;
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }
</style>
