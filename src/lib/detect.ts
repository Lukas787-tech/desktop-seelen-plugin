import type { StartMenuItem, UserAppWindow } from '@seelen-ui/lib/types';

/**
 * Finding games on a machine a widget can barely see.
 *
 * There is no directory listing in the host API, no process list, and no way to
 * read a launcher's own manifests, so nothing here can ask "what is installed".
 * Three sources answer sideways, and this file is all three:
 *
 * 1. **The Start Menu index** (`get_start_menu_items`), which carries the
 *    `target` of every shortcut - so a store's own protocol link is visible.
 * 2. **The known folders** (`get_user_folder_content`), which walk *recursively*
 *    and return the whole subtree flat. That is what makes a game downloaded
 *    from the web findable: the executable is in there, and so are the files
 *    beside it, which is enough to recognise an engine.
 * 3. **The open windows** (`get_user_app_windows`), whose `process.path` is the
 *    only sight of a game that lives somewhere nothing else can reach -
 *    Game Pass titles under `C:\XboxGames`, or a second Steam library on
 *    another drive.
 *
 * Everything is a heuristic, so every candidate carries the confidence it was
 * found with. The panel adds the confident ones and offers the rest.
 */

export type LauncherId =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'battlenet'
  | 'ea'
  | 'ubisoft'
  | 'riot'
  | 'rockstar'
  | 'amazon'
  | 'itch'
  | 'xbox'
  | 'other';

export interface LauncherDefinition {
  id: LauncherId;
  label: string;
  /** Base hue for this store's badge and generated tile art, 0-359. */
  hue: number;
  /** Protocol prefixes a shortcut's target may carry. */
  protocols?: readonly string[];
  /** Fragments that appear in the shortcut's own path or in its target. */
  fragments?: readonly string[];
}

/**
 * One entry per store, in the order `classify` tries them.
 *
 * Order matters where two signatures overlap: a shortcut under
 * `...\Epic Games\Launcher\...` carries "epic games" *and* sits in a folder
 * called Games, so the specific stores are all tried before the generic
 * "a folder called Games" rule at the end.
 */
export const LAUNCHERS: Record<LauncherId, LauncherDefinition> = {
  steam: {
    id: 'steam',
    label: 'Steam',
    hue: 205,
    protocols: ['steam://rungameid/', 'steam://launch/'],
    fragments: ['\\steamapps\\common\\', '\\start menu\\programs\\steam\\', '\\steamlibrary\\'],
  },
  epic: {
    id: 'epic',
    label: 'Epic Games',
    hue: 232,
    protocols: ['com.epicgames.launcher://apps/'],
    fragments: ['\\epic games\\', '\\epicgames\\'],
  },
  gog: {
    id: 'gog',
    label: 'GOG',
    hue: 285,
    protocols: ['goggalaxy://'],
    fragments: ['\\gog galaxy\\games\\', '\\gog.com\\', '\\gog games\\'],
  },
  battlenet: {
    id: 'battlenet',
    label: 'Battle.net',
    hue: 200,
    protocols: ['battlenet://'],
    fragments: ['\\battle.net\\', '\\blizzard\\', '\\blizzard entertainment\\'],
  },
  ea: {
    id: 'ea',
    label: 'EA',
    hue: 12,
    protocols: ['origin2://', 'link2ea://', 'eaapp://'],
    fragments: ['\\ea games\\', '\\origin games\\', '\\electronic arts\\'],
  },
  ubisoft: {
    id: 'ubisoft',
    label: 'Ubisoft',
    hue: 190,
    protocols: ['uplay://'],
    fragments: ['\\ubisoft\\', '\\ubisoft game launcher\\'],
  },
  riot: { id: 'riot', label: 'Riot', hue: 350, fragments: ['\\riot games\\'] },
  rockstar: {
    id: 'rockstar',
    label: 'Rockstar',
    hue: 40,
    protocols: ['rockstar://'],
    fragments: ['\\rockstar games\\'],
  },
  amazon: {
    id: 'amazon',
    label: 'Amazon',
    hue: 30,
    protocols: ['amazon-games://'],
    fragments: ['\\amazon games\\'],
  },
  itch: {
    id: 'itch',
    label: 'itch.io',
    hue: 345,
    protocols: ['itch://'],
    fragments: ['\\itch\\apps\\'],
  },
  // Game Pass installs under `C:\XboxGames\<Name>\Content\`, which is the one
  // packaged-app signature that means "game" - a `umid` alone never does.
  xbox: { id: 'xbox', label: 'Xbox', hue: 120, fragments: ['\\xboxgames\\'] },
  other: { id: 'other', label: 'Other', hue: 265 },
};

