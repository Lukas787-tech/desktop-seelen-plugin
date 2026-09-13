import { IconPackManager } from '@seelen-ui/lib';
import type { UnSubscriber } from './seelen';
import { fileUrl } from './assets';

export interface IconQuery {
  path?: string | null;
  umid?: string | null;
}

/**
 * Icon lookup through Seelen's icon packs.
 *
 * `IconPackManager` already handles pack priority, light/dark variants and
 * converting pack-relative paths into loadable URLs, so this only adds the
 * theme choice, a cache-busting signal for Svelte, and on-demand extraction for
 * apps no pack covers yet.
 */
class IconStore {
  /** Bumped whenever packs change, so `$derived` lookups re-run. */
  revision = $state(0);

  #manager: IconPackManager | null = null;
  #prefersDark = true;
  #requested = new Set<string>();

  async start(): Promise<UnSubscriber> {
    this.#manager = await IconPackManager.create();

    const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    this.#prefersDark = query?.matches ?? true;
    query?.addEventListener('change', (e) => {
      this.#prefersDark = e.matches;
      this.revision++;
    });

    const off = await this.#manager.onChange(() => {
      this.revision++;
    });
    this.revision++;
    return off;
  }

  /**
   * Best icon URL for an app or file, or null when nothing is known yet.
   *
   * A miss also schedules a one-off extraction request: the host writes the
   * icon into its generated pack and emits a change, which bumps `revision` and
   * re-runs this lookup with a result.
   */
  resolve(query: IconQuery): string | null {
    void this.revision; // establish reactive dependency

    const manager = this.#manager;
    if (!manager) return null;

    const icon = manager.getIcon(query);
    const chosen = icon
      ? this.#prefersDark
        ? (icon.dark ?? icon.base ?? icon.light)
        : (icon.light ?? icon.base ?? icon.dark)
      : null;

    if (chosen) return chosen;

    this.#requestExtraction(query);
    const missing = manager.getMissingIcon();
    return missing?.base ?? missing?.dark ?? missing?.light ?? null;
  }

  /** Resolves a user-supplied image file, falling back to pack lookup. */
  resolveWithOverride(overridePath: string | null | undefined, query: IconQuery): string | null {
    return fileUrl(overridePath) ?? this.resolve(query);
  }

  #requestExtraction(query: IconQuery): void {
    const key = query.umid ?? query.path;
    // Ask once per target; the host caches the result on disk.
    if (!key || this.#requested.has(key)) return;
    this.#requested.add(key);
    void IconPackManager.requestIconExtraction(query).catch(() => {
      // Not every target has an extractable icon; the missing-icon fallback covers it.
    });
  }
}

export const icons = new IconStore();
