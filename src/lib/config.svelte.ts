import type { PadLayout } from './gamepad';
import type { TranslationPreset } from './padkeys';
import type { ProviderId } from './providers';
import type { SchemeId } from './schemes';
import { noteError } from './diagnostics';
import {
  SeelenCommand,
  SeelenEvent,
  Settings,
  Widget,
  invoke,
  subscribe,
  type UnSubscriber,
} from './seelen';

/**
 * The widget's settings, as declared in `metadata.yml` and edited in Seelen's
 * own Settings window — or, now, from the surface's own context menus.
 *
 * Values arrive already merged by the host: widget defaults, then the user's
 * values, then the per-monitor patch for this replica. That is why anything
 * marked `allowSetByMonitor` simply works here with no extra handling.
 */
export interface DesktopConfig {
  enabled: boolean;

  gridSize: number;
  snapToGrid: boolean;
  lockLayout: boolean;
  iconSize: number;
  labelMode: 'always' | 'hover' | 'never';

  fontFamily: string;
  displayFont: string;
  /** Code, the calculator's tape and anything else set in a fixed pitch. */
  monoFont: string;
  fontSize: number;
  fontWeight: number;
  /** The clock, the timer and every other big number. */
  displayWeight: number;
  /** Hundredths of an em, so it scales with the text it spaces. */
  letterSpacing: number;
  textShadow: boolean;
  titleStyle: 'caps' | 'plain' | 'lower' | 'hidden';
  titleDecor: 'none' | 'bracket' | 'underline' | 'tab' | 'bar' | 'dot';
  titleAlign: 'left' | 'center' | 'right';
  titleWeight: number;

  followTheme: boolean;
  /** A named palette that remaps Seelen's colour ramp; `theme` leaves it alone. See `schemes.ts`. */
  colorScheme: SchemeId;
  /** The two colours a `custom` scheme is mixed from. */
  schemeGround: string;
  schemeInk: string;
  /** Take the accents from the scheme rather than from the pickers below. */
  schemeAccent: boolean;
  surfaceHue: number;
  surfaceChroma: number;
  panelOpacity: number;
  panelBlur: number;
  /** Percent; 100 leaves the backdrop's colour as it is. */
  backdropSaturation: number;
  panelBorder: number;
  panelBorderWidth: number;
  panelBorderStyle: 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'inset' | 'outset';
  panelBorderColor: 'neutral' | 'ink' | 'accent' | 'gradient';
  /** Turns a gradient edge slowly round the panel. */
  borderAnimation: boolean;
  panelShadow: 'none' | 'soft' | 'medium' | 'deep' | 'hard' | 'block' | 'glow';
  panelFill: 'flat' | 'gradient' | 'accent';
  panelTexture: boolean;
  cornerRadius: number;
  panelPadding: number;
  /** The light that follows the pointer across a panel. */
  panelGlow: boolean;
  density: 'compact' | 'cosy' | 'roomy';
  /** How round every button, field, chip and track is, independent of the panel corners. */
  controlShape: 'square' | 'subtle' | 'rounded' | 'round' | 'pill';
  iconRadius: number;
  iconLabelStyle: 'shadow' | 'pill' | 'plain';
  barThickness: number;
  barStyle: 'solid' | 'gradient' | 'striped' | 'glow';
  scrollbars: 'thin' | 'hidden' | 'auto';
  accentColor: string;
  accentColor2: string;
  animations: boolean;
  /** Percent of the tuned durations: 200 takes twice as long. */
  motionScale: number;
  staggerScale: number;
  entranceStyle: 'rise' | 'fade' | 'zoom' | 'drop' | 'slide' | 'blur' | 'none';
  styleShell: boolean;
  /** A stylesheet of the user's own, applied after everything else. */
  customCss: string;

  wallpaperEnabled: boolean;
  wallpaperFit: 'cover' | 'contain' | 'fill' | 'none';
  wallpaperBlur: number;
  wallpaperSaturation: number;
  wallpaperBrightness: number;
  wallpaperOverlayColor: string;
  wallpaperOverlayOpacity: number;
  wallpaperMuted: boolean;
  wallpaperPauseWhenCovered: boolean;
  slideshowEnabled: boolean;
  slideshowInterval: number;
  slideshowRandomize: boolean;

