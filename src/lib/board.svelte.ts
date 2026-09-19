import { newId } from './ids';
import { SyncedFile, type SyncedItem } from './synced.svelte';
import type { UnSubscriber } from './seelen';

/**
 * A kanban board: columns of cards, shared by every display.
 *
 * Order is a number per item rather than a position in an array. Moving a card
 * gives it the midpoint of its new neighbours, which is a change to *that card
 * alone* - so a card moved on one display and a different card moved on the
 * other merge cleanly, where rewriting an array's order would have made one of
 * the two moves vanish.
 */

export interface BoardColumn extends SyncedItem {
  title: string;
  order: number;
}

export interface BoardCard extends SyncedItem {
  columnId: string;
  title: string;
  note: string;
  /** A key into `CARD_LABELS`, or null. */
  label: string | null;
  /** `YYYY-MM-DD`, or null. */
  due: string | null;
  order: number;
  createdAt: number;
}

export const CARD_LABELS: Readonly<Record<string, string>> = {
  red: '#e5635b',
  orange: '#e8893d',
  yellow: '#d9b93a',
  green: '#4fbf7a',
  blue: '#5b9cf5',
  purple: '#a37cf0',
};

type BoardCollections = { columns: BoardColumn[]; cards: BoardCard[] };

/**
 * A new board's columns. Fixed ids and an ancient timestamp, so two displays
 * that both find no file and both create one merge into one set of columns,
 * and any edit made to them wins.
 */
function firstRun(): BoardCollections {
  return {
    columns: [
      { id: 'column-todo', title: 'To do', order: 1, updatedAt: 1 },
      { id: 'column-doing', title: 'Doing', order: 2, updatedAt: 1 },
      { id: 'column-done', title: 'Done', order: 3, updatedAt: 1 },
    ],
    cards: [],
  };
}

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

class BoardStore {
  file = new SyncedFile<BoardCollections>('board.json', () => ({ columns: [], cards: [] }), firstRun);

  acquire(): UnSubscriber {
    return this.file.acquire();
  }

  get columns(): BoardColumn[] {
    return this.file.data.columns.slice().sort(byOrder);
  }

  cardsIn(columnId: string): BoardCard[] {
    return this.file.data.cards.filter((card) => card.columnId === columnId).sort(byOrder);
  }

  // --- columns ----------------------------------------------------------------

  addColumn(title: string): void {
    const order = Math.max(0, ...this.file.data.columns.map((c) => c.order)) + 1;
    this.file.put('columns', { id: newId('column'), title: title.trim() || 'Untitled', order, updatedAt: 0 });
  }

  renameColumn(id: string, title: string): void {
    const trimmed = title.trim();
    if (trimmed) this.file.update('columns', id, { title: trimmed });
  }

  /** Swaps a column with its neighbour on one side. */
  moveColumn(id: string, direction: -1 | 1): void {
    const columns = this.columns;
    const at = columns.findIndex((c) => c.id === id);
    const other = columns[at + direction];
    const self = columns[at];
    if (!self || !other) return;
    this.file.update('columns', self.id, { order: other.order });
    this.file.update('columns', other.id, { order: self.order });
  }

  removeColumn(id: string): void {
    const cards = this.cardsIn(id).map((card) => card.id);
    if (cards.length) this.file.remove('cards', ...cards);
    this.file.remove('columns', id);
  }

  clearColumn(id: string): void {
    const cards = this.cardsIn(id).map((card) => card.id);
    if (cards.length) this.file.remove('cards', ...cards);
  }

  // --- cards ------------------------------------------------------------------

  addCard(columnId: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const order = Math.max(0, ...this.cardsIn(columnId).map((c) => c.order)) + 1;
    const now = Date.now();
    this.file.put('cards', {
      id: newId('card'),
      columnId,
      title: trimmed,
      note: '',
      label: null,
      due: null,
      order,
      createdAt: now,
      updatedAt: now,
    });
  }

  updateCard(id: string, patch: Partial<Omit<BoardCard, 'id'>>): void {
    this.file.update('cards', id, patch);
  }

  removeCard(id: string): void {
    this.file.remove('cards', id);
  }

  /** Puts a card into a column, before `beforeId`, or at the end when null. */
  moveCard(id: string, columnId: string, beforeId: string | null): void {
    if (id === beforeId) return;
    const list = this.cardsIn(columnId).filter((card) => card.id !== id);
    const index = beforeId ? list.findIndex((card) => card.id === beforeId) : -1;
    const at = index === -1 ? list.length : index;
    const prev = list[at - 1]?.order;
    const next = list[at]?.order;

    let order: number;
    if (prev === undefined && next === undefined) order = 1;
    else if (prev === undefined) order = (next as number) - 1;
    else if (next === undefined) order = prev + 1;
    else order = (prev + next) / 2;

    // Midpoints halve the gap each time; after a few dozen moves into the same
    // slot, spread the column out again before floating point runs out.
    if (prev !== undefined && next !== undefined && next - prev < 1e-6) {
      list.forEach((card, i) => this.file.update('cards', card.id, { order: i < at ? i + 1 : i + 2 }));
      order = at + 1;
    }

    this.file.update('cards', id, { columnId, order });
  }
}

export const board = new BoardStore();
