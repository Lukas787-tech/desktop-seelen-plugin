<script lang="ts">
  import Modal from './Modal.svelte';
  import { config, type ConfigKey } from '$lib/config.svelte';
  import { MODULES, PANEL_FIELDS, moduleKeys, type ModuleField } from '$lib/modules';
  import { MIN_PANEL_SIZE, store, type PanelKind } from '$lib/store.svelte';

  interface Props {
    kind: PanelKind;
    onclose: () => void;
  }

  let { kind, onclose }: Props = $props();

  const module = $derived(MODULES[kind]);
  const keys = $derived(moduleKeys(module));

  const cfg = $derived(config.current);
  const panel = $derived(store.state.panels.find((p) => p.kind === kind));
  const overridden = $derived(keys.filter((key) => config.overrides.has(key)));

  /**
   * Where edits made here land.
   *
   * Chosen once, from the scope the module already uses: a display that has
   * been customised keeps being customised, and one that follows the others is
   * not silently detached by the first click. The dialog is created fresh each
   * time it opens, so this is re-evaluated per visit.
   */
  function initialScope(): 'monitor' | 'all' {
    return moduleKeys(MODULES[kind]).some((key) => config.overrides.has(key)) ? 'monitor' : 'all';
  }

  let scope = $state<'monitor' | 'all'>(initialScope());

  // `set` is generic over the key, which a key chosen at runtime cannot satisfy;
  // the schema is what guarantees the value matches its field.
  function setValue(key: ConfigKey, value: unknown): void {
    config.set(key as never, value as never, scope);
  }

  function numberOf(key: ConfigKey): number {
    const value = cfg[key];
    return typeof value === 'number' ? value : 0;
  }

  function stringOf(key: ConfigKey): string {
    const value = cfg[key];
    return typeof value === 'string' ? value : '';
  }

  function resize(part: 'w' | 'h', value: number): void {
    if (!panel) return;
    const next = { w: panel.w, h: panel.h, [part]: value };
    store.resizePanel(panel.id, next.w, next.h);
  }
</script>

