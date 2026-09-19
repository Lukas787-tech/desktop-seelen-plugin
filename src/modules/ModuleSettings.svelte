<script lang="ts">
  import Modal from './Modal.svelte';
  import SettingField from './SettingField.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import { config } from '$lib/config.svelte';
  import { MODULES, PANEL_FIELDS, moduleKeys, type ModuleField } from '$lib/modules';
  import { overlay } from '$lib/overlay.svelte';
  import { MIN_PANEL_SIZE, store, type PanelKind } from '$lib/store.svelte';

  interface Props {
    kind: PanelKind;
    onclose: () => void;
  }

  let { kind, onclose }: Props = $props();

  const module = $derived(MODULES[kind]);
  const keys = $derived(moduleKeys(module));

  const panel = $derived(store.state.panels.find((p) => p.kind === kind));
  const overridden = $derived(keys.filter((key) => config.overrides.has(key)));

  /** The module's own on/off, drawn as one more field so it reads like the rest. */
  const showField = $derived<ModuleField>({
    key: module.enabledKey,
    label: 'Show this module',
    description: 'Turning it off leaves its position and contents untouched.',
    type: 'switch',
  });

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

  function resize(part: 'w' | 'h', value: number): void {
    if (!panel) return;
    const next = { w: panel.w, h: panel.h, [part]: value };
    store.resizePanel(panel.id, next.w, next.h);
  }

  /** Everything else about how panels look lives in its own dialog; this is the way there. */
  function openAppearance(): void {
    onclose();
    overlay.openDialog(AppearanceSettings, { tab: 'panels' as const, onclose: () => overlay.closeDialog() });
  }
</script>

<Modal title="{module.title} settings" {onclose} width={460}>
  <div class="scope" role="group" aria-label="Where changes apply">
    <span class="scope-label">Changes apply to</span>
    <div class="m-tabs">
      <button class:m-on={scope === 'all'} onclick={() => (scope = 'all')}>All displays</button>
      <button class:m-on={scope === 'monitor'} onclick={() => (scope = 'monitor')}>This display</button>
    </div>
  </div>

  <section>
    <h3>{module.title}</h3>
    <SettingField def={showField} {scope} />
    {#each module.fields as def (def.key)}
      <SettingField {def} {scope} />
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
    {#each PANEL_FIELDS as def (def.key)}
      <SettingField {def} {scope} />
    {/each}
    <div class="buttons">
      <button onclick={openAppearance}>Looks, colours, edges and more...</button>
    </div>
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

<style>
  .scope {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }

  .scope-label {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  section {
    margin-bottom: 16px;
  }

  h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
    font-size: calc(10px * var(--text-scale, 1));
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
    font-size: calc(12px * var(--text-scale, 1));
  }

  .note {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    text-transform: none;
    letter-spacing: 0;
  }

  .size {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .times {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  input[type='number'] {
    width: 84px;
    padding: 5px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  .buttons {
    display: flex;
    gap: 6px;
    padding-top: 8px;
  }

  .buttons button,
  .link {
    padding: 5px 10px;
    font-size: calc(11px * var(--text-scale, 1));
    border-radius: calc(7px * var(--round, 1));
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