  moduleClock: boolean;
  moduleMedia: boolean;
  moduleSysmon: boolean;
  moduleNotes: boolean;
  moduleCalendar: boolean;
  moduleWorldClock: boolean;
  moduleTimer: boolean;
  moduleBattery: boolean;
  modulePower: boolean;
  moduleQuick: boolean;
  moduleWindows: boolean;
  moduleWorkspaces: boolean;
  moduleNetwork: boolean;
  moduleBluetooth: boolean;
  moduleNotifications: boolean;
  moduleClipboard: boolean;
  moduleTrash: boolean;
  moduleFiles: boolean;
  moduleGames: boolean;
  moduleChat: boolean;
  moduleWeather: boolean;
  moduleAgenda: boolean;
  moduleAlarms: boolean;
  modulePerf: boolean;
  moduleUsage: boolean;
  moduleApps: boolean;
  moduleBoard: boolean;
  moduleHabits: boolean;
  moduleCalc: boolean;
  moduleTray: boolean;
  moduleLinks: boolean;
  moduleBrowser: boolean;

  clock24h: boolean;
  clockShowSeconds: boolean;
  clockShowDate: boolean;

  mediaShowArt: boolean;
  mediaShowVisualiser: boolean;
  mediaShowMixer: boolean;

  sysmonCpu: boolean;
  sysmonRam: boolean;
  sysmonDisk: boolean;
  sysmonNet: boolean;

  notesDefaultTab: 'todo' | 'note';
  notesHideCompleted: boolean;

  calendarStartMonday: boolean;
  calendarWeekNumbers: boolean;
  calendarHighlightWeekend: boolean;

  /** Comma-separated IANA zone names, e.g. `Europe/London, Asia/Tokyo`. */
  worldClockZones: string;
  worldClock24h: boolean;
  worldClockOffsets: boolean;

  timerWorkMinutes: number;
  timerBreakMinutes: number;
  timerChime: boolean;
  timerAutoContinue: boolean;

  batteryShowRate: boolean;
  batteryShowHealth: boolean;
  batteryShowPowerMode: boolean;

  powerConfirm: boolean;
  powerShowSleep: boolean;
  powerShowHibernate: boolean;
  powerShowShutdown: boolean;

  quickBrightness: boolean;
  quickRadios: boolean;
  quickFocusAssist: boolean;

  windowsThisDisplayOnly: boolean;
  windowsGroupByApp: boolean;
  windowsShowIcons: boolean;
  windowsHideMinimised: boolean;

  workspacesShowNames: boolean;
  workspacesShowCounts: boolean;
  workspacesShowControls: boolean;

  networkShowIp: boolean;
  networkShowWifi: boolean;
  networkShowAdapters: boolean;

  bluetoothPairedOnly: boolean;
  bluetoothShowRadio: boolean;

  notificationsShowBody: boolean;
  notificationsShowApp: boolean;
  notificationsShowControls: boolean;
  notificationsMax: number;

  clipboardShowSource: boolean;
  clipboardShowImages: boolean;
  clipboardPasteOnClick: boolean;
  clipboardMax: number;

  trashConfirmEmpty: boolean;

  filesFolder: 'Recent' | 'Downloads' | 'Documents' | 'Pictures' | 'Music' | 'Videos' | 'Desktop';
  filesView: 'list' | 'grid';
  filesTileSize: number;
  filesSort: 'name' | 'type';
  filesShowSearch: boolean;
  filesMax: number;
  filesShowIcons: boolean;

  gamesAutoDetect: boolean;
  gamesDeepScan: boolean;
  gamesScanRunning: boolean;
  gamesTrackPlaytime: boolean;
  gamesLayout: 'grid' | 'list' | 'shelf';
  gamesTileSize: number;
  gamesArtShape: 'square' | 'portrait' | 'wide';
  gamesArtStyle: 'auto' | 'icon' | 'plain';
  gamesLabelMode: 'always' | 'hover' | 'never';
  gamesSort: 'recent' | 'name' | 'played' | 'launcher';
  gamesGroupByLauncher: boolean;
  gamesFavouritesFirst: boolean;
  gamesShowSearch: boolean;
  gamesShowLauncher: boolean;
  gamesShowStats: boolean;
  gamesShowRunning: boolean;
  gamesHoverZoom: boolean;
  gamesShowMissing: boolean;

