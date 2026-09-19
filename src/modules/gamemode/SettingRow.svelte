<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { gameMode, navItem } from '$lib/gamemode.svelte';
  import type { ModuleField } from '$lib/modules';

  interface Props {
    def: ModuleField;
    autofocus?: boolean;
  }

  let { def, autofocus = false }: Props = $props();

  const id = $derived(`set:${def.key}`);
  const selected = $derived(gameMode.focusId === id);
  const value = $derived(config.current[def.key]);

  /**
   * One setting, changed with the four directions.
   *
   * Left and right adjust rather than move - see `onadjust` in
   * `gamemode.svelte.ts` - which is what makes a slider usable from a sofa. A
   * switch flips on either direction and on confirm, a choice steps through its
   * options, and a range moves by its declared step, ten of them at a time when
   * that would otherwise take forty presses to cross.
   */
  function adjust(by: 1 | -1): void {
    if (def.type === 'switch') {
      config.set(def.key as never, (by > 0) as never, 'all');
      return;
    }

    if (def.type === 'select' && def.options?.length) {
      const values = def.options.map((option) => option.value);
      const at = values.indexOf(String(value));
      const next = values[(at + by + values.length) % values.length];
      if (next !== undefined) config.set(def.key as never, next as never, 'all');
      return;
    }

    if (def.type === 'range' || def.type === 'number') {
      const min = def.min ?? 0;
      const max = def.max ?? 100;
      const step = def.step ?? 1;
      // A range of more than forty steps is crossed in coarser jumps, or the
      // pointer-speed slider would take fifty-six presses end to end.
      const span = (max - min) / step;
      const grain = span > 40 ? step * Math.round(span / 20) : step;
      const next = Math.min(max, Math.max(min, Number(value) + by * grain));
      config.set(def.key as never, next as never, 'all');
    }
  }

  function confirm(): void {
    if (def.type === 'switch') config.set(def.key as never, (!value) as never, 'all');
    else adjust(1);
  }

  const shown = $derived.by(() => {
    if (def.type === 'switch') return value ? 'On' : 'Off';
    if (def.type === 'select') {
      return def.options?.find((option) => option.value === String(value))?.label ?? String(value);
    }
    if (def.type === 'text') return String(value || '—');
    return `${value}${def.unit ?? ''}`;
  });

  const ratio = $derived.by(() => {
    if (def.type !== 'range') return null;
    const min = def.min ?? 0;
    const max = def.max ?? 100;
    return max > min ? (Number(value) - min) / (max - min) : 0;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="srow"
  class:selected
  use:navItem={{ id, group: 'settings', autofocus, onactivate: confirm, onadjust: adjust }}
  onclick={confirm}
  onpointerenter={() => gameMode.focus(id)}
>
  <div class="text">
    <span class="label">{def.label}</span>
    {#if def.description}<span class="desc">{def.description}</span>{/if}
  </div>

  <div class="control">
    {#if def.type === 'text'}
      <!-- Text is shown, not edited: this screen has no keyboard worth typing a
           binding list on, and the desktop's own dialog does it properly. -->
      <span class="value muted">{shown}</span>
    {:else}
      {#if ratio !== null}
        <span class="track" aria-hidden="true"><span style:width="{ratio * 100}%"></span></span>
      {/if}
      <span class="value" class:on={def.type === 'switch' && value === true}>{shown}</span>
      {#if def.type !== 'switch'}
        <span class="arrows" aria-hidden="true">‹ ›</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .srow {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 14px 20px;
    cursor: pointer;
    border-radius: var(--gm-radius);
    scroll-margin: 120px;
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .srow.selected {
    background: var(--gm-wash);
    box-shadow: var(--gm-ring);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .label {
    font-size: calc(16px * var(--text-scale, 1));
    font-weight: 600;
  }

  .desc {
    font-size: calc(13px * var(--text-scale, 1));
    line-height: 1.4;
    color: var(--panel-fg-muted);
  }

  .control {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 240px;
    justify-content: flex-end;
  }

  .track {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--gm-surface-strong);
  }

  .track > span {
    display: block;
    height: 100%;
    background: var(--accent, #7aa2f7);
  }

  .value {
    min-width: 70px;
    text-align: right;
    font-size: calc(15px * var(--text-scale, 1));
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .value.on {
    color: var(--accent, #7aa2f7);
  }

  .value.muted {
    font-weight: 400;
    color: var(--panel-fg-muted);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The affordance for left/right: only drawn on the row the pad is on. */
  .arrows {
    width: 26px;
    text-align: center;
    color: var(--panel-fg-muted);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .srow.selected .arrows {
    opacity: 1;
  }
</style>
