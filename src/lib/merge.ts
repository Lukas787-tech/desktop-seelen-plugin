/**
 * How two copies of a synced file become one. Pure, so `npm test` runs it; the
 * reactive half is `synced.svelte.ts`, which explains why items are merged
 * rather than files.
 */

export interface SyncedItem {
  id: string;
  updatedAt: number;
}

export type Collections = Record<string, SyncedItem[]>;

export interface SyncedFileShape<C extends Collections> {
  version: 1;
  collections: C;
  /** Item id to the moment it was removed. */
  deleted: Record<string, number>;
}

/** Tombstones older than this are dropped; an edit that old has long merged. */
export const TOMBSTONE_MS = 60 * 86_400_000;

/**
 * Every item from both sides, the newer copy of each, minus anything removed
 * after its last edit.
 *
 * A removal only wins over an edit it came after: an item edited on one display
 * after the other display deleted it comes back, because the edit is the later
 * intention. An exact tie goes to `mine`, the replica doing the writing.
 */
export function mergeSynced<C extends Collections>(
  base: SyncedFileShape<C>,
  mine: SyncedFileShape<C>,
  now = Date.now(),
): SyncedFileShape<C> {
  const deleted: Record<string, number> = {};
  for (const source of [base.deleted, mine.deleted]) {
    for (const [id, at] of Object.entries(source)) {
      if (now - at < TOMBSTONE_MS) deleted[id] = Math.max(deleted[id] ?? 0, at);
    }
  }

  const collections = {} as Record<string, SyncedItem[]>;
  const keys = new Set([...Object.keys(base.collections), ...Object.keys(mine.collections)]);
  for (const key of keys) {
    const byId = new Map<string, SyncedItem>();
    for (const item of base.collections[key] ?? []) byId.set(item.id, item);

    // The writer's own order first, then whatever only the file had. Keeping
    // it stable is what lets an unchanged merge serialise identically, so the
    // replica that wrote it sees no difference and re-renders nothing.
    const order: string[] = [];
    for (const item of mine.collections[key] ?? []) {
      const seen = byId.get(item.id);
      if (!seen || item.updatedAt >= seen.updatedAt) byId.set(item.id, item);
      order.push(item.id);
    }
    const ours = new Set(order);
    for (const item of base.collections[key] ?? []) if (!ours.has(item.id)) order.push(item.id);

    collections[key] = order
      .map((id) => byId.get(id) as SyncedItem)
      .filter((item) => !((deleted[item.id] ?? -1) >= item.updatedAt));
  }
  return { version: 1, collections: collections as C, deleted };
}