  /**
   * The display game mode takes over, by monitor id; blank means the primary
   * one. Not `allowSetByMonitor`: every replica has to agree which of them owns
   * the launcher, and a per-display override is exactly how two of them would
   * come to disagree.
   */
  gameModeDisplay: string;
  /** Switch the chosen display into the launcher as soon as the surface starts. */
  gameModeAtStart: boolean;
  gameModeLayout: 'shelf' | 'grid' | 'wall';
  gameModeTileSize: number;
  gameModeArtShape: 'square' | 'portrait' | 'wide';
  /** How a tile is faced. Every tile shares one surface; this is what is on it. */
  gameModeArtStyle: 'icon' | 'cover' | 'plain';
  /** What fills the screen behind the shelves. */
  gameModeBackdrop: 'art' | 'wallpaper' | 'plain';
  gameModeBackdropDim: number;
  gameModeBackdropBlur: number;
  gameModeShowHero: boolean;
  gameModeShowClock: boolean;
  /** The row of button hints along the bottom. */
  gameModeShowLegend: boolean;
  gameModeShowStats: boolean;
  /** The AI-written one-liner, where the library has one. See `blurb.ts`. */
  gameModeShowBlurb: boolean;
  gameModeShowSearch: boolean;
  gameModeRecentCount: number;
  gameModeSort: 'recent' | 'name' | 'played' | 'launcher';
  gameModeFavouritesFirst: boolean;
  gameModeShowApps: boolean;
  gameModeShowPower: boolean;
  /** What a launch does to the launcher itself. */
  gameModeOnLaunch: 'stay' | 'leave';
  /** Take the keyboard back when something else grabs it; see `gamemode.svelte.ts`. */
  gameModeKeepFocus: boolean;
  gameModeHideCursor: boolean;
  gameModeAnimate: boolean;

  padEnabled: boolean;
  /** Which family's glyphs the hints are drawn with. */
  padLayout: PadLayout;
  /** `action=button` pairs; blank is the console default. See `gamepad.ts`. */
  padBindings: string;
  /** Percent, so it can be a slider; 25 is a quarter of the stick's travel. */
  padDeadzone: number;
  /** Hundredths: 160 is an exponent of 1.6, which sharpens the centre. */
  padCurve: number;
  padStickNavigates: boolean;
  padStickThreshold: number;
  padRepeatDelay: number;
  padRepeatInterval: number;
  padRepeatMin: number;
  padTriggerThreshold: number;
  padRumble: boolean;
  padRumbleStrength: number;

  /** Let the pad drive the ordinary desktop, not only game mode. */
  padDesktop: boolean;
  padPreset: TranslationPreset;
  /** `button=key` pairs applied over the preset. See `padkeys.ts`. */
  padCustomKeys: string;
  padPointer: boolean;
  padPointerSpeed: number;
  padPointerAccel: number;
  padPointerSize: number;
  /** Seconds of stillness before the drawn pointer fades; 0 keeps it. */
  padPointerHide: number;
  padStickScrolls: boolean;
  padScrollSpeed: number;

  /** Which service answers. The API key itself is not a setting - see `chat.svelte.ts`. */
  chatProvider: ProviderId;
  /** Blank follows the provider's own default. */
  chatModel: string;
  chatSystemPrompt: string;
  chatStream: boolean;
  /** Let the assistant pick the model per question, and fail over when one is down. */
  chatRouting: boolean;
  /** Let the assistant read and control this PC. */
  chatTools: boolean;
  /** Prepend a short description of the machine to every turn. */
  chatContext: boolean;

  /** The label of a place, e.g. `Berlin, Germany`; blank asks in the panel. */
  weatherPlace: string;
  weatherUnits: 'metric' | 'imperial';
  weatherDays: number;
  weatherShowHourly: boolean;
  weatherShowDetails: boolean;

  agendaDaysAhead: number;
  agendaShowWeek: boolean;
  agendaReminders: boolean;
  /** Minutes before, as a string so it can be a select; `none` for no reminder. */
  agendaDefaultRemind: 'none' | '0' | '5' | '10' | '15' | '30' | '60';
  agendaMonthFirst: boolean;

