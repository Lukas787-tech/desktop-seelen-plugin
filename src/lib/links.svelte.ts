import { newId } from './ids';
import { SyncedFile, type SyncedItem } from './synced.svelte';
import type { UnSubscriber } from './seelen';

/** The Links module's bookmarks, shared by every display. */

export interface LinkItem extends SyncedItem {
  title: string;
  url: string;
  order: number;
  createdAt: number;
}

type LinkCollections = { links: LinkItem[] };

/** A few to start from, with fixed ids so two displays seeding at once agree. */
function firstRun(): LinkCollections {
  return {
    links: [
      ['YouTube', 'https://www.youtube.com/'],
      ['GitHub', 'https://github.com/'],
      ['Wikipedia', 'https://en.wikipedia.org/'],
      ['Maps', 'https://www.google.com/maps'],
    ].map(([title, url], i) => ({
      id: `link-default-${i}`,
      title: title as string,
      url: url as string,
      order: i + 1,
      createdAt: 1,
      updatedAt: 1,
    })),
  };
}

class LinksStore {
  file = new SyncedFile<LinkCollections>('links.json', () => ({ links: [] }), firstRun);

  acquire(): UnSubscriber {
    return this.file.acquire();
  }

  get links(): LinkItem[] {
    return this.file.data.links.slice().sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  add(title: string, url: string): void {
    const now = Date.now();
    this.file.put('links', {
      id: newId('link'),
      title: title.trim(),
      url,
      order: Math.max(0, ...this.file.data.links.map((l) => l.order)) + 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  update(id: string, patch: Partial<Pick<LinkItem, 'title' | 'url'>>): void {
    this.file.update('links', id, patch);
  }

  move(id: string, direction: -1 | 1): void {
    const list = this.links;
    const at = list.findIndex((l) => l.id === id);
    const self = list[at];
    const other = list[at + direction];
    if (!self || !other) return;
    this.file.update('links', self.id, { order: other.order });
    this.file.update('links', other.id, { order: self.order });
  }

  remove(id: string): void {
    this.file.remove('links', id);
  }
}

export const links = new LinksStore();
