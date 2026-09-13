import type { ProviderId } from './providers';
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
  fontSize: number;
  titleStyle: 'caps' | 'plain' | 'hidden';

  followTheme: boolean;
  surfaceHue: number;
  surfaceChroma: number;
  panelOpacity: number;
  panelBlur: number;
  panelBorder: number;
  panelShadow: 'none' | 'soft' | 'medium' | 'deep';
  panelTexture: boolean;
  cornerRadius: number;
  density: 'compact' | 'cosy' | 'roomy';
  iconRadius: number;
  accentColor: string;
  animations: boolean;
  styleShell: boolean;

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
  fontSize: 14,
  titleStyle: 'caps',
  followTheme: true,
  surfaceHue: 240,
  surfaceChroma: 0,
  panelOpacity: 60,
  panelBlur: 20,
  panelBorder: 34,
  panelShadow: 'soft',
  panelTexture: true,
  cornerRadius: 16,
  density: 'cosy',
  iconRadius: 10,
  accentColor: '#7aa2f7',
  animations: true,
  styleShell: true,
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
    this.current = { ...this.current, [key]: value };
    if (target === 'monitor') this.overrides = new Set(this.overrides).add(key);
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
      this.current = { ...this.#hostConfig, ...Object.fromEntries(this.#pending) };
      this.overrides = this.#readOverrides(settings.inner as unknown as RawSettings);
    } catch (err) {
      console.error('[config] could not read widget settings; keeping current values', err);
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