  alarmsDefaultTab: 'timers' | 'stopwatch' | 'alarms';
  alarmsRings: number;
  alarmsVolume: number;
  alarms24h: boolean;

  perfDefaultTab: 'cpu' | 'memory' | 'disk' | 'network';
  perfShowCores: boolean;
  perfFillGraph: boolean;
  perfShowGrid: boolean;

  usageIdleMinutes: number;
  usageShowWeek: boolean;
  usageMax: number;
  /** Comma-separated application names that are never counted. */
  usageIgnore: string;

  appsView: 'list' | 'grid';
  appsShowFavourites: boolean;
  appsShowRecent: boolean;
  appsShowAll: boolean;
  appsTileSize: number;

  boardColumnWidth: number;
  boardShowDue: boolean;
  boardShowNotes: boolean;
  boardCompact: boolean;

  habitsDays: number;
  habitsShowStreak: boolean;
  habitsShowHeatmap: boolean;

  calcShowKeypad: boolean;
  calcAngle: 'deg' | 'rad';
  calcPrecision: number;
  calcGrouping: boolean;

  trayIconSize: number;
  trayShowLabels: boolean;
  trayShowHidden: boolean;

  linksEngine: 'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage' | 'ecosia' | 'kagi';
  linksShowSearch: boolean;
  linksShowLabels: boolean;
  linksTileSize: number;

  browserReader: boolean;
  browserShowNav: boolean;
  browserZoom: number;
}

export type ConfigKey = keyof DesktopConfig;

/**
 * Mirrors `metadata.yml`. Used until the host's values arrive, and as the
 * fallback for any key a future host version does not return.
 */
