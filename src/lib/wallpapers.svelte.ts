import { WallpaperList } from '@seelen-ui/lib';
import type { Wallpaper } from '@seelen-ui/lib/types';
import { SeelenEvent, subscribe, type UnSubscriber } from './seelen';
import { fileUrl, isVideoFile, joinPath } from './assets';

/** A wallpaper from Seelen's library, resolved to URLs this webview can load. */
export interface WallpaperEntry {
  id: string;
  name: string;
  kind: Wallpaper['type'];
  /** Local file URL for the wallpaper itself, or null if it has no local copy. */
  url: string | null;
  /** Local file URL for the preview image. */
  thumbnailUrl: string | null;
  isVideo: boolean;
}

function displayName(w: Wallpaper): string {
  const raw = (w.metadata as { displayName?: unknown }).displayName;
  if (typeof raw === 'string' && raw) return raw;
  // Localised resource text arrives as a language map.
  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, string>;
    return map['en'] ?? Object.values(map)[0] ?? w.id;
  }
  return w.id;
}

function toEntry(w: Wallpaper): WallpaperEntry {
  const dir = (w.metadata as { path?: string }).path ?? '';
  const localFile = dir && w.filename ? joinPath(dir, w.filename) : null;
  const localThumb = dir && w.thumbnailFilename ? joinPath(dir, w.thumbnailFilename) : null;
  return {
    id: w.id,
    name: displayName(w),
    kind: w.type,
    // Prefer the downloaded local copy; `url` points at Seelen's CDN, which we
    // should not re-fetch on every surface load.
    url: fileUrl(localFile) ?? w.url,
    thumbnailUrl: fileUrl(localThumb) ?? w.thumbnailUrl,
    isVideo: w.type === 'Video' || (!!localFile && isVideoFile(localFile)),
  };
}

/**
 * The user's Seelen wallpaper library, reused as this surface's wallpaper
 * source. Building a separate library would mean re-importing files the user
 * has already added to Seelen.
 */
class WallpaperStore {
  entries = $state<WallpaperEntry[]>([]);

  async start(): Promise<UnSubscriber> {
    await this.#refresh();
    return subscribe(SeelenEvent.StateWallpapersChanged, () => {
      void this.#refresh();
    });
  }

  byId(id: string | null | undefined): WallpaperEntry | null {
    if (!id) return null;
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async #refresh(): Promise<void> {
    try {
      const list = await WallpaperList.getAsync();
      this.entries = list
        .all()
        .filter((w) => w.type !== 'Unsupported')
        .map(toEntry);
    } catch (err) {
      console.error('[wallpapers] could not read the library', err);
    }
  }
}

export const wallpapers = new WallpaperStore();
