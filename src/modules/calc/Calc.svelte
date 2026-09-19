<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { evaluate, formatResult } from '$lib/calc';
  import { calcHistory, type CalcEntry } from '$lib/calc-history.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { menuSeparator } from '$lib/menu';

  const cfg = $derived(config.current);

  $effect(() => calcHistory.acquire());

  let input = $state('');
  let field = $state<HTMLInputElement | null>(null);
  /** Where the keypad inserts, remembered because pressing a key blurs the field. */
  let caret = $state<number | null>(null);
  /** Set when Enter was pressed on something that does not evaluate. */
  let shownError = $state<string | null>(null);
  /** Up and down walk back through the tape, as a shell does. */
  let recall = -1;

  const format = $derived({ precision: cfg.calcPrecision, grouping: cfg.calcGrouping });
  const options = $derived({ angle: cfg.calcAngle, variables: calcHistory.state.variables });

  /** Evaluated as it is typed, so the answer is there before Enter. */
  const live = $derived(evaluate(input, options));
  const preview = $derived(live.ok ? formatResult(live, format) : '');

  const last = $derived(calcHistory.state.history[0] ?? null);

  function commit() {
    const text = input.trim();
    if (!text) return;
    const result = evaluate(text, options);
    if (!result.ok) {
      shownError = result.error || 'That does not add up.';
      return;
    }
    calcHistory.record(text, formatResult(result, format), result.value, result.assigned);
    input = '';
    caret = null;
    shownError = null;
    recall = -1;
  }

  function onKey(event: KeyboardEvent) {
    const history = calcHistory.state.history;
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input = '';
      shownError = null;
      recall = -1;
    } else if (event.key === 'ArrowUp' && history.length) {
      event.preventDefault();
      recall = Math.min(history.length - 1, recall + 1);
      input = history[recall]?.expression ?? input;
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      recall = Math.max(-1, recall - 1);
      input = recall === -1 ? '' : (history[recall]?.expression ?? '');
    }
  }

  function remember() {
    caret = field?.selectionStart ?? null;
  }

  /**
   * Types into the field from the keypad.
   *
   * Starting a line with an operator continues from the last answer, the way a
   * desk calculator does: press `×` after a result and it multiplies that.
   */
  function press(text: string) {
    shownError = null;
    let current = input;
    let at = caret ?? current.length;
    if (!current && /^[+\-*/×÷^%]/.test(text) && last) {
      current = 'ans';
      at = current.length;
    }
    input = current.slice(0, at) + text + current.slice(at);
    caret = at + text.length;
  }

  function backspace() {
    const at = caret ?? input.length;
    if (at <= 0) return;
    input = input.slice(0, at - 1) + input.slice(at);
    caret = at - 1;
  }

  function clearAll() {
    input = '';
    caret = null;
    shownError = null;
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the clipboard is a courtesy here */
    }
  }

  function entryMenu(event: MouseEvent, entry: CalcEntry) {
    overlay.openMenu(event, [
      { label: 'Use the answer', action: () => press(entry.result.replace(/,/g, '').replace(/\s.*$/, '')) },
      { label: 'Edit the sum', action: () => ((input = entry.expression), (caret = null)) },
      { label: 'Copy the answer', action: () => void copy(entry.result) },
      menuSeparator,
      { label: 'Remove', action: () => calcHistory.remove(entry.id) },
      { label: 'Clear the tape', danger: true, action: () => calcHistory.clear() },
    ]);
  }

  const KEYS: readonly (readonly [label: string, insert: string, kind?: 'op' | 'fn' | 'eq' | 'wide'])[] = [
    ['(', '('],
    [')', ')'],
    ['%', '%', 'op'],
    ['÷', '/', 'op'],
    ['7', '7'],
    ['8', '8'],
    ['9', '9'],
    ['×', '*', 'op'],
    ['4', '4'],
    ['5', '5'],
    ['6', '6'],
    ['−', '-', 'op'],
    ['1', '1'],
    ['2', '2'],
    ['3', '3'],
    ['+', '+', 'op'],
    ['0', '0'],
    ['.', '.'],
    ['^', '^', 'op'],
    ['=', '', 'eq'],
  ];

  const FUNCTIONS = ['√', 'sin', 'cos', 'tan', 'log', 'ln', 'π', 'ans'] as const;

  function fn(name: (typeof FUNCTIONS)[number]) {
    if (name === '√') press('sqrt(');
    else if (name === 'π') press('pi');
    else if (name === 'ans') press('ans');
    else press(`${name}(`);
  }
</script>