export const LAUNCHER_ORDER: readonly LauncherId[] = [
  'steam',
  'epic',
  'gog',
  'battlenet',
  'ea',
  'ubisoft',
  'riot',
  'rockstar',
  'amazon',
  'itch',
  'xbox',
  'other',
];

/**
 * The clients themselves, their helpers, and the shells a game never is.
 *
 * Used three times: to keep "Steam" out of the list of Steam games, to keep the
 * running-window pass off the launcher that started the game, and as the
 * blocklist for the executable-learning pass in `games.svelte.ts`.
 */
export const CLIENT_EXES = new Set([
  'steam.exe',
  'steamwebhelper.exe',
  'steamservice.exe',
  'epicgameslauncher.exe',
  'epicwebhelper.exe',
  'galaxyclient.exe',
  'galaxyclienthelper.exe',
  'battle.net.exe',
  'battle.net helper.exe',
  'agent.exe',
  'eadesktop.exe',
  'eabackgroundservice.exe',
  'origin.exe',
  'upc.exe',
  'ubisoftconnect.exe',
  'ubisoftgamelauncher.exe',
  'riotclientservices.exe',
  'riotclientux.exe',
  'rockstarservice.exe',
  'launchdarkly.exe',
  // Deliberately not `launcher.exe`: too many games ship one of their own, and
  // dropping a real game is worse than occasionally timing a client.
  'amazon games.exe',
  'itch.exe',
  'explorer.exe',
  'applicationframehost.exe',
  'msedgewebview2.exe',
  'crashpad_handler.exe',
  'crashreportclient.exe',
  'unrealcefsubprocess.exe',
  'gamebar.exe',
  'gamingservices.exe',
]);

/** Shortcut and executable names that sit beside a game without being one. */
const NOISE =
  /\b(uninstall\w*|readme|read me|manual|support|website|homepage|help|documentation|redist\w*|directx|visual c\+\+|crash|report|error|dedicated server|server|benchmark|configuration|troubleshoot\w*|mod tool|sdk|editor)\b/i;

/** The clients' own Start Menu entries, which are launchers and not games. */
const CLIENT_NAMES =
  /^(steam|steam client\b.*|epic games( launcher)?|gog galaxy|battle\.?net|ea app|ea desktop|origin|ubisoft connect|uplay|riot client|rockstar games launcher|amazon games|itch|xbox( app)?|minecraft launcher)$/i;

export type GameKind = 'app' | 'url';

/**
 * How sure the scan is, worst last.
 *
 * - `store` — a launcher's own shortcut or library path. Certain.
 * - `engine` — an executable with a game engine's files beside it.
 * - `library` — an executable inside a folder that only holds games.
 * - `guess` — plausible and nothing more. Offered, never added.
 */
export type Confidence = 'store' | 'engine' | 'library' | 'guess';

export interface DetectedGame {
  key: string;
  /** Which pass found it, so only that pass can later decide it has gone. */
  from: 'startmenu' | 'folder' | 'window';
  name: string;
  target: string;
  kind: GameKind;
  umid: string | null;
  iconKey: string | null;
  launcher: LauncherId;
  confidence: Confidence;
  /** Why this was picked, shown beside a suggestion. */
  reason: string;
  /** Known immediately when the executable itself is what was found. */
  exePath?: string | null;
}

