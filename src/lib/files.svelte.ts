import { noteError } from './diagnostics';
import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import { FolderType } from '@seelen-ui/lib/types';

/** The known folders the host will list, in the order the picker offers them. */
export const FOLDERS: readonly { label: string; value: FolderType }[] = [
  { label: 'Recent', value: FolderType.Recent },
  { label: 'Downloads', value: FolderType.Downloads },
  { label: 'Documents', value: FolderType.Documents },
  { label: 'Pictures', value: FolderType.Pictures },
  { label: 'Music', value: FolderType.Music },
  { label: 'Videos', value: FolderType.Videos },
  { label: 'Desktop', value: FolderType.Desktop },
];

export function folderTypeFrom(value: string): FolderType {
  return FOLDERS.find((f) => f.value === value)?.value ?? FolderType.Recent;
}

/**
 * The contents of one known folder, kept live by the host's folder watcher.
 *
 * Two things about this command shape the code around it:
 *
 * - **It recurses.** `Desktop` came back with 2595 entries on this machine
 *   because a `node_modules` tree lives there, so the list is always filtered
 *   and capped before it reaches a panel.
 * - **It returns paths and nothing else** - no size, no timestamp - so there
 *   is no way to sort by "most recent". Entries are shown in name order, which
 *   is at least stable; `Recent` is a folder of shortcuts Windows maintains,
 *   not an ordered MRU list.
 */
class FolderContents {
  paths = $state<string[]>([]);
  loading = $state(false);

  #generation = 0;
  #off: UnSubscriber | null = null;

