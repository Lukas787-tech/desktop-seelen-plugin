import { CLIENT_EXES, baseName } from './detect';

/**
 * What goes in which row of the launcher's home screen, and nothing twice.
 *
 * Three different repeats had to be dealt with, and they are worth telling
 * apart.
 *
 * 1. **The same game, twice in the library.** Detection has three passes and
 *    they routinely find one game by two routes - a Start Menu shortcut and the
 *    running process, say. `mergeCandidates` folds what one scan sees, but it
 *    matches on its own key, and two entries that reached the library by
 *    different scans - or one added by hand - are still two entries.
 *
 * 2. **The same game under two names for itself.** `steam://rungameid/730` is a
 *    shortcut, `cs2.exe` is a process and `steam://run/730` is what a rescan
 *    wrote, and no two of those strings are equal. So an entry is not reduced
 *    to one key: it carries every name it answers to, and two entries that
 *    share *any* of them are one game. That is a union, which is why this is a
 *    union-find rather than a `Set` of first sightings - A can match B on an
 *    executable and B match C on a title, and all three are one tile.
 *
 * 3. **The same game in three rows at once.** "Continue playing", "Favourites"
 *    and "All games" were each filtered from the whole library, so a favourite
 *    played this morning appeared three times on one screen. `homeRows` fills
 *    the rows in order and takes what it has used out of the ones below.
 *
 * Pure and generic over the entry, so `npm test` can check it with plain
 * objects rather than a mock library.
 */

/** The shape of an entry this file needs; `GameEntry` satisfies it. */
export interface RowGame {
  id: string;
  name: string;
  customName?: string | null;
  target: string;
  umid?: string | null;
  exePath?: string | null;
  art?: string | null;
  favourite?: boolean;
  missing?: boolean;
  lastPlayed?: number | null;
  launches?: number;
  minutes?: number;
}

/**
 * A title reduced to what two spellings of it have in common.
 *
 * Case, punctuation and the trademark furniture a store writes into its own
 * shortcuts: `Counter-Strike 2`, `Counter Strike 2` and `COUNTER-STRIKE 2™`
 * are one game, and nothing else in the library is going to collide with the
 * result. Deliberately not clever about editions or roman numerals - folding
 * `Hades` into `Hades II` would be a worse bug than the one being fixed.
 */
export function nameKey(game: RowGame): string {
  return (game.customName?.trim() || game.name || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The store and id inside a launcher URL, where there is one.
 *
 * Steam alone writes `steam://rungameid/730`, `steam://run/730` and
 * `steam://launch/730` for the same game, and the Epic and Ubisoft links vary
 * the same way. The store plus the number is the part that is the *game*.
 */
function storeKey(target: string): string | null {
  const url = target.toLowerCase();
  const scheme = /^([a-z0-9.+-]+):\/\//.exec(url)?.[1];
  if (!scheme) return null;
  // The last number in the link is the id in every store's scheme seen so far.
  const id = url.match(/\d{3,}/g)?.pop();
  return id ? `store:${scheme}:${id}` : null;
}

/** Does this look like a path to a program rather than a launcher link? */
function isPath(target: string): boolean {
  return /^[a-z]:[\\/]/i.test(target) || target.startsWith('\\\\');
}

/**
 * An executable key, unless the executable is a launcher's own bootstrapper.
 *
 * Every Riot game is started by `RiotClientServices.exe` and every Xbox one by
 * `explorer.exe`; matching on those would fold a whole store into one tile.
 * `CLIENT_EXES` is already the list detection rejects games by, so it is the
 * list here too rather than a second copy of it.
 */
function exeKey(path: string): string | null {
  const file = baseName(path).toLowerCase();
  if (CLIENT_EXES.has(file)) return null;
  return `exe:${path.toLowerCase().replace(/\//g, '\\')}`;
}

/**
 * Every name an entry answers to.
 *
 * An entry is the same game as another when they share any one of these, so
 * each has to be something only that game would say. The entry's own id is the
 * last resort, which is what keeps an entry with nothing to offer - no target,
 * no name - from folding into every other such entry.
 */
export function keysOf(game: RowGame): string[] {
  const keys = new Set<string>();

  if (game.exePath) {
    const key = exeKey(game.exePath);
    if (key) keys.add(key);
  }
  if (game.umid) keys.add(`umid:${game.umid.toLowerCase()}`);
  if (game.target) {
    keys.add(`target:${game.target.toLowerCase()}`);
    if (isPath(game.target)) {
      const key = exeKey(game.target);
      if (key) keys.add(key);
    }
    const store = storeKey(game.target);
    if (store) keys.add(store);
  }

  const name = nameKey(game);
  if (name) keys.add(`name:${name}`);

  return keys.size ? [...keys] : [`id:${game.id}`];
}

/**
 * What two entries for one game know between them.
 *
 * The first is the entry the user sees - it is the one the sort put in front -
 * and the second is only allowed to fill in what the first does not have. Play
 * time is the exception worth stating: two entries for one game each counted a
 * share of it, and the larger count is the closer of the two to the truth.
 * Adding them would double-count the hours both watched the same window for.
 */
function fold<T extends RowGame>(base: T, extra: T): T {
  return {
    ...base,
    exePath: base.exePath ?? extra.exePath,
    umid: base.umid ?? extra.umid,
    art: base.art ?? extra.art,
    favourite: base.favourite || extra.favourite,
    // Present in one and gone from the other means installed.
    missing: base.missing && extra.missing,
    lastPlayed: Math.max(base.lastPlayed ?? 0, extra.lastPlayed ?? 0) || null,
    launches: Math.max(base.launches ?? 0, extra.launches ?? 0),
    minutes: Math.max(base.minutes ?? 0, extra.minutes ?? 0),
  };
}

/**
 * The entries of one library, gathered into a group per game.
 *
 * Every group is in the order the entries arrived, and the groups themselves
 * are in the order their first entry did, so a caller that only wants the list
 * back gets it in the order it handed over. Most groups have one entry in them;
 * the ones that do not are the duplicates.
 */
export function groupDuplicates<T extends RowGame>(games: readonly T[]): T[][] {
  const parent = games.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    /* Flatten what was walked, so a long chain is walked once. */
    let step = i;
    while (parent[step] !== root) {
      const next = parent[step]!;
      parent[step] = root;
      step = next;
    }
    return root;
  };
  const join = (a: number, b: number): void => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  /* One pass to learn who is who, so the groups are settled before anything is
     folded - an entry can bridge two groups found long before it. */
  const owner = new Map<string, number>();
  games.forEach((game, i) => {
    for (const key of keysOf(game)) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else join(seen, i);
    }
  });

  const groups: T[][] = [];
  const slotOf = new Map<number, number>();
  games.forEach((game, i) => {
    const root = find(i);
    const slot = slotOf.get(root);
    if (slot === undefined) {
      slotOf.set(root, groups.length);
      groups.push([game]);
    } else {
      groups[slot]!.push(game);
    }
  });
  return groups;
}