const SEP = String.fromCharCode(92); // backslash

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf(SEP), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : '';
}

/** Whether a target is opened as a program or handed to the shell as a URL. */
export function kindOfTarget(target: string): GameKind {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target.trim()) ? 'url' : 'app';
}

function matches(definition: LauncherDefinition, target: string, haystack: string): boolean {
  if (definition.protocols?.some((protocol) => target.startsWith(protocol))) return true;
  return definition.fragments?.some((fragment) => haystack.includes(fragment)) ?? false;
}

/**
 * Which store a path or protocol belongs to, or null when nothing recognises it.
 *
 * The generic rule at the end - an executable under a folder literally called
 * `Games` - is what covers a library that was installed without a launcher. It
 * is tried last so that `Program Files\Epic Games\...` is an Epic entry rather
 * than a generic one.
 */
function classify(target: string, haystack: string): LauncherId | null {
  for (const id of LAUNCHER_ORDER) {
    const definition = LAUNCHERS[id];
    if (definition.protocols || definition.fragments) {
      if (matches(definition, target, haystack)) return id;
    }
  }
  if (/\.exe$/.test(target) && /[\\/](games|jeux|spiele|giochi)[\\/]/.test(haystack)) return 'other';
  return null;
}

/**
 * The store a target belongs to, for an entry added by hand.
 *
 * The same table detection uses, without its filters: nothing the user picked
 * deliberately should be rejected for being called "Server" or for living in a
 * folder the scan does not know, so an unrecognised target is simply `other`.
 */
export function launcherFor(target: string, shortcutPath?: string | null): LauncherId {
  const lowered = target.toLowerCase();
  return classify(lowered, `${shortcutPath ?? ''}\n${target}`.toLowerCase()) ?? 'other';
}

/* -------------------------------------------------------------------------- */
/* 1. The Start Menu index                                                     */
/* -------------------------------------------------------------------------- */

/** Everything in the Start Menu index that a store put there. */
export function detectFromStartMenu(items: readonly StartMenuItem[]): DetectedGame[] {
  const found: DetectedGame[] = [];

  for (const item of items) {
    const name = item.display_name.trim();
    if (!name || CLIENT_NAMES.test(name) || NOISE.test(name)) continue;

    const target = (item.target ?? item.path).trim();
    if (!target) continue;

    const lowered = target.toLowerCase();
    if (CLIENT_EXES.has(baseName(lowered))) continue;

    const haystack = `${item.path}\n${item.target ?? ''}`.toLowerCase();
    const launcher = classify(lowered, haystack);
    if (!launcher) continue;

    found.push({
      key: item.umid ? `umid:${item.umid}` : `target:${lowered}`,
      from: 'startmenu',
      name,
      target,
      kind: kindOfTarget(target),
      umid: item.umid,
      // The shortcut file, not the protocol target: a `steam://` URL has no
      // icon anywhere, and the `.url` beside it is what Windows drew from.
      iconKey: item.path,
      launcher,
      confidence: 'store',
      reason: `${LAUNCHERS[launcher].label} shortcut`,
      exePath: lowered.endsWith('.exe') ? target : null,
    });
  }

  return found;
}

/* -------------------------------------------------------------------------- */
/* 2. A walked folder                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Files that only appear beside a game.
 *
 * This is the whole trick for a game that came from the web rather than a
 * store: the download is a folder, and what is in the folder says what it is.
 * Every marker here ships *with* the game - an engine runtime, a store SDK, an
 * audio or video library games use and ordinary software does not.
 */