<Modal title="{module.title} settings" {onclose} width={460}>
  <div class="scope" role="group" aria-label="Where changes apply">
    <span class="scope-label">Changes apply to</span>
    <div class="segmented">
      <button class:active={scope === 'all'} onclick={() => (scope = 'all')}>All displays</button>
      <button class:active={scope === 'monitor'} onclick={() => (scope = 'monitor')}>
        This display
      </button>
    </div>
  </div>

  <section>
    <h3>{module.title}</h3>

    <div class="row">
      <div class="text">
        <span class="label">Show this module</span>
        <span class="description">
          Turning it off leaves its position and contents untouched.
        </span>
      </div>
      {@render override(module.enabledKey)}
      <input
        type="checkbox"
        class="switch"
        role="switch"
        aria-label="Show this module"
        checked={cfg[module.enabledKey] === true}
        onchange={(e) => setValue(module.enabledKey, e.currentTarget.checked)}
      />
    </div>

    {#each module.fields as fieldDef (fieldDef.key)}
      {@render field(fieldDef)}
    {/each}
  </section>

  {#if panel}
    {@const placed = panel}
    <section>
      <h3>Placement <span class="note">always per display</span></h3>
      <div class="row">
        <div class="text"><span class="label">Size</span></div>
        <div class="size">
          <label>
            <span class="sr">Width</span>
            <input
              type="number"
              min={MIN_PANEL_SIZE.w}
              step="10"
              value={placed.w}
              onchange={(e) => resize('w', e.currentTarget.valueAsNumber)}
            />
          </label>
          <span class="times" aria-hidden="true">&times;</span>
          <label>
            <span class="sr">Height</span>
            <input
              type="number"
              min={MIN_PANEL_SIZE.h}
              step="10"
              value={placed.h}
              onchange={(e) => resize('h', e.currentTarget.valueAsNumber)}
            />
          </label>
        </div>
      </div>
      <div class="buttons">
        <button onclick={() => store.resetPanel(placed.id, 'size')}>Reset size</button>
        <button onclick={() => store.resetPanel(placed.id, 'position')}>Reset position</button>
      </div>
    </section>
  {/if}

  <section>
    <h3>All panels</h3>
    {#each PANEL_FIELDS as fieldDef (fieldDef.key)}
      {@render field(fieldDef)}
    {/each}
  </section>

  {#if overridden.length}
    <footer>
      <p class="note">
        {overridden.length}
        {overridden.length === 1 ? 'setting is' : 'settings are'} set only on this display.
      </p>
      <button class="link" onclick={() => config.clearOverrides(overridden)}>
        Use the same settings as other displays
      </button>
    </footer>
  {/if}
</Modal>

{#snippet override(key: ConfigKey)}
  {#if config.overrides.has(key)}
    <button
      class="badge"
      title="Set only on this display. Click to follow the other displays again."
      onclick={() => config.clearOverride(key)}
    >
      this display
    </button>
  {/if}
{/snippet}

{#snippet field(def: ModuleField)}
  <div class="row">
    <div class="text">
      <span class="label">{def.label}</span>
      {#if def.description}<span class="description">{def.description}</span>{/if}
    </div>

    {@render override(def.key)}

    {#if def.type === 'switch'}
      <input
        type="checkbox"
        class="switch"
        role="switch"
        aria-label={def.label}
        checked={cfg[def.key] === true}
        onchange={(e) => setValue(def.key, e.currentTarget.checked)}
      />
    {:else if def.type === 'range'}
      <div class="range">
        <input
          type="range"
          aria-label={def.label}
          min={def.min}
          max={def.max}
          step={def.step}
          value={numberOf(def.key)}
          oninput={(e) => setValue(def.key, e.currentTarget.valueAsNumber)}
        />
        <span class="value">{numberOf(def.key)}{def.unit ?? ''}</span>
      </div>
    {:else if def.type === 'select'}
      <select
        aria-label={def.label}
        value={stringOf(def.key)}
        onchange={(e) => setValue(def.key, e.currentTarget.value)}
      >
        {#each def.options ?? [] as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    {:else}
      <!-- Committed on change rather than on input: a write per keystroke
           would rewrite the settings file while the user is still typing. -->
      <input
        type="text"
        class="text-field"
        aria-label={def.label}
        placeholder={def.placeholder ?? ''}
        value={stringOf(def.key)}
        onchange={(e) => setValue(def.key, e.currentTarget.value)}
      />
    {/if}
  </div>
{/snippet}

<style>
  .scope {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }

  .scope-label {
    font-size: 11px;
    color: var(--panel-fg-muted);
  }

  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 9px;
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .segmented button {
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 7px;
    background: transparent;
    color: var(--panel-fg-muted);
    cursor: pointer;
  }

  .segmented button.active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 45%, transparent);
    color: var(--panel-fg);
  }

  section {
    margin-bottom: 16px;
  }

  h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: 12px;
  }

  .description,
  .note {
    font-size: 11px;
    color: var(--panel-fg-muted);
    text-transform: none;
    letter-spacing: 0;
  }

  .badge {
    flex: none;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10px;
    cursor: pointer;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .badge:hover {
    color: var(--panel-fg);
  }

  /* A checkbox drawn as a switch, so the dialog reads like Seelen's own. */
  .switch {
    flex: none;
    appearance: none;
    width: 34px;
    height: 19px;
    border-radius: 999px;
    position: relative;
    cursor: pointer;
    background: color-mix(in oklab, var(--color-gray-300, #666) 35%, transparent);
    transition: background 0.15s ease;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s ease;
  }

  .switch:checked {
    background: color-mix(in oklab, var(--color-blue-600, #37f) 85%, transparent);
  }

  .switch:checked::after {
    transform: translateX(15px);
  }

  .range {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .range input {
    width: 130px;
    accent-color: var(--accent);
  }

  .value {
    width: 42px;
    font-size: 11px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--panel-fg-muted);
  }

  .size {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .times {
    font-size: 11px;
    color: var(--panel-fg-muted);
  }

  input[type='number'],
  input[type='text'],
  select {
    width: 84px;
    padding: 5px 8px;
    font: inherit;
    font-size: 12px;
    border-radius: 8px;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  select {
    width: 110px;
    cursor: pointer;
  }

  .text-field {
    width: 180px;
  }

  .buttons {
    display: flex;
    gap: 6px;
    padding-top: 8px;
  }

  .buttons button,
  .link {
    padding: 5px 10px;
    font-size: 11px;
    border-radius: 7px;
    cursor: pointer;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .buttons button:hover,
  .link:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 36%, transparent);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
