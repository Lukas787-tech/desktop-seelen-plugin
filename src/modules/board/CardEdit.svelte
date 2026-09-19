<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '../Modal.svelte';
  import { CARD_LABELS, board } from '$lib/board.svelte';

  type Props = {
    cardId: string;
    onclose: () => void;
  };

  let { cardId, onclose }: Props = $props();

  // Taken once: an edit arriving from the other display must not rewrite the
  // fields under the cursor.
  const card = untrack(() => board.file.data.cards.find((c) => c.id === cardId) ?? null);

  let title = $state(card?.title ?? '');
  let note = $state(card?.note ?? '');
  let label = $state<string | null>(card?.label ?? null);
  let due = $state(card?.due ?? '');
  let columnId = $state(card?.columnId ?? '');

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (!card) return onclose();
    const trimmed = title.trim();
    if (!trimmed) return;
    board.updateCard(card.id, { title: trimmed, note: note.trim(), label, due: due || null });
    if (columnId && columnId !== card.columnId) board.moveCard(card.id, columnId, null);
    onclose();
  }

  function remove() {
    if (card) board.removeCard(card.id);
    onclose();
  }
</script>

<Modal title="Card" {onclose} width={380}>
  {#if !card}
    <p>This card was removed on another display.</p>
  {:else}
    <form class="form" onsubmit={save}>
      <input class="title" bind:value={title} aria-label="Title" />
      <textarea bind:value={note} rows="5" placeholder="Notes" aria-label="Notes"></textarea>

      <div class="row">
        <label class="field">
          <span>Column</span>
          <select bind:value={columnId}>
            {#each board.columns as column (column.id)}
              <option value={column.id}>{column.title}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Due</span>
          <input type="date" bind:value={due} />
        </label>
      </div>

      <div class="labels" role="radiogroup" aria-label="Label">
        <button type="button" class="swatch none" class:on={label === null} role="radio" aria-checked={label === null} aria-label="No label" onclick={() => (label = null)}>
          &times;
        </button>
        {#each Object.entries(CARD_LABELS) as [name, value] (name)}
          <button
            type="button"
            class="swatch"
            class:on={label === name}
            role="radio"
            aria-checked={label === name}
            aria-label={name}
            style:background={value}
            onclick={() => (label = name)}
          ></button>
        {/each}
      </div>

      <div class="buttons">
        <button type="button" class="danger" onclick={remove}>Delete</button>
        <span class="spacer"></span>
        <button type="button" onclick={onclose}>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>
  {/if}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  input,
  select,
  textarea {
    padding: 6px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  .title {
    font-size: calc(14px * var(--text-scale, 1));
  }

  textarea {
    resize: vertical;
    line-height: 1.45;
  }

  .row {
    display: flex;
    gap: 10px;
  }

  .field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .field span {
    font-size: calc(10px * var(--text-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--panel-fg-muted);
  }

  .labels {
    display: flex;
    gap: 6px;
  }

  .swatch {
    width: 22px;
    height: 22px;
    border-radius: calc(6px * var(--round, 1));
    cursor: pointer;
    outline: 2px solid transparent;
    outline-offset: 2px;
  }

  .swatch.none {
    display: grid;
    place-items: center;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .swatch.on {
    outline-color: var(--panel-fg);
  }

  .buttons {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .spacer {
    flex: 1;
  }

  .buttons button {
    padding: 6px 12px;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    cursor: pointer;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .buttons button:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 38%, transparent);
  }

  .buttons .primary {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent);
  }

  .buttons .danger {
    color: var(--color-red-700, #f77);
  }
</style>
