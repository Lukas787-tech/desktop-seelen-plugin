import { newId } from './ids';
import { debouncedWriter, readJson } from './persist';

/** A module panel that can be placed on the surface. */
export type PanelKind =
  | 'clock'
  | 'media'
  | 'sysmon'
  | 'notes'
  | 'calendar'
  | 'worldclock'
  | 'timer'
  | 'battery'
  | 'power'
  | 'quick'
  | 'windows'
  | 'workspaces'
  | 'network'
  | 'bluetooth'
  | 'notifications'
  | 'clipboard'
  | 'trash'
  | 'files'
  | 'games'
  | 'chat'
  | 'weather'
  | 'agenda'
  | 'alarms'
  | 'perf'
  | 'usage'
  | 'apps'
  | 'board'
  | 'habits'
  | 'calc'
  | 'tray'
  | 'links'
  | 'browser';

export type IconKind = 'app' | 'file' | 'folder' | 'url';

export interface DesktopIcon {
  id: string;
  label: string;
  /** What to open: an executable, a document, a folder, or a URL. */
  target: string;
  kind: IconKind;
  /** Absolute path to a user-chosen image; when unset the host resolves an icon. */
  iconPath?: string | null;
  /** App user model id, when known - the host's best icon lookup key. */
  umid?: string | null;
  x: number;
  y: number;
}

export interface DesktopPanel {
  id: string;
  kind: PanelKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallpaperChoice {
  source: 'none' | 'library' | 'file';
  /** Seelen wallpaper resource id, when `source` is "library". */
  id?: string | null;
  /** Absolute path, when `source` is "file". */
  path?: string | null;
}

export interface MonitorState {
  version: 1;
  wallpaper: WallpaperChoice;
  icons: DesktopIcon[];
  panels: DesktopPanel[];
}

/** Every module kind, in the order panels are created. */
export const PANEL_KINDS: readonly PanelKind[] = [
  'clock',
  'media',
  'sysmon',
  'notes',
  'calendar',
  'worldclock',
  'timer',
  'battery',
  'power',
  'quick',
  'windows',
  'workspaces',
  'network',
  'bluetooth',
  'notifications',
  'clipboard',
  'trash',
  'files',
  'games',
  'chat',
  'weather',
  'agenda',
  'alarms',
  'perf',
  'usage',
  'apps',
  'board',
  'habits',
  'calc',
  'tray',
  'links',
  'browser',
];

/**
 * A first-run arrangement that reads well on both a 3440x1440 ultrawide and a
 * 1920x1080 panel: columns of 300px starting at the left, clear of the icon
 * grid, with nothing reaching past 1620x1040 so every module lands on screen
 * on a 1080p display the first time it is switched on.
 *
 * Only the first four modules are on by default; the rest keep a place in this
 * table so that enabling one puts it somewhere sensible rather than on top of
 * another panel.
 *
 * Also what "Reset size" and "Reset position" return a panel to.
 */
export const DEFAULT_PANEL_LAYOUT: Record<PanelKind, { x: number; y: number; w: number; h: number }> =
  {
    clock: { x: 40, y: 40, w: 300, h: 150 },
    media: { x: 40, y: 210, w: 300, h: 330 },
    sysmon: { x: 40, y: 560, w: 300, h: 210 },
    notes: { x: 40, y: 790, w: 300, h: 260 },
    calendar: { x: 360, y: 40, w: 300, h: 300 },
    windows: { x: 360, y: 360, w: 300, h: 330 },
    timer: { x: 360, y: 710, w: 300, h: 190 },
    network: { x: 680, y: 40, w: 300, h: 250 },
    bluetooth: { x: 680, y: 310, w: 300, h: 220 },
    notifications: { x: 680, y: 550, w: 300, h: 300 },
    trash: { x: 680, y: 870, w: 300, h: 120 },
    battery: { x: 1000, y: 40, w: 300, h: 170 },
    power: { x: 1000, y: 230, w: 300, h: 200 },
    quick: { x: 1000, y: 450, w: 300, h: 240 },
    clipboard: { x: 1000, y: 710, w: 300, h: 280 },
    worldclock: { x: 1320, y: 40, w: 300, h: 220 },
    workspaces: { x: 1320, y: 280, w: 300, h: 170 },
    files: { x: 1320, y: 470, w: 300, h: 300 },
    games: { x: 1320, y: 790, w: 300, h: 260 },
    // The largest gap the other nineteen leave inside the 1620x1050 box: the
    // foot of the second column, under the timer. Short for a conversation -
    // the composer and a few lines - but a panel that starts clear of
    // everything else is worth more than one that starts the right height on
    // top of another module. Resizing is a drag; untangling an overlap is not.
    chat: { x: 360, y: 900, w: 300, h: 150 },

    // The larger modules added later, in four more columns from x=1640. That
    // is past the edge of a 1080p display and inside a 3440x1440 one; on a
    // display too small for it, switching one on moves it into free space
    // instead (see `findFreeSpot`), so the numbers here only have to be right
    // for the wide case.
    weather: { x: 1640, y: 40, w: 300, h: 360 },
    agenda: { x: 1640, y: 420, w: 300, h: 380 },
    alarms: { x: 1640, y: 820, w: 300, h: 330 },
    perf: { x: 1960, y: 40, w: 320, h: 380 },
    usage: { x: 1960, y: 440, w: 320, h: 360 },
    tray: { x: 1960, y: 820, w: 320, h: 150 },
    apps: { x: 2300, y: 40, w: 300, h: 460 },
    calc: { x: 2300, y: 520, w: 300, h: 500 },
    links: { x: 2620, y: 40, w: 300, h: 260 },
    habits: { x: 2620, y: 320, w: 300, h: 300 },
    board: { x: 2940, y: 40, w: 460, h: 440 },
    // Wide and tall enough for a page, under the board.
    browser: { x: 2940, y: 500, w: 460, h: 540 },
  };

export { findFreeSpot, isOffSurface, overlaps } from './layout';

/** Below this a panel cannot show its header and body at all. */
export const MIN_PANEL_SIZE = { w: 180, h: 90 };

export function panelId(kind: PanelKind): string {
  return `panel-${kind}`;
}

function defaultPanels(): DesktopPanel[] {
  return PANEL_KINDS.map((kind) => ({ id: panelId(kind), kind, ...DEFAULT_PANEL_LAYOUT[kind] }));
}

export function defaultMonitorState(): MonitorState {
  return { version: 1, wallpaper: { source: 'none' }, icons: [], panels: defaultPanels() };
}

/** Monitor ids come from hardware strings; keep them safe as filenames. */
function stateFilename(monitorId: string): string {
  const safe = monitorId.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
  return `monitor-${safe}.json`;
}

/**
 * Per-monitor desktop contents: wallpaper choice, icons and panel placement.
 *
 * Kept per monitor because both replicas share one data directory - writing to
 * a single file would have them overwrite each other - and because the whole
 * point is that each display keeps its own arrangement across replugs.
 */
export class DesktopStore {
  state = $state<MonitorState>(defaultMonitorState());