export const DEFAULT_CONFIG: DesktopConfig = {
  enabled: true,
  gridSize: 96,
  snapToGrid: true,
  lockLayout: false,
  iconSize: 48,
  labelMode: 'always',
  fontFamily: '',
  displayFont: '',
  monoFont: '',
  fontSize: 14,
  fontWeight: 400,
  displayWeight: 200,
  letterSpacing: 0,
  textShadow: false,
  titleStyle: 'caps',
  titleDecor: 'none',
  titleAlign: 'left',
  titleWeight: 600,
  followTheme: true,
  colorScheme: 'theme',
  schemeGround: '#1e1e2e',
  schemeInk: '#cdd6f4',
  schemeAccent: true,
  surfaceHue: 240,
  surfaceChroma: 0,
  panelOpacity: 60,
  panelBlur: 20,
  backdropSaturation: 100,
  panelBorder: 34,
  panelBorderWidth: 1,
  panelBorderStyle: 'solid',
  panelBorderColor: 'neutral',
  borderAnimation: false,
  panelShadow: 'soft',
  panelFill: 'flat',
  panelTexture: true,
  cornerRadius: 16,
  panelPadding: 12,
  panelGlow: true,
  density: 'cosy',
  controlShape: 'rounded',
  iconRadius: 10,
  iconLabelStyle: 'shadow',
  barThickness: 4,
  barStyle: 'solid',
  scrollbars: 'thin',
  accentColor: '#7aa2f7',
  accentColor2: '#bb9af7',
  animations: true,
  motionScale: 100,
  staggerScale: 100,
  entranceStyle: 'rise',
  styleShell: true,
  customCss: '',
  wallpaperEnabled: true,
  wallpaperFit: 'cover',
  wallpaperBlur: 0,
  wallpaperSaturation: 100,
  wallpaperBrightness: 100,
  wallpaperOverlayColor: '#000000',
  wallpaperOverlayOpacity: 0,
  wallpaperMuted: true,
  wallpaperPauseWhenCovered: true,
  slideshowEnabled: false,
  slideshowInterval: 300,
  slideshowRandomize: true,
  moduleClock: true,
  moduleMedia: true,
  moduleSysmon: true,
  moduleNotes: true,
  // Everything added after the first four is off until the user asks for it:
  // eighteen panels at once is not a desktop, and a module that is off costs
  // nothing at all - its panel never renders, so it never subscribes.
  moduleCalendar: false,
  moduleWorldClock: false,
  moduleTimer: false,
  moduleBattery: false,
  modulePower: false,
  moduleQuick: false,
  moduleWindows: false,
  moduleWorkspaces: false,
  moduleNetwork: false,
  moduleBluetooth: false,
  moduleNotifications: false,
  moduleClipboard: false,
  moduleTrash: false,
  moduleFiles: false,
  moduleGames: false,
  moduleChat: false,
  moduleWeather: false,
  moduleAgenda: false,
  moduleAlarms: false,
  modulePerf: false,
  moduleUsage: false,
  moduleApps: false,
  moduleBoard: false,
  moduleHabits: false,
  moduleCalc: false,
  moduleTray: false,
  moduleLinks: false,
  moduleBrowser: false,
  clock24h: true,
  clockShowSeconds: false,
  clockShowDate: true,
  mediaShowArt: true,
  mediaShowVisualiser: true,
  mediaShowMixer: true,
  sysmonCpu: true,
  sysmonRam: true,
  sysmonDisk: false,
  sysmonNet: true,
  notesDefaultTab: 'todo',
  notesHideCompleted: false,
  calendarStartMonday: true,
  calendarWeekNumbers: false,
  calendarHighlightWeekend: true,
  worldClockZones: 'UTC, Europe/London, America/New_York, Asia/Tokyo',
  worldClock24h: true,
  worldClockOffsets: true,
  timerWorkMinutes: 25,
  timerBreakMinutes: 5,
  timerChime: true,
  timerAutoContinue: false,
  batteryShowRate: true,
  batteryShowHealth: false,
  batteryShowPowerMode: true,
  powerConfirm: true,
  powerShowSleep: true,
  powerShowHibernate: false,
  powerShowShutdown: true,
  quickBrightness: true,
  quickRadios: true,
  quickFocusAssist: true,
  windowsThisDisplayOnly: true,
  windowsGroupByApp: false,
  windowsShowIcons: true,
  windowsHideMinimised: false,
  workspacesShowNames: true,
  workspacesShowCounts: true,
  workspacesShowControls: true,
  networkShowIp: true,
  networkShowWifi: true,
  networkShowAdapters: false,
  bluetoothPairedOnly: true,
  bluetoothShowRadio: true,
  notificationsShowBody: true,
  notificationsShowApp: true,
  notificationsShowControls: true,
  notificationsMax: 8,
  clipboardShowSource: true,
  clipboardShowImages: true,
  clipboardPasteOnClick: false,
  clipboardMax: 15,
  trashConfirmEmpty: true,
  filesFolder: 'Recent',
  filesView: 'list',
  filesTileSize: 64,
  filesSort: 'name',
  filesShowSearch: true,
  filesMax: 30,
  filesShowIcons: true,
  gamesAutoDetect: true,
  gamesDeepScan: true,
  gamesScanRunning: true,
  gamesTrackPlaytime: true,
  gamesLayout: 'grid',
  gamesTileSize: 72,
  gamesArtShape: 'square',
  gamesArtStyle: 'auto',
  gamesLabelMode: 'always',
  gamesSort: 'recent',
  gamesGroupByLauncher: false,
  gamesFavouritesFirst: true,
  gamesShowSearch: true,
  gamesShowLauncher: true,
  gamesShowStats: true,
  gamesShowRunning: true,
  gamesHoverZoom: true,
  gamesShowMissing: false,
  gameModeDisplay: '',
  gameModeAtStart: false,
  gameModeLayout: 'shelf',
  gameModeTileSize: 200,
  gameModeArtShape: 'square',
  gameModeArtStyle: 'icon',
  gameModeBackdrop: 'wallpaper',
  gameModeBackdropDim: 62,
  gameModeBackdropBlur: 40,
  gameModeShowHero: true,
  gameModeShowClock: true,
  gameModeShowLegend: true,
  gameModeShowStats: true,
  gameModeShowBlurb: true,
  gameModeShowSearch: true,
  gameModeRecentCount: 12,
  gameModeSort: 'recent',
  gameModeFavouritesFirst: true,
  gameModeShowApps: true,
  gameModeShowPower: true,
  gameModeOnLaunch: 'stay',
  gameModeKeepFocus: true,
  gameModeHideCursor: true,
  gameModeAnimate: true,
  padEnabled: true,
  padLayout: 'auto',
  padBindings: '',
  padDeadzone: 25,
  padCurve: 160,
  padStickNavigates: true,
  padStickThreshold: 55,
  padRepeatDelay: 420,
  padRepeatInterval: 140,
  padRepeatMin: 60,
  padTriggerThreshold: 50,
  padRumble: true,
  padRumbleStrength: 35,
  // Off by default: it holds the keyboard away from whatever the user is
  // actually working in, which is only what they want once they have asked.
  padDesktop: false,
  padPreset: 'navigation',
  padCustomKeys: '',
  padPointer: true,
  padPointerSpeed: 1100,
  padPointerAccel: 190,
  padPointerSize: 22,
  padPointerHide: 3,
  padStickScrolls: true,
  padScrollSpeed: 14,
  chatProvider: 'ollama',
  chatModel: '',
  // A panel this size rewards a model that answers rather than one that opens
  // with a paragraph about what it is about to do. The agent's working rules
  // are added by the store; this is only the voice.
  chatSystemPrompt: 'Be concise and direct. Use Markdown only where it helps.',
  chatStream: true,
  chatRouting: true,
  chatTools: true,
  chatContext: true,
  weatherPlace: '',
  weatherUnits: 'metric',
  weatherDays: 7,
  weatherShowHourly: true,
  weatherShowDetails: true,
  agendaDaysAhead: 14,
  agendaShowWeek: true,
  agendaReminders: true,
  agendaDefaultRemind: '10',
  agendaMonthFirst: false,
  alarmsDefaultTab: 'timers',
  alarmsRings: 6,
  alarmsVolume: 60,
  alarms24h: true,
  perfDefaultTab: 'cpu',
  perfShowCores: true,
  perfFillGraph: true,
  perfShowGrid: true,
  usageIdleMinutes: 5,
  usageShowWeek: true,
  usageMax: 8,
  usageIgnore: '',
  appsView: 'list',
  appsShowFavourites: true,
  appsShowRecent: true,
  appsShowAll: true,
  appsTileSize: 48,
  boardColumnWidth: 200,
  boardShowDue: true,
  boardShowNotes: true,
  boardCompact: false,
  habitsDays: 7,
  habitsShowStreak: true,
  habitsShowHeatmap: true,
  calcShowKeypad: true,
  calcAngle: 'deg',
  calcPrecision: 10,
  calcGrouping: true,
  trayIconSize: 24,
  trayShowLabels: false,
  trayShowHidden: true,
  linksEngine: 'google',
  linksShowSearch: true,
  linksShowLabels: true,
  linksTileSize: 44,
  browserReader: false,
  browserShowNav: true,
  browserZoom: 100,
};

