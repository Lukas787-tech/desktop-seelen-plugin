<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { menuSeparator } from '$lib/menu';
  import { addDays, dayDiff, dayLabel, toDateKey } from '$lib/agenda';
  import { CARD_LABELS, board, type BoardCard, type BoardColumn } from '$lib/board.svelte';
  import CardEdit from './CardEdit.svelte';

  const cfg = $derived(config.current);

  $effect(() => board.acquire());

  const today = toDateKey(new Date());

  // --- adding -------------------------------------------------------------------
  let drafts = $state<Record<string, string>>({});
  let addingColumn = $state(false);
  let columnDraft = $state('');
  let renaming = $state<string | null>(null);
  let renameDraft = $state('');

  function addCard(event: SubmitEvent, columnId: string) {
    event.preventDefault();
    board.addCard(columnId, drafts[columnId] ?? '');
    drafts[columnId] = '';
  }

  function addColumn(event: SubmitEvent) {
    event.preventDefault();
    if (columnDraft.trim()) board.addColumn(columnDraft);
    columnDraft = '';
    addingColumn = false;
  }

  function startRename(column: BoardColumn) {
    renaming = column.id;
    renameDraft = column.title;
  }

  function commitRename() {
    if (renaming) board.renameColumn(renaming, renameDraft);
    renaming = null;
  }

  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function columnMenu(event: MouseEvent, column: BoardColumn, index: number, count: number) {
    overlay.openMenu(event, [
      { label: column.title, header: true },
      { label: 'Rename', action: () => startRename(column) },
      { label: 'Move left', disabled: index === 0, action: () => board.moveColumn(column.id, -1) },
      { label: 'Move right', disabled: index === count - 1, action: () => board.moveColumn(column.id, 1) },
      menuSeparator,
      { label: 'Clear its cards', disabled: board.cardsIn(column.id).length === 0, action: () => board.clearColumn(column.id) },
      { label: 'Delete column', danger: true, action: () => board.removeColumn(column.id) },
    ]);
  }

  function cardMenu(event: MouseEvent, card: BoardCard) {
    event.stopPropagation();
    const columns = board.columns;
    overlay.openMenu(event, [
      { label: 'Edit...', action: () => edit(card.id) },
      {
        label: 'Move to',
        items: columns.map((column) => ({
          label: column.title,
          checked: column.id === card.columnId,
          action: () => board.moveCard(card.id, column.id, null),
        })),
      },
      {
        label: 'Label',
        items: [
          { label: 'None', checked: card.label === null, action: () => board.updateCard(card.id, { label: null }) },
          ...Object.keys(CARD_LABELS).map((name) => ({
            label: name[0]?.toUpperCase() + name.slice(1),
            checked: card.label === name,
            action: () => board.updateCard(card.id, { label: name }),
          })),
        ],
      },
      {
        label: 'Due',
        items: [
          { label: 'Today', action: () => board.updateCard(card.id, { due: today }) },
          { label: 'Tomorrow', action: () => board.updateCard(card.id, { due: addDays(today, 1) }) },
          { label: 'In a week', action: () => board.updateCard(card.id, { due: addDays(today, 7) }) },
          { label: 'No due date', disabled: !card.due, action: () => board.updateCard(card.id, { due: null }) },
        ],
      },
      menuSeparator,
      { label: 'Delete', danger: true, action: () => board.removeCard(card.id) },
    ]);
  }

  function edit(cardId: string) {
    overlay.openDialog(CardEdit, { cardId, onclose: () => overlay.closeDialog() });
  }

  function dueBadge(due: string): { text: string; tone: 'late' | 'soon' | 'later' } {
    const days = dayDiff(today, due);
    if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days} days late`, tone: 'late' };
    if (days <= 1) return { text: dayLabel(due, today), tone: 'soon' };
    return { text: dayLabel(due, today), tone: 'later' };
  }

  // --- dragging -----------------------------------------------------------------
  /*
   * Pointer events rather than HTML drag and drop. The panel is itself
   * draggable, a desktop-preset window cannot show the platform's drag image
   * reliably, and a pointer drag is the one that can draw its own card under
   * the pointer and a gap where it will land.
   */
  let root = $state<HTMLElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);

  interface Drag {
    card: BoardCard;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    x: number;
    y: number;
    active: boolean;
  }

  let drag = $state<Drag | null>(null);
  let target = $state<{ columnId: string; beforeId: string | null } | null>(null);
  let frame = 0;
  let pending: PointerEvent | null = null;

  function onCardDown(event: PointerEvent, card: BoardCard) {
    if (event.button !== 0 || !root) return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    drag = {
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      x: 0,
      y: 0,
      active: false,
    };
    element.setPointerCapture(event.pointerId);
  }

  function onCardMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    pending = event;
    if (!frame) frame = requestAnimationFrame(applyMove);
  }

  function applyMove() {
    frame = 0;
    const event = pending;
    if (!event || !drag || !root) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    const box = root.getBoundingClientRect();
    drag.active = true;
    drag.x = event.clientX - box.left - drag.offsetX;
    drag.y = event.clientY - box.top - drag.offsetY;

    // Scroll the columns while the card is held against either edge.
    if (scroller) {
      const edge = scroller.getBoundingClientRect();
      if (event.clientX < edge.left + 28) scroller.scrollLeft -= 14;
      else if (event.clientX > edge.right - 28) scroller.scrollLeft += 14;
    }

    const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const column = under?.closest<HTMLElement>('[data-column]');
    if (!column?.dataset.column) return;
    const cardElement = under?.closest<HTMLElement>('[data-card]');
    let beforeId: string | null = null;
    if (cardElement?.dataset.card && cardElement.dataset.card !== drag.card.id) {
      const rect = cardElement.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        beforeId = cardElement.dataset.card;
      } else {
        const cards = board.cardsIn(column.dataset.column).filter((c) => c.id !== drag?.card.id);
        const at = cards.findIndex((c) => c.id === cardElement.dataset.card);
        beforeId = cards[at + 1]?.id ?? null;
      }
    } else if (cardElement?.dataset.card === drag.card.id) {
      return;
    }
    target = { columnId: column.dataset.column, beforeId };
  }

  function onCardUp(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (frame) {
      cancelAnimationFrame(frame);
      applyMove();
    }
    const finished = drag;
    const drop = target;
    drag = null;
    target = null;
    if (!finished.active) {
      edit(finished.card.id);
      return;
    }
    if (drop) board.moveCard(finished.card.id, drop.columnId, drop.beforeId);
  }

  function onCardCancel() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    drag = null;
    target = null;
  }
</script>

<!-- Re-reads on the way in, for what the other display changed; not a control. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="m-body board"
  class:compact={cfg.boardCompact}
  class:dragging={drag?.active}
  data-no-drag
  bind:this={root}
  style:--column-width="{cfg.boardColumnWidth}px"
  onpointerenter={() => void board.file.refresh()}
>
  <div class="columns" bind:this={scroller}>
    {#each board.columns as column, index (column.id)}
      {@const cards = board.cardsIn(column.id)}
      <section class="column" data-column={column.id} aria-label={column.title}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <header class="head" oncontextmenu={(e) => columnMenu(e, column, index, board.columns.length)}>
          {#if renaming === column.id}
            <input
              class="rename"
              bind:value={renameDraft}
              use:autofocus
              aria-label="Column name"
              onkeydown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') renaming = null;
              }}
              onblur={commitRename}
            />
          {:else}
            <button class="title" ondblclick={() => startRename(column)} title="Double-click to rename">
              {column.title}
            </button>
            <span class="m-pill">{cards.length}</span>
            <button
              class="m-quiet more"
              aria-label="{column.title} options"
              onclick={(e) => columnMenu(e, column, index, board.columns.length)}
            >
              &#8943;
            </button>
          {/if}
        </header>

        <ol class="cards m-scroll">
          {#each cards as card (card.id)}
            {#if target?.columnId === column.id && target.beforeId === card.id}
              <li class="gap" aria-hidden="true"></li>
            {/if}
            <li
              class="card"
              class:lifted={drag?.active && drag.card.id === card.id}
              data-card={card.id}
              style:--label={card.label ? CARD_LABELS[card.label] : 'transparent'}
              onpointerdown={(e) => onCardDown(e, card)}
              onpointermove={onCardMove}
              onpointerup={onCardUp}
              onpointercancel={onCardCancel}
              oncontextmenu={(e) => cardMenu(e, card)}
            >
              <span class="card-title">{card.title}</span>
              {#if cfg.boardShowNotes && !cfg.boardCompact && card.note}
                <span class="m-sub note">{card.note.split('\n')[0]}</span>
              {/if}
              {#if cfg.boardShowDue && card.due}
                {@const badge = dueBadge(card.due)}
                <span class="due {badge.tone}">{badge.text}</span>
              {/if}
            </li>
          {/each}
          {#if target?.columnId === column.id && target.beforeId === null}
            <li class="gap" aria-hidden="true"></li>
          {/if}
        </ol>

        <form class="add" onsubmit={(e) => addCard(e, column.id)}>
          <input
            bind:value={drafts[column.id]}
            placeholder="+ Add a card"
            aria-label="Add a card to {column.title}"
          />
        </form>
      </section>
    {/each}

    <div class="new-column">
      {#if addingColumn}
        <form onsubmit={addColumn}>
          <input
            bind:value={columnDraft}
            use:autofocus
            placeholder="Column name"
            aria-label="New column"
            onblur={() => !columnDraft.trim() && (addingColumn = false)}
          />
        </form>
      {:else}
        <button class="m-btn" onclick={() => (addingColumn = true)}>+ Column</button>
      {/if}
    </div>
  </div>

  {#if drag?.active}
    <div
      class="card ghost"
      style:left="{drag.x}px"
      style:top="{drag.y}px"
      style:width="{drag.width}px"
      style:--label={drag.card.label ? CARD_LABELS[drag.card.label] : 'transparent'}
      aria-hidden="true"
    >
      <span class="card-title">{drag.card.title}</span>
    </div>
  {/if}
</div>

<style>
  .board {
    position: relative;
  }

  .board.dragging {
    cursor: grabbing;
  }

  .columns {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior: contain;
    padding-bottom: 2px;
  }

  .column {
    flex: none;
    width: var(--column-width);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    padding: 6px;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 12%, transparent);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .title {
    flex: 1;
    min-width: 0;
    padding: 0 2px;
    font: inherit;
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 600;
    text-align: left;
    color: var(--panel-fg);
    background: none;
    cursor: default;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head:hover .more {
    opacity: 1;
  }

  .rename {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: calc(7px * var(--density)) 8px calc(7px * var(--density)) 10px;
    border-radius: calc(8px * var(--round, 1));
    font-size: calc(12px * var(--text-scale, 1));
    cursor: grab;
    touch-action: none;
    background: color-mix(in oklab, var(--color-gray-100, #333) 55%, transparent);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
    /* Cards deal in down each column, and one dropped into a new column
       arrives there, because moving it re-creates it. */
    animation: fx-tile-in var(--dur-slow) var(--ease) backwards;
    animation-delay: calc(var(--lag, 0ms) + var(--nth, 0) * var(--step) * 0.6);
    transition:
      background-color var(--dur-fast) var(--ease),
      box-shadow var(--dur) var(--ease),
      translate var(--dur) var(--ease-move);
  }

  @supports (order: sibling-index()) {
    .card {
      --nth: min(sibling-index() - 1, 14);
    }
  }

  .card::before {
    content: '';
    position: absolute;
    left: 3px;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: calc(999px * var(--round, 1));
    background: var(--label);
    transition: top var(--dur) var(--ease-move), bottom var(--dur) var(--ease-move);
  }

  /* Hovered, a card rises off the column and its label stretches to its full height. */
  .card:hover {
    background: color-mix(in oklab, var(--color-gray-100, #333) 75%, transparent);
    translate: 0 -1px;
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.26);
  }

  .card:hover::before {
    top: 4px;
    bottom: 4px;
  }

  .compact .card {
    padding-top: calc(4px * var(--density));
    padding-bottom: calc(4px * var(--density));
    font-size: calc(11px * var(--text-scale, 1));
  }

  .card-title {
    overflow-wrap: anywhere;
    line-height: 1.3;
  }

  .note {
    white-space: nowrap;
  }

  .card.lifted {
    opacity: 0.3;
  }

  .ghost {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    rotate: 2deg;
    box-shadow: 0 10px 24px rgb(0 0 0 / 0.4);
    background: color-mix(in oklab, var(--color-gray-100, #333) 90%, transparent);
  }

  .gap {
    flex: none;
    height: 28px;
    border-radius: calc(8px * var(--round, 1));
    border: 1.5px dashed color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 10%, transparent);
  }

  .due {
    align-self: flex-start;
    padding: 0 6px;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .due.soon {
    color: var(--panel-fg);
    background: color-mix(in oklab, #e8a33d 35%, transparent);
  }

  .due.late {
    color: #fff;
    background: color-mix(in oklab, #e5635b 70%, transparent);
  }

  .add input {
    width: 100%;
    background: transparent;
  }

  .add input:focus {
    background: color-mix(in oklab, var(--color-gray-100, #333) 45%, transparent);
  }

  .new-column {
    flex: none;
    width: 120px;
    padding-top: 4px;
  }

  .new-column input {
    width: 100%;
  }
</style>