const ENGINE_MARKERS: readonly { test: (name: string) => boolean; engine: string }[] = [
  { test: (n) => n === 'unityplayer.dll' || n === 'unitycrashhandler64.exe', engine: 'Unity' },
  { test: (n) => n.endsWith('_data') || n === 'monobleedingedge', engine: 'Unity' },
  { test: (n) => n.endsWith('-win64-shipping.exe') || n === 'ue4prereqsetup_x64.exe', engine: 'Unreal' },
  { test: (n) => n.endsWith('.pck'), engine: 'Godot' },
  { test: (n) => n === 'data.win' || n.startsWith('audiogroup'), engine: 'GameMaker' },
  { test: (n) => n === 'nw.dll' || n === 'rpg_rt.exe' || n.startsWith('rgss'), engine: 'RPG Maker' },
  { test: (n) => n.endsWith('.rpa') || n === 'renpy', engine: "Ren'Py" },
  { test: (n) => n === 'love.dll', engine: 'LÖVE' },
  { test: (n) => n.startsWith('steam_api') || n === 'steam_appid.txt', engine: 'Steam SDK' },
  { test: (n) => n === 'galaxy.dll' || n === 'galaxy64.dll', engine: 'GOG SDK' },
  { test: (n) => n.startsWith('eossdk-win64'), engine: 'Epic SDK' },
  { test: (n) => n === 'discord_game_sdk.dll', engine: 'Discord SDK' },
  { test: (n) => n.startsWith('fmod') || n === 'openal32.dll' || n === 'sdl2.dll', engine: 'game runtime' },
  { test: (n) => n.startsWith('bink2w') || n === 'wwise.dll', engine: 'game runtime' },
];

/** Executables that ship beside a game without being one. */
const NOT_A_GAME =
  /^(unins\w*|setup\w*|install\w*|update\w*|patch\w*|repair|vc_?redist\w*|vcredist\w*|dxsetup|dxwebsetup|directx\w*|dotnet\w*|oalinst|prereq\w*|redist\w*|python\w*|pythonw|node|7z\w*|winrar|readme|help|support|config\w*|settings|editor|server|benchmark|activation|keygen|crack|trainer|cheat\w*|notepad\w*|vlc|ffmpeg|handbrake)/i;

/**
 * Names that read like an installer or a tool.
 *
 * Matched loosely and used only to *demote* a find to a suggestion, never to
 * drop it: `Patch Quest` is a real game, and a game hidden by a keyword is a
 * worse outcome than one extra row in the Found list.
 */
const INSTALLER_ISH = /(setup|install|unins|update|patch|repair|driver|redist)/i;

/** Directories whose contents belong to something else in the same download. */
const NOT_A_GAME_DIR =
  /[\\/](_?commonredist|redist\w*|prerequisites?|directx|dotnet|vcredist|drivers?|node_modules|\.git|\$recycle\.bin|windows kits|engine[\\/]extras)[\\/]/i;

/** Folders that are a step on the way to the executable, not the game's name. */
const WRAPPER_DIRS = new Set([
  'bin',
  'bin64',
  'binaries',
  'win64',
  'win32',
  'x64',
  'x86',
  'game',
  'build',
  'release',
  'dist',
  'app',
  'content',
]);

/** Executable names too generic to be worth showing instead of the folder. */
const GENERIC_EXES = new Set([
  'game.exe',
  'start.exe',
  'play.exe',
  'launch.exe',
  'launcher.exe',
  'main.exe',
  'run.exe',
  'nw.exe',
  'love.exe',
  'rpg_rt.exe',
  'godot.exe',
  'player.exe',
]);

/**
 * Tidies a folder name that carries a version or a platform tag.
 *
 * Conservative on purpose, and one rule is missing deliberately: a bare
 * trailing number is never stripped, because `Portal 2` and `Hades II` are
 * names and `Game_v1.2` is not.
 */
function prettyName(raw: string): string {
  let name = raw;
  // Repeated, because a download is as often `Game_v1.2_win64` as either half.
  for (let pass = 0; pass < 3; pass++) {
    const before = name;
    name = name
      .replace(/[ ._-]*v?\d+(?:[._]\d+)+[a-z]?$/i, '')
      .replace(
        /[ ._-]*(?:win(?:dows)?(?:64|32)?|x64|x86|64bit|32bit|pc|portable|full|repack|final|release|build|setup)$/i,
        '',
      )
      .replace(/[ ._-]*\(\d+\)$/, '')
      .trim();
    if (name === before) break;
  }
  return name.replace(/_+/g, ' ').trim() || raw;
}

