<script lang="ts">
  import FieldRow from './FieldRow.svelte';
  import { config } from '$lib/config.svelte';
  import type { ModuleField } from '$lib/modules';

  /** One of the desktop widget's own settings, as a row; see `FieldRow`. */
  interface Props {
    def: ModuleField;
    /** Where an edit lands; see `SettingScope` in `config.svelte.ts`. */
    scope: 'monitor' | 'all';
  }

  let { def, scope }: Props = $props();
</script>

<!-- `set` is generic over the key, which a key chosen at runtime cannot
     satisfy; the schema is what guarantees the value matches its field. -->
<FieldRow
  label={def.label}
  description={def.description}
  type={def.type}
  value={config.current[def.key]}
  min={def.min}
  max={def.max}
  step={def.step}
  unit={def.unit}
  options={def.options}
  placeholder={def.placeholder}
  onchange={(value) => config.set(def.key as never, value as never, scope)}
>
  {#snippet extra()}
    {#if config.overrides.has(def.key)}
      <button
        class="badge"
        title="Set only on this display. Click to follow the other displays again."
        onclick={() => config.clearOverride(def.key)}
      >
        this display
      </button>
    {/if}
  {/snippet}
</FieldRow>

<style>
  .badge {
    flex: none;
    padding: 2px 7px;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(10px * var(--text-scale, 1));
    cursor: pointer;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .badge:hover {
    color: var(--panel-fg);
  }
</style>