/**
 * Where a written value should land.
 *
 * - `monitor` — this display only, as a per-monitor patch.
 * - `all` — every display: writes the root value *and* drops the key from
 *   every monitor patch, because a leftover override would otherwise keep the
 *   old value on the display that has it.
 * - `auto` — follow the key's current source: update the override if this
 *   display already has one, otherwise write for every display. Used by the
 *   one-click toggles in the context menus, so a click neither silently
 *   creates an override nor silently discards one.
 */
export type SettingScope = 'monitor' | 'all' | 'auto';

/**
 * A widget's stored settings are a free-form bag beside a few known keys.
 *
 * The generated types key these maps by branded widget and monitor ids, which
 * a runtime string cannot index; this is the same shape with plain string keys,
 * and it is all the settings tree we touch.
 */
type SettingsPatch = Record<string, unknown>;

interface RawMonitor {
  byWidget: Record<string, SettingsPatch | undefined>;
}

interface RawSettings {
  byWidget: Record<string, SettingsPatch | undefined>;
  monitorsV3: Record<string, RawMonitor | undefined>;
}

type QueuedWrite =
  | { op: 'set'; key: ConfigKey; value: unknown; scope: Exclude<SettingScope, 'auto'> }
  | { op: 'clear'; key: ConfigKey };

function sameKeys(a: ReadonlySet<ConfigKey>, b: ReadonlySet<ConfigKey>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** Only real config keys; `$instances`, `$shortcuts` and unknowns are not ours. */
function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(DEFAULT_CONFIG, key);
}

class ConfigStore {
  /** The effective config for this replica, with un-flushed local edits applied. */
  current = $state<DesktopConfig>({ ...DEFAULT_CONFIG });