/**
 * Games inside one walked folder.
 *
 * `paths` is the whole subtree, flat, exactly as `get_user_folder_content`
 * returns it. Directories are recognised from the paths themselves - anything
 * with something under it - so no extra host call is needed to look inside a
 * download.
 */
export function detectFromFolder(paths: readonly string[], where: string): DetectedGame[] {
  if (!paths.length) return [];

  // Every name that appears anywhere under each directory, so an executable can
  // be judged by what shipped with it. Capped in depth: the marker files are
  // always within a few levels of the game, and the alternative is quadratic.
  const under = new Map<string, Set<string>>();
  for (const path of paths) {
    const lowered = path.toLowerCase();
    const name = baseName(lowered);
    let dir = parentOf(lowered);
    for (let depth = 0; dir.length > 3 && depth < 6; depth++) {
      let names = under.get(dir);
      if (!names) under.set(dir, (names = new Set()));
      names.add(name);
      dir = parentOf(dir);
    }
  }

  /** The folder a download is known by, skipping `bin\x64` and friends. */
  function gameFolder(exe: string): string {
    let dir = parentOf(exe);
    for (let hop = 0; hop < 3; hop++) {
      const parent = parentOf(dir);
      if (!parent || parent.length <= 3) break;
      if (!WRAPPER_DIRS.has(baseName(dir))) break;
      dir = parent;
    }
    return dir;
  }

  function engineOf(dir: string): string | null {
    const names = under.get(dir);
    if (!names) return null;
    for (const name of names) {
      for (const marker of ENGINE_MARKERS) {
        if (marker.test(name)) return marker.engine;
      }
    }
    return null;
  }

  // One candidate per game folder: a download holds several executables and
  // only one of them is the game.
  const best = new Map<string, { path: string; score: number; folder: string }>();

  for (const path of paths) {
    const lowered = path.toLowerCase();
    if (!lowered.endsWith('.exe')) continue;
    if (NOT_A_GAME_DIR.test(lowered)) continue;

    const exe = baseName(lowered);
    if (CLIENT_EXES.has(exe) || NOT_A_GAME.test(exe.replace(/\.exe$/, ''))) continue;

    const folder = gameFolder(lowered);
    const folderName = baseName(folder);
    // Named after its folder is the strongest hint of the two, then depth, so
    // `Celeste\Celeste.exe` wins over `Celeste\tools\import.exe`.
    const named = exe.replace(/\.exe$/, '') === folderName ? 4 : 0;
    const generic = GENERIC_EXES.has(exe) ? 1 : 0;
    const shallow = Math.max(0, 3 - (lowered.slice(folder.length).match(/[\\/]/g)?.length ?? 1));
    const score = named + generic + shallow;

    const current = best.get(folder);
    if (!current || score > current.score) best.set(folder, { path, score, folder });
  }

  const found: DetectedGame[] = [];

  for (const { path, folder } of best.values()) {
    const lowered = path.toLowerCase();
    const engine = engineOf(folder);
    const store = classify(lowered, lowered);

    let confidence: Confidence;
    let reason: string;
    if (store && store !== 'other') {
      confidence = 'store';
      reason = `${LAUNCHERS[store].label} library`;
    } else if (engine) {
      confidence = 'engine';
      reason = `${engine} game in ${where}`;
    } else if (store === 'other') {
      confidence = 'library';
      reason = `in a Games folder`;
    } else {
      confidence = 'guess';
      reason = `program in ${where}`;
    }

    const exe = baseName(path).replace(/\.exe$/i, '');
    const folderLabel = baseName(path.slice(0, folder.length));
    // The folder usually carries the name a person would write - spaces, and
    // whatever tells this build apart from the one beside it - so it wins
    // whenever it is the executable's name or an extension of it.
    // `Vampire Survivors\VampireSurvivors.exe` is the first case;
    // `Game Haven Enhanced\Game Haven.exe`, sitting next to a `Game Haven`
    // folder holding the same executable, is why the second matters.
    const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const fromFolder = prettyName(folderLabel);
    const fromExe = prettyName(exe);
    const name =
      GENERIC_EXES.has(baseName(lowered)) || squash(fromFolder).startsWith(squash(fromExe))
        ? fromFolder
        : fromExe;
    // An installer can carry a game's own files beside it, so a name that reads
    // like one is never added on its own - only offered.
    if (INSTALLER_ISH.test(exe) && confidence !== 'store') {
      confidence = 'guess';
      reason = `installer or tool in ${where}`;
    }
    found.push({
      key: `target:${lowered}`,
      from: 'folder',
      name,
      target: path,
      kind: 'app',
      umid: null,
      iconKey: path,
      launcher: store ?? 'other',
      confidence,
      reason,
      exePath: path,
    });
  }

  return found;
}