<div class="m-body calc" data-no-drag>
  <div class="display">
    <div class="tape-top">
      <button
        class="m-chip"
        title="Angles in {cfg.calcAngle === 'deg' ? 'degrees' : 'radians'}"
        onclick={() => config.set('calcAngle', cfg.calcAngle === 'deg' ? 'rad' : 'deg')}
      >
        {cfg.calcAngle === 'deg' ? 'DEG' : 'RAD'}
      </button>
      {#if last && !input}
        <span class="m-sub expression" title={last.expression}>{last.expression} =</span>
      {/if}
    </div>
    <input
      bind:this={field}
      bind:value={input}
      class="entry"
      placeholder={last ? 'Type a sum, or press an operator to use the answer' : '12*(3+4), 5 km to mi, 255 to hex'}
      aria-label="Calculation"
      spellcheck="false"
      autocomplete="off"
      onkeydown={onKey}
      onkeyup={remember}
      onclick={remember}
      onselect={remember}
      oninput={() => ((shownError = null), (caret = null))}
    />
    <div class="answer" class:error={!!shownError} aria-live="polite">
      {#if shownError}
        {shownError}
      {:else if preview}
        = {preview}
      {:else if !input && last}
        <span class="m-stat big">{last.result}</span>
      {:else}
        &nbsp;
      {/if}
    </div>
  </div>

  {#if cfg.calcShowKeypad}
    <div class="functions">
      {#each FUNCTIONS as name (name)}
        <button class="key fn" onclick={() => fn(name)}>{name}</button>
      {/each}
    </div>
    <div class="keypad">
      <button class="key op" onclick={clearAll} title="Clear">AC</button>
      <button class="key op" onclick={backspace} title="Delete">&#9003;</button>
      {#each KEYS as [label, insert, kind] (label)}
        {#if kind === 'eq'}
          <button class="key eq" onclick={commit}>{label}</button>
        {:else}
          <button class="key" class:op={kind === 'op'} onclick={() => press(insert)}>{label}</button>
        {/if}
      {/each}
    </div>
  {/if}

  <ul class="m-list tape" aria-label="Previous calculations">
    {#each calcHistory.state.history as entry (entry.id)}
      <li class="m-lazy">
        <button
          class="m-row m-click line"
          title="Click to use the answer; right-click for more"
          onclick={() => press(entry.result.replace(/,/g, '').replace(/\s.*$/, ''))}
          oncontextmenu={(e) => entryMenu(e, entry)}
        >
          <span class="m-text"><span class="m-sub">{entry.expression}</span></span>
          <span class="m-value">{entry.result}</span>
        </button>
      </li>
    {:else}
      {#if !cfg.calcShowKeypad}
        <li class="m-empty">Units convert too: <code>3 ft to cm</code>, <code>100 f in c</code>, <code>2 GiB to MB</code>.</li>
      {/if}
    {/each}
  </ul>
</div>

<style>
  .display {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 40%, transparent);
  }

  .tape-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 18px;
  }

  .m-chip {
    font-size: calc(9px * var(--text-scale, 1));
    letter-spacing: 0.06em;
  }

  .expression {
    margin-left: auto;
    min-width: 0;
  }

  .m-body input.entry {
    width: 100%;
    padding: 2px 0;
    font-family: var(--display-font);
    font-size: calc(var(--ui-size) * 1.3);
    font-variant-numeric: tabular-nums;
    text-align: right;
    background: transparent;
    border-radius: 0;
  }

  .answer {
    min-height: 1.4em;
    text-align: right;
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .answer .big {
    font-size: calc(var(--ui-size) * 1.5);
    color: var(--panel-fg);
  }

  .answer.error {
    color: var(--color-red-700, #f77);
    white-space: normal;
  }

  .functions {
    flex: none;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
  }

  .keypad {
    flex: none;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }

  .keypad > :nth-child(1),
  .keypad > :nth-child(2) {
    grid-column: span 2;
  }

  .key {
    padding: calc(6px * var(--density)) 0;
    font: inherit;
    font-size: calc(13px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
    border: 0;
    border-radius: calc(8px * var(--round, 1));
    cursor: pointer;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      box-shadow var(--dur) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .key:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 32%, transparent);
  }

  /* A key goes down under the finger and springs back up, like a real one. */
  .key:active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 44%, transparent);
    scale: 0.92;
    transition-duration: var(--dur-fast);
  }

  .key.fn {
    padding: calc(3px * var(--density)) 0;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    background: transparent;
  }

  .key.fn:hover {
    color: var(--panel-fg);
  }

  .key.op {
    color: var(--accent, #7aa2f7);
  }

  .key.eq {
    color: #fff;
    background: color-mix(in oklab, var(--accent, #7aa2f7) 70%, transparent);
  }

  .key.eq:hover {
    background: var(--accent, #7aa2f7);
  }

  /* At least two lines of tape, however tall the keypad makes the rest. */
  .tape {
    margin-top: 2px;
    min-height: 48px;
  }

  .line .m-value {
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  code {
    font-size: calc(10px * var(--text-scale, 1));
  }
</style>
