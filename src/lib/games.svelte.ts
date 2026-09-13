import { fileUrl } from './assets';
import {
  CLIENT_EXES,
  LAUNCHERS,
  baseName,
  detectFromFolder,
  detectFromStartMenu,
  detectFromWindows,
  mergeCandidates,
  type DetectedGame,
  type GameKind,
  type LauncherDefinition,
  type LauncherId,
} from './detect';
import { noteError } from './diagnostics';
import { newId } from './ids';
import { apps, launch } from './launch.svelte';
import { debouncedWriter, readJson } from './persist';
import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import { FolderType, type UserAppWindow } from '@seelen-ui/lib/types';

/**
 * The game library: what is installed, what it was launched from, and how long
 * it has been played.
 *
 * Finding the games is `detect.ts` - three passes over the only things a widget
 * can see. This is what happens to what they find: merging a scan into the
 * library without losing anything the user did to it, timing what is running,
 * and keeping the whole thing on disk.
 */

export interface GameEntry {
  id: string;
  /** The name detection found, kept so a rescan can refresh it. */
  name: string;
  /** What the user renamed it to, which wins over `name`. */
  customName?: string | null;
  /** What to open: an executable, a shortcut, or a launcher protocol URL. */
  target: string;
  kind: GameKind;
  umid?: string | null;
  /** The shortcut the entry came from, which is what the icon packs resolve. */
  iconKey?: string | null;
  launcher: LauncherId;
  /** A store chosen by hand, which a rescan must not overwrite. */
  customLauncher?: LauncherId | null;
  /** Identity across rescans: the umid, or the lower-cased target. */
  key: string;
  source: 'detected' | 'manual';
  /** Which pass found it, so only that pass can decide it has gone. */
  foundIn?: 'startmenu' | 'folder' | 'window';
  /** Absolute path to a cover image the user picked. */
  art?: string | null;
  favourite?: boolean;
  /** Kept out of the list without being forgotten, so a rescan cannot revive it. */
  hidden?: boolean;
  /** Detected once and gone from the index since: uninstalled, probably. */
  missing?: boolean;
  lastPlayed?: number | null;
  launches?: number;
  /** Accumulated play time, in minutes, measured from the game's own window. */
  minutes?: number;
  /**
   * The executable this game's window belongs to.
   *
   * Known from the start when the executable itself is what was found, and
   * learned after a launch when it is not - a `steam://rungameid/2050650`
   * target says nothing about the process that eventually appears, and that
   * process is the only thing "is it running" and "how long for" can be read
   * from. Cleared from the entry's own menu when it binds the wrong one.
   */
  exePath?: string | null;
}

export interface GamesState {
  version: 1;
  games: GameEntry[];
  /** Suggestion keys the user said no to, so a rescan does not re-offer them. */
  dismissed: string[];
}

const FILE = 'games.json';

/**
 * The known folders the deep scan walks.
 *
 * These are where a download lands. `Recent` is shortcuts to documents, and
 * Pictures, Music and Videos hold no programs - walking them would cost the
 * host a recursive read for nothing.
 */
const SCAN_FOLDERS: readonly { folder: FolderType; label: string }[] = [
  { folder: FolderType.Downloads, label: 'Downloads' },
  { folder: FolderType.Desktop, label: 'the Desktop' },
  { folder: FolderType.Documents, label: 'Documents' },
];

function defaults(): GamesState {
  return { version: 1, games: [], dismissed: [] };
}

/**
 * A detected entry's id, derived from its key rather than drawn at random.
 *
 * Both monitor replicas scan the same machine into the same shared file. A
 * random id would give the same game a different one on each display, so
 * whichever replica wrote last would renumber the library out from under the
 * other. FNV-1a over the key gives every replica the same answer.
 */
function stableId(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `game-${hash.toString(36)}`;
}

export function displayName(game: GameEntry): string {
  return game.customName?.trim() || game.name;
}

export function launcherOf(game: GameEntry): LauncherDefinition {
  return LAUNCHERS[game.customLauncher ?? game.launcher] ?? LAUNCHERS.other;
}

/** A cover image the user chose, if it is still set. */
export function coverUrl(game: GameEntry): string | null {
  return fileUrl(game.art);
}