  #writer: ReturnType<typeof debouncedWriter> | null = null;
  #loaded = false;

  async load(monitorId: string): Promise<void> {
    const filename = stateFilename(monitorId);
    this.#writer = debouncedWriter(filename);
    const loaded = await readJson<MonitorState>(filename, defaultMonitorState());
    // Merge over defaults so a file written by an older build still yields a
    // complete state rather than undefined fields.
    const merged: MonitorState = { ...defaultMonitorState(), ...loaded };
    // A state file written before a module existed has no panel for it, which
    // would leave that module unreachable however its setting is toggled.
    for (const kind of PANEL_KINDS) {
      if (!merged.panels.some((panel) => panel.kind === kind)) {
        merged.panels.push({ id: panelId(kind), kind, ...DEFAULT_PANEL_LAYOUT[kind] });
      }
    }
    this.state = merged;
    this.#loaded = true;
  }

  /** Queues a debounced save. Safe to call on every drag frame. */
  save(): void {
    if (!this.#loaded || !this.#writer) return;
    this.#writer.queue($state.snapshot(this.state));
  }

  /** Writes any pending change immediately. */
  async flush(): Promise<void> {
    await this.#writer?.flush();
  }

  setWallpaper(choice: WallpaperChoice): void {
    this.state.wallpaper = choice;
    this.save();
  }

  addIcon(icon: Omit<DesktopIcon, 'id'>): DesktopIcon {
    const created: DesktopIcon = { ...icon, id: newId('icon') };
    this.state.icons.push(created);
    this.save();
    return created;
  }

  removeIcon(id: string): void {
    this.state.icons = this.state.icons.filter((i) => i.id !== id);
    this.save();
  }

  moveItem(id: string, x: number, y: number): void {
    const icon = this.state.icons.find((i) => i.id === id);
    if (icon) {
      icon.x = x;
      icon.y = y;
      this.save();
      return;
    }
    const panel = this.state.panels.find((p) => p.id === id);
    if (panel) {
      panel.x = x;
      panel.y = y;
      this.save();
    }
  }

  resizePanel(id: string, w: number, h: number): void {
    const panel = this.state.panels.find((p) => p.id === id);
    if (!panel) return;
    panel.w = Math.max(MIN_PANEL_SIZE.w, Math.round(w));
    panel.h = Math.max(MIN_PANEL_SIZE.h, Math.round(h));
    this.save();
  }

  /** Moves a panel without marking a drag; used when placing one in free space. */
  placePanel(id: string, x: number, y: number): void {
    const panel = this.state.panels.find((p) => p.id === id);
    if (!panel) return;
    panel.x = Math.round(x);
    panel.y = Math.round(y);
    this.save();
  }

  /** Returns a panel to its first-run size, position, or both. */
  resetPanel(id: string, what: 'size' | 'position' | 'both' = 'both'): void {
    const panel = this.state.panels.find((p) => p.id === id);
    if (!panel) return;
    const defaults = DEFAULT_PANEL_LAYOUT[panel.kind];
    if (what !== 'position') {
      panel.w = defaults.w;
      panel.h = defaults.h;
    }
    if (what !== 'size') {
      panel.x = defaults.x;
      panel.y = defaults.y;
    }
    this.save();
  }
}

export const store = new DesktopStore();