/**
 * One tile per game, whichever of its names each copy arrived under.
 *
 * The kept entry is the *first* of a group, not the best: the list arrives
 * already sorted the way the user asked for, so the first is what that sort put
 * in front - the more recently played of two copies, or the favourite - and
 * anything the others knew and it did not is folded into it.
 *
 * This is the last word before anything is drawn, and it changes nothing on
 * disk: `games.mergeDuplicates()` is the one that does, and it is a thing the
 * user asks for rather than something that quietly rewrites their library.
 */
export function dedupe<T extends RowGame>(games: readonly T[]): T[] {
  return groupDuplicates(games).map((group) => group.reduce(fold));
}

export interface RowSpec<T> {
  id: string;
  label: string;
  games: T[];
}

export interface RowOptions {
  /** How many games the "Continue playing" row holds. */
  recentCount: number;
  /** Off, everything is one row - which is what the grid and wall layouts want. */
  split: boolean;
}

/**
 * The home screen's rows, in order, with no game in two of them.
 *
 * The last row is named for what it actually holds: "All games" when it is the
 * only row, and "Everything else" when the rows above have already taken some -
 * a row headed "All games" that is missing the six above it is a small lie the
 * eye notices.
 */
export function homeRows<T extends RowGame>(
  ordered: readonly T[],
  options: RowOptions,
): RowSpec<T>[] {
  const all = dedupe(ordered);
  if (!options.split) return [{ id: 'all', label: 'All games', games: all }];

  const used = new Set<string>();
  const take = (games: readonly T[]): T[] => {
    const out: T[] = [];
    for (const game of games) {
      if (used.has(game.id)) continue;
      used.add(game.id);
      out.push(game);
    }
    return out;
  };

  const recent = take(
    all
      .filter((game) => game.lastPlayed)
      // Its own order, not the library's: this row is "what you were playing".
      .slice()
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, Math.max(0, options.recentCount)),
  );
  const favourites = take(all.filter((game) => game.favourite));
  const rest = take(all);

  const rows: RowSpec<T>[] = [];
  if (recent.length) rows.push({ id: 'recent', label: 'Continue playing', games: recent });
  if (favourites.length) rows.push({ id: 'fav', label: 'Favourites', games: favourites });
  rows.push({
    id: 'all',
    label: rows.length ? 'Everything else' : 'All games',
    games: rest,
  });
  return rows;
}