/**
 * Two hues for a game's generated tile.
 *
 * Anchored on its store's hue so a shelf of Steam games reads as one family,
 * spread by a hash of the name so neighbours are still told apart at a glance.
 */
export function artHues(game: GameEntry): { from: number; to: number } {
  const name = displayName(game);
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 1024;
  const base = launcherOf(game).hue;
  const from = (base + (hash % 46) - 23 + 360) % 360;
  return { from, to: (from + 38) % 360 };
}

/** Up to two letters, which is what a tile with no art has to work with. */
export function initials(game: GameEntry): string {
  const words = displayName(game)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

export function formatPlaytime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes < 1) return null;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`;
}

export function formatLastPlayed(at: number | null | undefined): string | null {
  if (!at) return null;
  const days = (Date.now() - at) / 86_400_000;
  if (days < 0.02) return 'just now';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h ago`;
  if (days < 7) return `${Math.round(days)}d ago`;
  if (days < 365)
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return new Date(at).getFullYear().toString();
}

export type GameSort = 'recent' | 'name' | 'played' | 'launcher';

export function sortGames(
  list: readonly GameEntry[],
  sort: GameSort,
  favouritesFirst: boolean,
): GameEntry[] {
  const byName = (a: GameEntry, b: GameEntry) => displayName(a).localeCompare(displayName(b));
  return list.slice().sort((a, b) => {
    if (favouritesFirst && !!a.favourite !== !!b.favourite) return a.favourite ? -1 : 1;
    if (sort === 'recent') return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || byName(a, b);
    if (sort === 'played') return (b.minutes ?? 0) - (a.minutes ?? 0) || byName(a, b);
    if (sort === 'launcher') {
      const order = launcherOf(a).label.localeCompare(launcherOf(b).label);
      if (order) return order;
    }
    return byName(a, b);
  });
}

/** How long a launch is watched for the process it produced. */
const LEARN_WINDOW_MS = 180_000;

/**
 * The library, its scans, and the play clock.
 *
 * Deliberately shared by both displays rather than kept per monitor: a game
 * library is not a property of a screen. That means both replicas write the
 * same file, which is the hazard the README describes for notes as well - the
 * detected ids are derived from the entry itself so at least a rescan on one
 * display cannot renumber the other.
 *
 * Everything is acquired on mount and released with the panel: while the module
 * is off there is no file read, no subscription and no clock.
 */
class GamesStore {
  state = $state<GamesState>(defaults());

  /** Game id to the epoch millisecond its window was first seen. */
  running = $state<Record<string, number>>({});
  scanning = $state(false);
  /** What the scan is reading right now, for the panel's spinner. */
  scanStep = $state<string | null>(null);
  /** What the last scan came back with. */
  lastScan = $state<{ found: number; added: number } | null>(null);
  /**
   * Plausible finds that are not sure enough to add on their own.
   *
   * Held in memory only: they are cheap to find again, and a stale suggestion
   * for a folder that has since been deleted is worse than no suggestion.
   */
  suggestions = $state<DetectedGame[]>([]);

  /** Set from the panel; a scan only runs while the user wants one. */
  autoDetect = true;
  /** Set from the panel; walks Downloads, the Desktop and Documents too. */
  deepScan = true;
  /** Set from the panel; adds a game the moment it is seen running. */
  scanRunning = true;
  /** Set from the panel; when off, windows are still matched but not timed. */
  tracking = true;

  #writer = debouncedWriter(FILE, 800);
  #loaded = false;
  #users = 0;
  #generation = 0;
  #offWindows: UnSubscriber | null = null;
  #offIndex: UnSubscriber | null = null;
  /** The last window list the host sent, used to spot what a launch started. */
  #windows: UserAppWindow[] = [];
  #learning: { id: string; before: Set<string>; until: number } | null = null;

  get loaded(): boolean {
    return this.#loaded;
  }

  get all(): GameEntry[] {
    return this.state.games;
  }