  /**
   * Watches one folder until the returned function is called.
   *
   * Written for `$effect`, which re-runs when the chosen folder changes: the
   * cleanup releases the previous folder before the next one starts.
   */
  watch(folder: FolderType): UnSubscriber {
    const mine = ++this.#generation;
    this.loading = true;
    this.paths = [];

    void (async () => {
      try {
        const content = await invoke(SeelenCommand.GetUserFolderContent, { folderType: folder });
        if (mine === this.#generation) this.paths = content;
      } catch (err) {
        console.error('[files] could not read folder', err);
        noteError(`files: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (mine === this.#generation) this.loading = false;
      }

      try {
        const off = await subscribe(SeelenEvent.UserFolderChanged, (e) => {
          // One event carries whichever folder changed; ignore the others.
          if (mine !== this.#generation || e.payload.ofFolder !== folder) return;
          this.paths = e.payload.content;
        });
        if (mine === this.#generation) this.#off = off;
        else off();
      } catch (err) {
        console.error('[files] could not watch folder', err);
      }
    })();

    return () => {
      if (mine !== this.#generation) return;
      this.#generation++;
      this.#off?.();
      this.#off = null;
      this.paths = [];
      this.loading = false;
    };
  }
}

export const folderContents = new FolderContents();

export const SEP = String.fromCharCode(92); // backslash

/**
 * The folder the host walked, worked out from what the walk returned.
 *
 * The command answers with paths and nothing else - it never says which folder
 * it read, and the folder is not derivable from its `FolderType` either, since
 * Documents, Pictures and Desktop are all commonly redirected into OneDrive.
 * What it does return is at least one entry at the top level, so the shortest
 * path's parent is the root. That holds whether or not the walk lists
 * directories of its own: with them, the shallowest entry is a top-level
 * folder; without them, it is a top-level file.
 *
 * The result is checked against every path before it is used, and anything
 * unexpected falls back to the deepest prefix they all share.
 */
export function commonRoot(paths: readonly string[]): string {
  if (!paths.length) return '';

  let shortest = paths[0] as string;
  let fewest = segmentsOf(shortest).length;
  for (const path of paths) {
    const depth = segmentsOf(path).length;
    if (depth < fewest) {
      fewest = depth;
      shortest = path;
    }
  }

  const root = parentOf(shortest);
  const base = `${root}${SEP}`.toLowerCase();
  if (paths.every((path) => path.toLowerCase().startsWith(base))) return root;

  // Every path under one subfolder, or a walk that spans more than one tree:
  // fall back to what they literally have in common.
  const parts = segmentsOf(shortest);
  let shared = parts.length;
  for (const path of paths) {
    const other = segmentsOf(path);
    let i = 0;
    while (i < shared && i < other.length && (parts[i] ?? '').toLowerCase() === (other[i] ?? '').toLowerCase()) {
      i++;
    }
    shared = i;
  }
  return parts.slice(0, shared).join(SEP);
}

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

export function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf(SEP), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : path;
}

/** Names that are Windows' own bookkeeping rather than the user's files. */
const NOISE = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

export interface FileEntry {
  path: string;
  name: string;
  directory: boolean;
  /** Lower-case extension without the dot; empty for a folder. */
  ext: string;
  /** For a folder, how many entries sit directly inside it. */
  count: number;
}

export interface DirectoryListing {
  entries: FileEntry[];
  folders: number;
  files: number;
  /** How many entries there were before `limit` cut the list. */
  total: number;
}

export type FileSort = 'name' | 'type';

/**
 * One level of the tree the recursive walk implies.
 *
 * `get_user_folder_content` returns the whole subtree flat, which reads as a
 * dead end - hundreds of unordered paths, 2595 of them for Desktop on this
 * machine - but it is exactly enough to reconstruct the folders: a path with
 * something under it *is* a directory, and its direct children are the distinct
 * first segments below it. So the panel can be browsed like a file manager
 * without the host ever exposing a directory listing.
 */
export function listDirectory(
  paths: readonly string[],
  prefix: string,
  options: { limit: number; sort: FileSort; filter?: string },
): DirectoryListing {
  const base = prefix.endsWith(SEP) ? prefix : `${prefix}${SEP}`;
  const lowered = base.toLowerCase();

  const folders = new Map<string, { name: string; children: Set<string> }>();
  const leaves = new Map<string, string>();

  for (const path of paths) {
    if (!path.toLowerCase().startsWith(lowered)) continue;
    const rest = path.slice(base.length);
    if (!rest) continue;

    const cut = rest.search(/[\\/]/);
    if (cut === -1) {
      leaves.set(rest.toLowerCase(), rest);
      continue;
    }

    const name = rest.slice(0, cut);
    const folder = folders.get(name.toLowerCase()) ?? { name, children: new Set<string>() };
    // Distinct first segments below this folder, so the count is its direct
    // children whether or not the walk lists directories in their own right.
    const below = rest.slice(cut + 1);
    const next = below.search(/[\\/]/);
    folder.children.add((next === -1 ? below : below.slice(0, next)).toLowerCase());
    folders.set(name.toLowerCase(), folder);
  }

  const entries: FileEntry[] = [];

  for (const [key, folder] of folders) {
    if (NOISE.has(key)) continue;
    entries.push({
      path: `${base}${folder.name}`,
      name: folder.name,
      directory: true,
      ext: '',
      count: folder.children.size,
    });
  }

  for (const [key, name] of leaves) {
    // A leaf that is also a folder was already listed, with its contents.
    if (folders.has(key) || NOISE.has(key)) continue;
    const match = /\.([a-z0-9]{1,8})$/i.exec(name);
    entries.push({
      path: `${base}${name}`,
      name,
      // No extension and nothing inside: an empty folder, as far as this can
      // be told from a list of paths.
      directory: !match,
      ext: match?.[1]?.toLowerCase() ?? '',
      count: 0,
    });
  }

  const needle = options.filter?.trim().toLowerCase();
  const visible = needle
    ? entries.filter((entry) => displayName(entry.path).toLowerCase().includes(needle))
    : entries;

  visible.sort((a, b) => {
    // Folders first, as every file manager does.
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    if (options.sort === 'type' && a.ext !== b.ext) return a.ext.localeCompare(b.ext);
    return displayName(a.path).localeCompare(displayName(b.path));
  });

  return {
    entries: visible.slice(0, options.limit),
    folders: visible.filter((entry) => entry.directory).length,
    files: visible.filter((entry) => !entry.directory).length,
    total: visible.length,
  };
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** What to call the file: shortcuts are shown by what they point at. */
export function displayName(path: string): string {
  return fileName(path).replace(/\.(lnk|url)$/i, '');
}
