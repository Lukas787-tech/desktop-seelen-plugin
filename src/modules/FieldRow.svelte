<script lang="ts" module>
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import FontPicker from './FontPicker.svelte';
  import type { FieldType } from '$lib/modules';

  /**
   * One labelled setting and its control, with no idea where the value lives.
   *
   * The desktop's own settings (`SettingField`) and the shell theme's
   * (`ShellField`) are stored in different places and written differently, but
   * a slider is a slider: both draw through this, so the Appearance dialog's
   * Shell tab looks and behaves exactly like its Panels tab.
   */
  interface Props {
    label: string;
    description?: string;
    type: FieldType;
    value: unknown;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    options?: readonly { label: string; value: string }[];
    placeholder?: string;
    /** A colour that means "none, follow something else", offered as a clear button. */
    clearValue?: string;
    onchange: (value: unknown) => void;
    /** Beside the control: an override badge, a reset button. */
    extra?: Snippet;
  }

  let { label, description, type, value, min, max, step, unit, options, placeholder, clearValue, onchange, extra }: Props =
    $props();

  const num = $derived(typeof value === 'number' ? value : Number(value) || 0);
  const str = $derived(typeof value === 'string' ? value : '');
  const cleared = $derived(clearValue !== undefined && (str === clearValue || str === ''));
  /* A colour input only takes six-digit hex; an alpha or a short form is shown
     as its nearest, and the text box beside it keeps the exact value. */
  const hex = $derived.by(() => {
    if (!HEX.test(str)) return '#000000';
    if (str.length === 4) return `#${[...str.slice(1)].map((c) => c + c).join('')}`;
    return str.slice(0, 7);
  });

  function shown(n: number): string {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, '');
  }
</script>

<div class="row">
  <div class="text">
    <span class="label">{label}</span>
    {#if description}<span class="description">{description}</span>{/if}
  </div>

  {#if extra}{@render extra()}{/if}

  {#if type === 'switch'}
    <input
      type="checkbox"
      class="switch"
      role="switch"
      aria-label={label}
      checked={value === true}
      onchange={(e) => onchange(e.currentTarget.checked)}
    />
  {:else if type === 'range'}
    <div class="range">
      <input
        type="range"
        aria-label={label}
        {min}
        {max}
        {step}
        value={num}
        oninput={(e) => onchange(e.currentTarget.valueAsNumber)}
      />
      <span class="value">{shown(num)}{unit ?? ''}</span>
    </div>
  {:else if type === 'number'}
    <div class="range">
      <input
        type="number"
        class="number"
        aria-label={label}
        {min}
        {max}
        {step}
        value={num}
        onchange={(e) => {
          const next = e.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onchange(next);
          else e.currentTarget.value = String(num);
        }}
      />
      {#if unit}<span class="unit">{unit}</span>{/if}
    </div>
  {:else if type === 'select'}
    <select aria-label={label} value={str} onchange={(e) => onchange(e.currentTarget.value)}>
      {#each options ?? [] as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  {:else if type === 'color'}
    <div class="colour">
      <input
        type="color"
        class:cleared
        aria-label={label}
        value={hex}
        oninput={(e) => onchange(e.currentTarget.value)}
      />
      <!-- A typed value that is not a colour is put back rather than written:
           an invalid colour would take down every declaration built on it. -->
      <input
        type="text"
        class="hex"
        spellcheck="false"
        aria-label="{label} as hex"
        placeholder={cleared ? 'Automatic' : ''}
        value={cleared ? '' : str}
        onchange={(e) => {
          const typed = e.currentTarget.value.trim();
          if (!typed && clearValue !== undefined) onchange(clearValue);
          else if (HEX.test(typed)) onchange(typed);
          else e.currentTarget.value = cleared ? '' : str;
        }}
      />
      {#if clearValue !== undefined}
        <button class="clear" title="Clear" aria-label="Clear {label}" disabled={cleared} onclick={() => onchange(clearValue)}>
          &times;
        </button>
      {/if}
    </div>
  {:else if type === 'font'}
    <FontPicker {label} value={str} placeholder={placeholder || 'Theme default'} onchange={(family) => onchange(family)} />
  {:else}
    <!-- Committed on change rather than on input: a write per keystroke
         would rewrite the settings file while the user is still typing. -->
    <input
      type="text"
      class="text-field"
      aria-label={label}
      placeholder={placeholder ?? ''}
      value={str}
      onchange={(e) => onchange(e.currentTarget.value)}
    />
  {/if}
</div>

<style>
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

  .description {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  /* A checkbox drawn as a switch, so the dialog reads like Seelen's own. */
  .switch {
    flex: none;
    appearance: none;
    width: 34px;
    height: 19px;
    border-radius: calc(999px * var(--round, 1));
    position: relative;
    cursor: pointer;
    background: color-mix(in oklab, var(--color-gray-300, #666) 35%, transparent);
    transition: background-color var(--dur-fast) var(--ease);
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 15px;
    height: 15px;
    border-radius: calc(999px * var(--round, 1));
    background: #fff;
    transition: transform var(--dur) var(--ease-spring);
  }

  .switch:checked {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 80%, transparent);
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

  .range input[type='range'] {
    width: 150px;
    accent-color: var(--accent);
  }

  .value,
  .unit {
    width: 46px;
    font-size: calc(11px * var(--text-scale, 1));
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--panel-fg-muted);
  }

  .unit {
    width: auto;
    text-align: left;
  }

  input[type='text'],
  input[type='number'],
  select {
    padding: 5px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  select {
    width: 200px;
    cursor: pointer;
  }

  .number {
    width: 90px;
  }

  .text-field {
    width: 200px;
  }

  .colour {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  input[type='color'] {
    width: 30px;
    height: 24px;
    padding: 0;
    border-radius: calc(6px * var(--round, 1));
    background: transparent;
    cursor: pointer;
  }

  /* An automatic colour is not black, whatever the picker has to show. */
  input[type='color'].cleared {
    opacity: 0.35;
  }

  .hex {
    width: 96px;
    font-family: var(--mono-font);
  }

  .clear {
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 15px;
    line-height: 1;
    color: var(--panel-fg-muted);
    border-radius: calc(6px * var(--round, 1));
    cursor: pointer;
  }

  .clear:hover:not(:disabled) {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .clear:disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
