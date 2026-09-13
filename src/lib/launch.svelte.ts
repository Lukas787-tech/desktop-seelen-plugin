import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import type { StartMenuItem } from '@seelen-ui/lib/types';
import type { IconKind } from './store.svelte';

/** Opens an icon's target. */
export async function launch(target: string, kind: IconKind): Promise<void> {
  try {
    if (kind === 'app' && !target.toLowerCase().endsWith('.lnk')) {
      await invoke(SeelenCommand.Run, {
        program: target,
        args: null,
        workingDir: null,
        elevated: false,
      });
      return;
    }
    // Shortcuts, documents, folders and URLs all go through the shell, which
    // resolves them the same way Explorer would.
    await invoke(SeelenCommand.OpenFile, { path: target });
  } catch (err) {
    console.error(`[launch] could not open ${target}`, err);
  }
}

export async function revealInExplorer(target: string): Promise<void> {
  try {
    await invoke(SeelenCommand.SelectFileOnExplorer, { path: target });
  } catch (err) {
    console.error(`[launch] could not reveal ${target}`, err);
  }
}

/**
 * The installed-application catalogue, used to add icons and to back the
 * command palette. Sourced from the host's Start Menu index so it covers
 * classic and packaged apps alike.
 */
class AppCatalog {
  items = $state<StartMenuItem[]>([]);

  #users = 0;
  #off: UnSubscriber | null = null;

  /**
   * Loads the catalogue and keeps it live until every caller releases it.
   *
   * Reference-counted deliberately: the index is a few hundred entries and
   * every desktop replica would otherwise hold its own copy for a dialog that
   * is open only occasionally.
   */
  async acquire(): Promise<UnSubscriber> {
    this.#users++;
    if (this.#users === 1) {
      await this.#refresh();
      this.#off = await subscribe(SeelenEvent.StartMenuItemsChanged, () => {
        void this.#refresh();
      });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      this.#off?.();
      this.#off = null;
      this.items = [];
    };
  }

  /** Ranked substring search: prefix matches first, then alphabetical. */
  search(term: string, limit = 40): StartMenuItem[] {
    const needle = term.trim().toLowerCase();
    if (!needle) return this.items.slice(0, limit);

    const scored: Array<{ item: StartMenuItem; score: number }> = [];
    for (const item of this.items) {
      const name = item.display_name.toLowerCase();
      const at = name.indexOf(needle);
      if (at === -1) continue;
      scored.push({ item, score: at === 0 ? 0 : 1 });
    }
    scored.sort(
      (a, b) => a.score - b.score || a.item.display_name.localeCompare(b.item.display_name),
    );
    return scored.slice(0, limit).map((s) => s.item);
  }

  async #refresh(): Promise<void> {
    try {
      const items = await invoke(SeelenCommand.GetStartMenuItems);
      // The index can list the same path more than once (a shortcut present in
      // both the user and machine Start Menu, for one). Duplicates would then
      // collide as keyed-each keys and tear the list down at runtime.
      const seen = new Set<string>();
      this.items = items
        .filter((i) => i.display_name && !seen.has(i.path) && (seen.add(i.path), true))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
    } catch (err) {
      console.error('[apps] could not read the start menu index', err);
    }
  }
}

export const apps = new AppCatalog();
