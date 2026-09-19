<script lang="ts">
  import FieldRow from './FieldRow.svelte';
  import { shell } from '$lib/shell-settings.svelte';
  import { decodeKnob, type ThemeKnob } from '$lib/shell-theme';

  /** One of the Desktop Surface theme's settings, as a row; see `FieldRow`. */
  interface Props {
    knob: ThemeKnob;
  }

  let { knob }: Props = $props();

  const stored = $derived(shell.values[knob.name]);
  const type = $derived(
    knob.options ? 'select' : knob.syntax === '<color>' ? 'color' : knob.syntax === '<family-name>' ? 'font' : 'range',
  );
</script>

<FieldRow
  label={knob.label}
  description={knob.description}
  {type}
  value={decodeKnob(knob, stored)}
  min={knob.min}
  max={knob.max}
  step={knob.step}
  unit={knob.unit}
  options={knob.options}
  placeholder="Theme default"
  clearValue={knob.syntax === '<color>' ? 'transparent' : undefined}
  onchange={(value) => shell.set(knob, value as string | number)}
>
  {#snippet extra()}
    {#if stored !== undefined}
      <button class="reset" title="Back to the theme's default" aria-label="Reset {knob.label}" onclick={() => shell.reset(knob.name)}>
        &#8634;
      </button>
    {/if}
  {/snippet}
</FieldRow>

<style>
  .reset {
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 13px;
    line-height: 1;
    color: var(--panel-fg-muted);
    border-radius: calc(6px * var(--round, 1));
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease),
      rotate var(--dur-slow) var(--ease-spring);
  }

  .reset:hover {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    rotate: -90deg;
  }
</style>