  /** Keys this display pins for itself, rather than inheriting. */
  overrides = $state<Set<ConfigKey>>(new Set());

  /** The last config the host reported, before any local edit. */
  #hostConfig: DesktopConfig = { ...DEFAULT_CONFIG };
  /** Edits applied locally but not yet echoed back by the host. */
  #pending = new Map<ConfigKey, unknown>();
  /** Writes waiting to be flushed, coalesced by key. */
  #queue = new Map<ConfigKey, QueuedWrite>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<void> = Promise.resolve();

  /** Loads the merged config and keeps it live as the user edits settings. */
  async start(): Promise<UnSubscriber> {
    await this.#refresh();
    return subscribe(SeelenEvent.StateSettingsChanged, () => {
      void this.#refresh();
    });
  }

  /** True when this display pins its own value for `key`. */
  isOverridden(key: ConfigKey): boolean {
    return this.overrides.has(key);
  }

  /**
   * Changes one setting.
   *
   * The new value shows immediately and is written on a short debounce, so
   * dragging a slider does not rewrite the whole settings file per frame.
   */
  set<K extends ConfigKey>(key: K, value: DesktopConfig[K], scope: SettingScope = 'auto'): void {
    const target = scope === 'auto' ? (this.isOverridden(key) ? 'monitor' : 'all') : scope;
    this.#pending.set(key, value);
    // In place, so only what reads this one key updates. Replacing the object
    // re-ran every module on the surface for every tick of a dragged slider.
    this.current[key] = value;
    if (target === 'monitor' && !this.overrides.has(key)) {
      this.overrides = new Set(this.overrides).add(key);
    }
    this.#queue.set(key, { op: 'set', key, value, scope: target });
    this.#schedule();
  }

  /** Flips a boolean setting. */
  toggle(key: ConfigKey, scope: SettingScope = 'auto'): void {
    const value = this.current[key];
    if (typeof value !== 'boolean') return;
    this.set(key as never, !value as never, scope);
  }

  /** Drops this display's own value for `key`, so it follows the others again. */
  clearOverride(key: ConfigKey): void {
    if (!this.isOverridden(key)) return;
    this.#pending.delete(key);
    const next = new Set(this.overrides);
    next.delete(key);
    this.overrides = next;
    this.#queue.set(key, { op: 'clear', key });
    this.#schedule(0);
  }

  clearOverrides(keys: readonly ConfigKey[]): void {
    for (const key of keys) this.clearOverride(key);
  }