  /**
   * Loads the library and keeps it live until every caller releases it.
   *
   * Returns its release function synchronously so a component can hold one for
   * exactly as long as it is mounted, the same shape `hostValue` uses.
   */
  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) void this.#start(++this.#generation);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      this.#generation++;
      this.#stop();
    };
  }

  async #start(mine: number): Promise<void> {
    if (!this.#loaded) {
      const loaded = await readJson<GamesState>(FILE, defaults());
      if (mine !== this.#generation) return;
      this.state = {
        ...defaults(),
        ...loaded,
        games: loaded.games ?? [],
        dismissed: loaded.dismissed ?? [],
      };
      this.#loaded = true;
    }

    // Windows first: the scan reads them too, and what is running is the one
    // sighting no other pass can produce.
    try {
      const windows = await invoke(SeelenCommand.GetUserAppWindows);
      if (mine !== this.#generation) return;
      this.#onWindows(windows);

      const off = await subscribe(SeelenEvent.UserAppWindowsChanged, (e) => {
        if (mine === this.#generation) this.#onWindows(e.payload);
      });
      if (mine === this.#generation) this.#offWindows = off;
      else off();
    } catch (err) {
      console.error('[games] could not watch windows', err);
      noteError(`games: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (this.autoDetect) await this.scan();
    if (mine !== this.#generation) return;

    try {
      // A game installed while the panel is open should appear in it. Only the
      // index changed, so this is the cheap pass, not the whole walk.
      const off = await subscribe(SeelenEvent.StartMenuItemsChanged, () => {
        if (mine === this.#generation && this.autoDetect) void this.scan({ deep: false });
      });
      if (mine === this.#generation) this.#offIndex = off;
      else off();
    } catch (err) {
      console.error('[games] could not watch the start menu index', err);
    }
  }

  #stop(): void {
    this.#offWindows?.();
    this.#offWindows = null;
    this.#offIndex?.();
    this.#offIndex = null;
    this.#learning = null;
    this.#windows = [];
    // Close every open session so its minutes are not lost with the panel.
    this.#endSessions(Object.keys(this.running));
    this.running = {};
    this.suggestions = [];
    void this.#writer.flush();
  }

  /** Flips detection on or off, rescanning when it comes back on. */
  setAutoDetect(on: boolean): void {
    const changed = this.autoDetect !== on;
    this.autoDetect = on;
    if (on && changed && this.#loaded) void this.scan();
  }

  save(): void {
    if (!this.#loaded) return;
    this.#writer.queue($state.snapshot(this.state));
  }

  flush(): Promise<void> {
    return this.#writer.flush();
  }

  /**
   * Looks for games everywhere it can, and folds what it finds into the library.
   *
   * Three passes, described in `detect.ts`: the Start Menu index, the known
   * folders a download lands in, and the windows that are open. Every catalogue
   * is read for the length of the scan and released again - the index is a few
   * hundred entries and a walked folder can be thousands, and holding either
   * for a panel that scans twice an hour would cost both replicas a copy for
   * nothing.
   */
  async scan(options: { deep?: boolean } = {}): Promise<void> {
    if (this.scanning) return;
    const deep = options.deep ?? this.deepScan;

    this.scanning = true;
    const lists: DetectedGame[][] = [];
    const passes = new Set<NonNullable<GameEntry['foundIn']>>();

    try {
      this.scanStep = 'the Start Menu';
      let release: UnSubscriber | null = null;
      try {
        release = await apps.acquire();
        lists.push(detectFromStartMenu(apps.items));
        passes.add('startmenu');
      } finally {
        release?.();
      }

      if (deep) {
        for (const { folder, label } of SCAN_FOLDERS) {
          this.scanStep = label;
          try {
            const paths = await invoke(SeelenCommand.GetUserFolderContent, { folderType: folder });
            lists.push(detectFromFolder(paths, label));
            passes.add('folder');
          } catch (err) {
            // One unreadable folder must not end the scan.
            console.error(`[games] could not read ${label}`, err);
          }
        }
      }

      this.scanStep = 'what is running';
      lists.push(detectFromWindows(this.#windows));

      this.#merge(mergeCandidates(lists), passes);
    } catch (err) {
      console.error('[games] scan failed', err);
      noteError(`games: scan ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.scanning = false;
      this.scanStep = null;
    }
  }

  /**
   * Folds a scan into the library without losing anything the user did.
   *
   * A detected entry is matched by key - and by executable, because the same
   * game is often found by two passes under two names - so a rename, a cover, a
   * hidden flag and an hour of play time all survive a rescan; only the facts
   * detection owns are refreshed, and only where the user has not pinned them.
   *
   * Anything found before by a pass that ran again, and absent now, is marked
   * `missing` rather than deleted: an uninstall should not silently take its
   * play time with it, and a pass that did not run says nothing at all about
   * what it found last time.
   */
  #merge(
    found: readonly DetectedGame[],
    passes: ReadonlySet<NonNullable<GameEntry['foundIn']>>,
  ): void {
    const byKey = new Map<string, GameEntry>();
    const byTarget = new Map<string, GameEntry>();
    const byExe = new Map<string, GameEntry>();
    for (const game of this.state.games) {
      byKey.set(game.key, game);
      byTarget.set(game.target.toLowerCase(), game);
      if (game.exePath) byExe.set(game.exePath.toLowerCase(), game);
    }

    const seen = new Set<string>();
    const dismissed = new Set(this.state.dismissed);
    const suggestions: DetectedGame[] = [];
    let added = 0;

    for (const candidate of found) {
      const exe = candidate.exePath?.toLowerCase();
      const existing =
        byKey.get(candidate.key) ??
        byTarget.get(candidate.target.toLowerCase()) ??
        (exe ? byExe.get(exe) : undefined);

      if (existing) {
        seen.add(existing.key);
        existing.missing = false;
        existing.exePath ??= candidate.exePath ?? null;
        if (existing.source === 'detected' && existing.key === candidate.key) {
          existing.name = candidate.name;
          existing.target = candidate.target;
          existing.kind = candidate.kind;
          existing.umid = candidate.umid;
          existing.iconKey = candidate.iconKey;
          existing.launcher = candidate.launcher;
        } else {
          // Found by a second route: keep the entry, take the icon it lacked.
          existing.iconKey ??= candidate.iconKey;
        }
        continue;
      }

      if (candidate.confidence === 'guess') {
        if (!dismissed.has(candidate.key)) suggestions.push(candidate);
        continue;
      }

      // Counted as seen before it is added: the sweep below retires anything
      // its own pass did not find this time, and this *is* what it found.
      seen.add(candidate.key);
      this.state.games.push(this.#entryFor(candidate));
      added++;
    }

    for (const game of this.state.games) {
      if (game.source !== 'detected' || seen.has(game.key)) continue;
      const from = game.foundIn ?? 'startmenu';
      // A game found by being *run* is not missing merely because it is not
      // running now, and a pass that did not run cannot retire anything.
      if (from !== 'window' && passes.has(from)) game.missing = true;
    }

    this.suggestions = suggestions;
    this.lastScan = { found: found.length, added };
    this.save();
  }

  #entryFor(candidate: DetectedGame): GameEntry {
    return {
      id: stableId(candidate.key),
      name: candidate.name,
      target: candidate.target,
      kind: candidate.kind,
      umid: candidate.umid,
      iconKey: candidate.iconKey,
      launcher: candidate.launcher,
      key: candidate.key,
      source: 'detected',
      foundIn: candidate.from,
      exePath: candidate.exePath ?? null,
      launches: 0,
      minutes: 0,
      lastPlayed: null,
    };
  }

  /** Accepts one of the scan's uncertain finds. */
  addSuggestion(candidate: DetectedGame): void {
    if (!this.state.games.some((game) => game.key === candidate.key)) {
      this.state.games.push(this.#entryFor(candidate));
    }
    this.suggestions = this.suggestions.filter((s) => s.key !== candidate.key);
    this.save();
  }

  /** Refuses one, for good: a rescan will not offer it again. */
  dismissSuggestion(key: string): void {
    if (!this.state.dismissed.includes(key)) this.state.dismissed.push(key);
    this.suggestions = this.suggestions.filter((s) => s.key !== key);
    this.save();
  }

  /** Puts every refusal back, so the next scan can offer them again. */
  clearDismissed(): void {
    this.state.dismissed = [];
    this.save();
  }

  find(id: string): GameEntry | undefined {
    return this.state.games.find((game) => game.id === id);
  }

  addManual(entry: {
    name: string;
    target: string;
    kind: GameKind;
    umid?: string | null;
    iconKey?: string | null;
    launcher?: LauncherId;
  }): GameEntry {
    const created: GameEntry = {
      id: newId('game'),
      name: entry.name,
      target: entry.target,
      kind: entry.kind,
      umid: entry.umid ?? null,
      iconKey: entry.iconKey ?? (entry.kind === 'app' ? entry.target : null),
      launcher: entry.launcher ?? 'other',
      key: `manual:${entry.target.toLowerCase()}`,
      source: 'manual',
      exePath:
        entry.kind === 'app' && entry.target.toLowerCase().endsWith('.exe') ? entry.target : null,
      launches: 0,
      minutes: 0,
      lastPlayed: null,
    };
    this.state.games.push(created);
    this.save();
    return created;
  }

  update(id: string, patch: Partial<GameEntry>): void {
    const game = this.find(id);
    if (!game) return;
    Object.assign(game, patch);
    this.save();
  }

  remove(id: string): void {
    this.state.games = this.state.games.filter((game) => game.id !== id);
    this.save();
  }

  toggleFavourite(id: string): void {
    const game = this.find(id);
    if (!game) return;
    game.favourite = !game.favourite;
    this.save();
  }

  setHidden(id: string, hidden: boolean): void {
    this.update(id, { hidden });
  }

  clearStats(id: string): void {
    this.update(id, { minutes: 0, launches: 0, lastPlayed: null });
  }

  /**
   * Starts a game and begins watching for the process it produces.
   *
   * The launch itself is the host's, exactly as a desktop icon's would be. What
   * is added here is the bookkeeping: the click is recorded straight away, and
   * where the entry has no executable bound yet the next few minutes of window
   * changes are watched for one - see `#learn`.
   */
  play(id: string): void {
    const game = this.find(id);
    if (!game) return;

    game.launches = (game.launches ?? 0) + 1;
    game.lastPlayed = Date.now();
    this.save();

    // Never learn from an empty snapshot: with no window list to compare
    // against, the first window to appear - any window - would be bound.
    if (this.tracking && !game.exePath && this.#windows.length) {
      this.#learning = {
        id,
        before: new Set(this.#windows.map((w) => (w.process.path ?? '').toLowerCase())),
        until: Date.now() + LEARN_WINDOW_MS,
      };
    }

    void launch(game.target, game.kind === 'url' ? 'url' : 'app');
  }

  /** The window this game is running in, if the host is showing one. */
  windowFor(game: GameEntry): UserAppWindow | null {
    return this.#windows.find((w) => this.#isGameWindow(game, w)) ?? null;
  }

  isRunning(id: string): boolean {
    return id in this.running;
  }

  #isGameWindow(game: GameEntry, window: UserAppWindow): boolean {
    if (game.umid && window.umid && game.umid === window.umid) return true;
    const path = (window.process.path ?? '').toLowerCase();
    if (!path) return false;
    const bound = game.exePath?.toLowerCase();
    if (bound) return path === bound;
    // An entry that points straight at an executable needs no learning pass.
    return game.kind === 'app' && game.target.toLowerCase().endsWith('.exe')
      ? path === game.target.toLowerCase()
      : false;
  }

  #onWindows(windows: UserAppWindow[]): void {
    this.#windows = windows;
    this.#learn(windows);
    if (this.scanRunning && this.autoDetect) this.#adoptRunning(windows);

    const active = new Set<string>();
    for (const window of windows) {
      for (const game of this.state.games) {
        if (this.#isGameWindow(game, window)) active.add(game.id);
      }
    }

    const now = Date.now();
    const started = [...active].filter((id) => !(id in this.running));
    const ended = Object.keys(this.running).filter((id) => !active.has(id));
    if (!started.length && !ended.length) return;

    this.#endSessions(ended);

    const next = { ...this.running };
    for (const id of ended) delete next[id];
    for (const id of started) next[id] = now;
    this.running = next;
  }

  /**
   * Adds a game the moment it is seen running.
   *
   * This is the pass that reaches what nothing else can: a Game Pass title
   * under `C:\XboxGames`, a Steam library on a drive no known folder touches, a
   * game with no shortcut anywhere. `detectFromWindows` only returns a process
   * whose own path places it in a game library, so what arrives here is already
   * sure enough to keep - and it arrives with its executable known, which is
   * what the play clock needs.
   */
  #adoptRunning(windows: readonly UserAppWindow[]): void {
    const candidates = detectFromWindows(windows);
    if (!candidates.length) return;

    let added = false;
    for (const candidate of candidates) {
      const exe = candidate.exePath?.toLowerCase();
      const known = this.state.games.some(
        (game) =>
          game.key === candidate.key ||
          game.target.toLowerCase() === candidate.target.toLowerCase() ||
          (!!exe && game.exePath?.toLowerCase() === exe),
      );
      if (known) continue;
      this.state.games.push(this.#entryFor(candidate));
      added = true;
    }
    if (added) this.save();
  }

  /** Adds each finished session to its game's total. */
  #endSessions(ids: readonly string[]): void {
    if (!ids.length) return;
    const now = Date.now();
    let changed = false;
    for (const id of ids) {
      const since = this.running[id];
      const game = this.find(id);
      if (!since || !game) continue;
      if (this.tracking) {
        game.minutes = (game.minutes ?? 0) + (now - since) / 60_000;
        game.lastPlayed = now;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * Binds the executable a launch produced, so the game can be timed.
   *
   * A store's shortcut hands the request to the client and says nothing about
   * what the client eventually starts, so the process has to be identified by
   * elimination: a window that was not open when the launch happened, does not
   * belong to any client or helper, and is not already another game's. The
   * first one to appear inside the watch window wins.
   *
   * It is a guess, and it can bind the wrong program if something else is
   * opened in the same couple of minutes - which is why the entry's own menu
   * offers to forget it again.
   */
  #learn(windows: readonly UserAppWindow[]): void {
    const learning = this.#learning;
    if (!learning) return;
    if (Date.now() > learning.until) {
      this.#learning = null;
      return;
    }

    const taken = new Set(
      this.state.games.map((game) => game.exePath?.toLowerCase()).filter(Boolean) as string[],
    );

    for (const window of windows) {
      const path = (window.process.path ?? '').toLowerCase();
      if (!path || learning.before.has(path) || taken.has(path)) continue;
      if (CLIENT_EXES.has(baseName(path))) continue;
      this.update(learning.id, { exePath: window.process.path });
      // The running pass may have added the same program under its own name
      // already; the entry the user launched is the one that should survive.
      this.#absorb(path, learning.id);
      this.#learning = null;
      return;
    }
  }

  /**
   * Folds a duplicate of one game into the entry that should survive.
   *
   * Its play time is carried over rather than dropped: it was time spent in the
   * same game, however the two entries came to exist.
   */
  #absorb(exePath: string, keepId: string): void {
    const keep = this.find(keepId);
    if (!keep) return;
    const duplicates = this.state.games.filter(
      (game) => game.id !== keepId && game.target.toLowerCase() === exePath,
    );
    if (!duplicates.length) return;

    for (const duplicate of duplicates) {
      keep.minutes = (keep.minutes ?? 0) + (duplicate.minutes ?? 0);
      keep.launches = (keep.launches ?? 0) + (duplicate.launches ?? 0);
      keep.lastPlayed = Math.max(keep.lastPlayed ?? 0, duplicate.lastPlayed ?? 0) || null;
    }
    const gone = new Set(duplicates.map((duplicate) => duplicate.id));
    this.state.games = this.state.games.filter((game) => !gone.has(game.id));
    this.save();
  }

  /**
   * Loads the library and nothing else.
   *
   * For the palette, which lists games to launch but must not watch windows:
   * the play clock belongs to the surface, and a second process keeping its own
   * would double every session and write the file from under the first.
   */
  async readOnly(): Promise<void> {
    if (this.#loaded) return;
    const loaded = await readJson<GamesState>(FILE, defaults());
    if (this.#loaded) return;
    this.state = {
      ...defaults(),
      ...loaded,
      games: loaded.games ?? [],
      dismissed: loaded.dismissed ?? [],
    };
    this.#loaded = true;
  }
}

export const games = new GamesStore();
