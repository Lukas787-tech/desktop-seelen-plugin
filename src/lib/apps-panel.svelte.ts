import { apps, launch } from './launch.svelte';
import { SyncedFile, type SyncedItem } from './synced.svelte';
import type { StartMenuItem } from '@seelen-ui/lib/types';
import type { UnSubscriber } from './seelen';

/**
 * The Apps module's own memory - favourites and what was opened recently -
 * over the installed-application catalogue `launch.svelte.ts` already keeps.
 *
 * The catalogue is reference-counted there and only held while something shows
 * it; this panel is one more holder, for exactly as long as it is on screen.
 */

export interface KnownApp {
  path: string;
  name: string;
  umid: string | null;
  target: string | null;
}

export interface FavouriteApp extends SyncedItem, KnownApp {
  order: number;
}

export interface RecentApp extends SyncedItem, KnownApp {
  launches: number;
  lastLaunched: number;
}

type AppsCollections = { favourites: FavouriteApp[]; recents: RecentApp[] };

/** One id per shortcut, whichever display recorded it. */
const idOf = (path: string) => `app:${path.toLowerCase()}`;

const RECENTS_KEPT = 30;

export function knownFrom(item: StartMenuItem): KnownApp {
  return { path: item.path, name: item.display_name, umid: item.umid, target: item.target };
}

class AppsPanel {
  file = new SyncedFile<AppsCollections>('apps.json', () => ({ favourites: [], recents: [] }));

  #users = 0;
  #releases: UnSubscriber[] = [];

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) {
      this.#releases.push(this.file.acquire());
      const catalogue = apps.acquire();
      this.#releases.push(() => void catalogue.then((release) => release()));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users === 0) for (const release of this.#releases.splice(0)) release();
    };
  }

  get favourites(): FavouriteApp[] {
    return this.file.data.favourites.slice().sort((a, b) => a.order - b.order);
  }

  recents(limit: number): RecentApp[] {
    return this.file.data.recents
      .slice()
      .sort((a, b) => b.lastLaunched - a.lastLaunched)
      .slice(0, limit);
  }

  isFavourite(path: string): boolean {
    const id = idOf(path);
    return this.file.data.favourites.some((f) => f.id === id);
  }

  toggleFavourite(app: KnownApp): void {
    const id = idOf(app.path);
    if (this.isFavourite(app.path)) {
      this.file.remove('favourites', id);
      return;
    }
    const order = Math.max(0, ...this.file.data.favourites.map((f) => f.order)) + 1;
    this.file.put('favourites', { ...app, id, order, updatedAt: Date.now() });
  }

  moveFavourite(path: string, direction: -1 | 1): void {
    const list = this.favourites;
    const at = list.findIndex((f) => f.id === idOf(path));
    const self = list[at];
    const other = list[at + direction];
    if (!self || !other) return;
    this.file.update('favourites', self.id, { order: other.order });
    this.file.update('favourites', other.id, { order: self.order });
  }

  open(app: KnownApp): void {
    // Exactly what the palette does with a Start Menu entry: the shortcut goes
    // through the shell, which resolves packaged apps as well as classic ones.
    void launch(app.path, 'app');

    const id = idOf(app.path);
    const now = Date.now();
    const seen = this.file.data.recents.find((r) => r.id === id);
    if (seen) {
      this.file.update('recents', id, { launches: seen.launches + 1, lastLaunched: now });
    } else {
      this.file.put('recents', { ...app, id, launches: 1, lastLaunched: now, updatedAt: now });
    }
    const stale = this.recents(RECENTS_KEPT + 20).slice(RECENTS_KEPT).map((r) => r.id);
    if (stale.length) this.file.remove('recents', ...stale);
  }

  forget(path: string): void {
    this.file.remove('recents', idOf(path));
  }

  clearRecents(): void {
    const ids = this.file.data.recents.map((r) => r.id);
    if (ids.length) this.file.remove('recents', ...ids);
  }
}

export const appsPanel = new AppsPanel();