  /** Writes any queued change immediately. */
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#write();
    }
    await this.#inFlight;
  }

  #schedule(delayMs = 220): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#write();
    }, delayMs);
  }

  /** Applies every queued change to one freshly read copy of the settings. */
  #write(): void {
    const writes = [...this.#queue.values()];
    this.#queue.clear();
    if (!writes.length) return;
    let failed = false;

    this.#inFlight = this.#inFlight
      .then(async () => {
        // Re-read rather than reuse a cached copy: the host rewrites the whole
        // settings file, so anything stale here would be written back with it.
        const settings = await Settings.getAsync();
        const raw = settings.inner as unknown as RawSettings;
        const widgetId = Widget.self.id as string;
        const monitorId = Widget.self.decoded.monitorId;

        const root = (raw.byWidget[widgetId] ??= { enabled: true });

        let cleared = false;

        for (const write of writes) {
          if (write.op === 'clear') {
            const patch = monitorId ? raw.monitorsV3[monitorId]?.byWidget[widgetId] : undefined;
            delete patch?.[write.key];
            cleared = true;
            continue;
          }

          if (write.scope === 'monitor' && monitorId) {
            const patch = await this.#monitorPatch(raw, widgetId, monitorId);
            patch[write.key] = write.value;
            continue;
          }

          root[write.key] = write.value;
          if (write.scope === 'all') {
            // A surviving per-monitor value would keep the old setting on the
            // display that has it, which is not what "all displays" means.
            for (const monitor of Object.values(raw.monitorsV3)) {
              delete monitor?.byWidget[widgetId]?.[write.key];
            }
          }
        }

        // A patch left holding nothing but the `enabled` it had to carry is not
        // an override any more; drop it so the display is plainly inheriting.
        if (cleared && monitorId) {
          const patch = raw.monitorsV3[monitorId]?.byWidget[widgetId];
          const rootEnabled = root.enabled ?? true;
          const keys = Object.keys(patch ?? {});
          if (patch && keys.length <= 1 && patch.enabled === rootEnabled) {
            delete raw.monitorsV3[monitorId]?.byWidget[widgetId];
          }
        }

        await settings.save();
      })
      .catch((err) => {
        console.error('[config] could not save widget settings', err);
        noteError(`settings write failed: ${err instanceof Error ? err.message : String(err)}`);
        failed = true;
      })
      .finally(async () => {
        for (const write of writes) this.#pending.delete(write.key);
        // Never leave a tick or a slider showing a value the host does not
        // have; re-reading is what puts the surface back in step.
        if (failed) await this.#refresh();
      });
  }

  /** This widget's per-monitor patch, created on first write. */
  async #monitorPatch(
    raw: RawSettings,
    widgetId: string,
    monitorId: string,
  ): Promise<SettingsPatch> {
    let monitor = raw.monitorsV3[monitorId];
    if (!monitor) {
      // Ask the host for the shape rather than inventing one: a monitor entry
      // also carries workspace configuration we have no business guessing at.
      const created = await invoke(SeelenCommand.StateGetDefaultMonitorSettings);
      monitor = created as unknown as RawMonitor;
      raw.monitorsV3[monitorId] = monitor;
    }
    // `enabled` must be carried into the patch. It looks like something to
    // leave out - the patch is merged over the root values, so an absent key
    // should mean "inherit" - but the host reads a widget's monitor settings
    // into a struct where `enabled` is a plain bool, so a patch without it
    // comes back as `enabled: false` and the whole surface disappears from
    // that display. Verified: hiding one module wrote `{ moduleMedia: false }`
    // and the file came back holding `{ enabled: false, moduleMedia: false }`.
    const patch = (monitor.byWidget[widgetId] ??= {});
    patch.enabled ??= raw.byWidget[widgetId]?.enabled ?? true;
    return patch;
  }

  async #refresh(): Promise<void> {
    try {
      const settings = await Settings.getAsync();
      const merged = settings.getCurrentWidgetConfig();
      // Spread over the defaults so a key the host does not know about still
      // has a usable value rather than becoming undefined.
      this.#hostConfig = { ...DEFAULT_CONFIG, ...(merged as Partial<DesktopConfig>) };
      // Keep un-written edits on top, so a settings change from elsewhere
      // cannot make a slider jump back mid-drag.
      this.#assign({ ...this.#hostConfig, ...Object.fromEntries(this.#pending) } as DesktopConfig);
      const overrides = this.#readOverrides(settings.inner as unknown as RawSettings);
      if (!sameKeys(overrides, this.overrides)) this.overrides = overrides;
    } catch (err) {
      console.error('[config] could not read widget settings; keeping current values', err);
    }
  }

  /**
   * Writes only the keys whose value actually changed.
   *
   * The host broadcasts `settings-changed` for *any* write to the settings
   * file - this widget's own, the shell-style sync, the glass tint, the other
   * display's - and this used to answer each one with a brand-new config
   * object. Every module on both displays then re-rendered after every write,
   * including the writes its own slider had just caused. Assigning per key
   * leaves a change nobody reads costing nothing at all.
   */
  #assign(next: DesktopConfig): void {
    const target = this.current as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(next)) {
      if (!Object.is(target[key], value)) target[key] = value;
    }
  }

  #readOverrides(raw: RawSettings): Set<ConfigKey> {
    const monitorId = Widget.self.decoded.monitorId;
    const patch = monitorId ? raw.monitorsV3[monitorId]?.byWidget[Widget.self.id as string] : null;
    const keys = new Set<ConfigKey>();
    for (const key of Object.keys(patch ?? {})) {
      // `enabled` is the host's own switch for the widget on this display and
      // every patch has to carry it, so it is never one of our overrides.
      if (key !== 'enabled' && isConfigKey(key)) keys.add(key);
    }
    // A queued write is already true even though the host has not stored it.
    for (const write of this.#queue.values()) {
      if (write.op === 'clear') keys.delete(write.key);
      else if (write.scope === 'monitor') keys.add(write.key);
      else keys.delete(write.key);
    }
    return keys;
  }
}

export const config = new ConfigStore();