/* -------------------------------------------------------------------------- */
/* 3. What is running                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Games among the open windows.
 *
 * The only way to see a game that lives where nothing else can look: a Game
 * Pass title under `C:\XboxGames`, a Steam library on a drive the known folders
 * do not touch, a game started from a launcher that keeps no shortcut. The
 * process path has to speak for itself here - there are no neighbouring files
 * to read - so this only accepts a path that is inside something recognisable.
 */
export function detectFromWindows(windows: readonly UserAppWindow[]): DetectedGame[] {
  const found: DetectedGame[] = [];

  for (const window of windows) {
    const path = window.process.path?.trim();
    if (!path || !path.toLowerCase().endsWith('.exe')) continue;

    const lowered = path.toLowerCase();
    const exe = baseName(lowered);
    if (CLIENT_EXES.has(exe) || NOT_A_GAME.test(exe.replace(/\.exe$/, ''))) continue;

    const store = classify(lowered, lowered);
    const unreal = lowered.endsWith('-win64-shipping.exe');
    if (!store && !unreal) continue;

    const folder = baseName(parentOf(lowered));
    const name =
      window.appName?.trim() ||
      (GENERIC_EXES.has(exe) ? prettyName(folder) : prettyName(exe.replace(/\.exe$/, '')));

    found.push({
      key: `target:${lowered}`,
      from: 'window',
      name,
      target: path,
      kind: 'app',
      umid: window.umid,
      iconKey: path,
      launcher: store ?? 'other',
      confidence: store && store !== 'other' ? 'store' : 'library',
      reason: store && store !== 'other' ? `running from ${LAUNCHERS[store].label}` : 'seen running',
      exePath: path,
    });
  }

  return found;
}

/* -------------------------------------------------------------------------- */

const RANK: Record<Confidence, number> = { store: 3, engine: 2, library: 1, guess: 0 };

/**
 * Folds several passes into one list, keeping the surest sighting of each game.
 *
 * The same game is often found twice - a Start Menu shortcut *and* the
 * executable it points at, or a download that is also open on screen - and the
 * two carry different keys, so they are also matched on the executable.
 */
export function mergeCandidates(lists: readonly DetectedGame[][]): DetectedGame[] {
  const byKey = new Map<string, DetectedGame>();
  const byExe = new Map<string, string>();

  for (const list of lists) {
    for (const candidate of list) {
      const exe = candidate.exePath?.toLowerCase();
      const existingKey = byKey.has(candidate.key)
        ? candidate.key
        : exe
          ? byExe.get(exe)
          : undefined;
      const existing = existingKey ? byKey.get(existingKey) : undefined;

      if (!existing) {
        byKey.set(candidate.key, candidate);
        if (exe) byExe.set(exe, candidate.key);
        continue;
      }

      if (RANK[candidate.confidence] > RANK[existing.confidence]) {
        // Keep the surer sighting, but never lose an executable one pass knew
        // and the other did not.
        byKey.set(existing.key, { ...candidate, key: existing.key, exePath: candidate.exePath ?? existing.exePath });
      } else if (!existing.exePath && exe) {
        byKey.set(existing.key, { ...existing, exePath: candidate.exePath });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
