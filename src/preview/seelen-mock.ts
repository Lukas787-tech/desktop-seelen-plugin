/**
 * A stand-in for `src/lib/seelen.ts`, used only by the preview build.
 *
 * The preview's Vite config loads this file in place of the real one, so every
 * store and module reaches "the host" through here instead of Tauri. Nothing
 * in `src/lib` or `src/modules` knows the difference, which is the point: the
 * screenshots show the real components, laid out by the real panel chrome,
 * with plausible values in place of this machine's.
 *
 * The fixtures below are invented. They are shaped exactly like the host's own
 * payloads (see `@seelen-ui/lib/types`), but no number here was measured.
 */

export { SeelenCommand, SeelenEvent } from '@seelen-ui/lib';
import { SeelenCommand, SeelenEvent } from '@seelen-ui/lib';

export type UnSubscriber = () => void;

const GB = 1024 ** 3;

/** Twelve cores at a believable spread of loads. */
const cores = Array.from({ length: 12 }, (_, i) => ({
  name: `cpu${i}`,
  brand: 'AMD Ryzen 5 5600X',
  usage: [18, 42, 9, 27, 63, 12, 31, 8, 22, 47, 15, 11][i] ?? 20,
  frequency: 3700,
}));

const memory = { total: 32 * GB, free: 12.4 * GB, swapTotal: 8 * GB, swapFree: 7.1 * GB };

const disks = [
  {
    name: 'Samsung SSD 980 PRO',
    fileSystem: 'NTFS',
    totalSpace: 1000 * GB,
    availableSpace: 284 * GB,
    mountPoint: 'C:',
    isRemovable: false,
    readBytes: 0,
    writtenBytes: 0,
  },
  {
    name: 'WDC WD40EZAZ',
    fileSystem: 'NTFS',
    totalSpace: 4000 * GB,
    availableSpace: 1620 * GB,
    mountPoint: 'D:',
    isRemovable: false,
    readBytes: 0,
    writtenBytes: 0,
  },
];

const network = [
  {
    name: 'Ethernet',
    received: 8_400_000_000,
    transmitted: 1_120_000_000,
    packetsReceived: 0,
    packetsTransmitted: 0,
  },
];

const mediaPlayers = [
  {
    umid: 'Spotify.exe',
    title: 'Weightless',
    author: 'Marconi Union',
    thumbnail: null,
    owner: { name: 'Spotify' },
    timeline: {
      start: 0,
      end: 8 * 60 * 1e9,
      position: 3 * 60 * 1e9 + 12 * 1e9,
      minSeek: 0,
      maxSeek: 8 * 60 * 1e9,
      lastUpdatedTime: Date.now(),
    },
    playing: true,
    default: true,
  },
];

const mediaSession = (name: string, processId: number, volume: number, muted = false) => ({
  id: `session-${name}`,
  instanceId: `${name}-${processId}`,
  processId,
  name,
  iconPath: null,
  isSystem: false,
  volume,
  muted,
});

const mediaDevices = [
  [
    {
      id: 'output-speakers',
      name: 'Speakers (Realtek High Definition Audio)',
      type: 'output',
      isDefaultMultimedia: true,
      isDefaultCommunications: true,
      volume: 0.62,
      muted: false,
      sessions: [
        mediaSession('Spotify', 8124, 0.85),
        mediaSession('Firefox', 4432, 0.5),
        mediaSession('Discord', 9910, 0.35, true),
      ],
    },
    {
      id: 'output-headset',
      name: 'Headset (WH-1000XM4)',
      type: 'output',
      isDefaultMultimedia: false,
      isDefaultCommunications: false,
      volume: 0.4,
      muted: false,
      sessions: [],
    },
  ],
  [
    {
      id: 'input-mic',
      name: 'Microphone (Blue Yeti)',
      type: 'input',
      isDefaultMultimedia: true,
      isDefaultCommunications: true,
      volume: 0.75,
      muted: false,
      sessions: [],
    },
  ],
];

const MONITOR_ID = 'preview-monitor';

const appWindows = [
  ['Firefox', 'desk.top — module preview — Mozilla Firefox', 0x0011, 90_000],
  ['Code', 'Network.svelte — desk.top — Visual Studio Code', 0x0012, 80_000],
  ['Explorer', 'Downloads', 0x0013, 60_000],
  ['Spotify', 'Marconi Union — Weightless', 0x0014, 40_000],
  ['Terminal', 'npm run reload', 0x0015, 20_000],
  ['Code', 'metadata.yml — desk.top — Visual Studio Code', 0x0016, 10_000],
].map(([appName, title, hwnd, ago]) => ({
  hwnd,
  monitor: MONITOR_ID,
  title,
  appName,
  isZoomed: false,
  isIconic: hwnd === 0x0015,
  isFullscreen: false,
  // Widened for the packaged title pushed in below, which carries one.
  umid: null as string | null,
  process: { id: 1000 + (hwnd as number), path: `C:\\Program Files\\${appName}\\${appName}.exe` },
  preventPinning: false,
  relaunch: null,
  rect: null,
  lastForegroundAt: Date.now() - (ago as number),
}));

// One game that is running, so the panel's live badge has something to show.
appWindows.push({
  hwnd: 0x0017,
  monitor: MONITOR_ID,
  title: 'Factorio 2.0.28',
  appName: 'Factorio',
  isZoomed: false,
  isIconic: false,
  isFullscreen: false,
  umid: null,
  process: {
    id: 4711,
    path: 'D:\\SteamLibrary\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe',
  },
  preventPinning: false,
  relaunch: null,
  rect: null,
  lastForegroundAt: Date.now() - 120_000,
});

// A Game Pass title, which has no Start Menu target and lives where no known
// folder reaches: the running window is the only way it can ever be seen.
appWindows.push({
  hwnd: 0x0018,
  monitor: MONITOR_ID,
  title: 'Forza Horizon 5',
  appName: 'Forza Horizon 5',
  isZoomed: false,
  isIconic: false,
  isFullscreen: true,
  umid: 'Microsoft.SunriseBaseGame_8wekyb3d8bbwe!App',
  process: { id: 5120, path: 'C:\\XboxGames\\Forza Horizon 5\\Content\\ForzaHorizon5.exe' },
  preventPinning: false,
  relaunch: null,
  rect: null,
  lastForegroundAt: Date.now() - 60_000,
});

/**
 * A Start Menu index shaped like a real one: each store's shortcuts as it
 * writes them, plus the entries detection has to reject - the clients
 * themselves, an uninstaller, and an ordinary application.
 */
const startMenuItems = [
  ['Cyberpunk 2077', 'steam://rungameid/1091500', 'Cyberpunk 2077.url'],
  ['Counter-Strike 2', 'steam://rungameid/730', 'Counter-Strike 2.url'],
  [
    'Factorio',
    'D:\\SteamLibrary\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe',
    'Factorio.lnk',
  ],
  ['Hades II', 'steam://rungameid/1145350', 'Hades II.url'],
  ['Fortnite', 'com.epicgames.launcher://apps/Fortnite?action=launch', 'Epic Games\\Fortnite.url'],
  [
    'Alan Wake 2',
    'com.epicgames.launcher://apps/0e0e0e?action=launch',
    'Epic Games\\Alan Wake 2.url',
  ],
  ['Disco Elysium', 'C:\\GOG Games\\Disco Elysium\\disco.exe', 'GOG.com\\Disco Elysium.lnk'],
  ['World of Warcraft', 'battlenet://WoW', 'Battle.net\\World of Warcraft.url'],
  ["Assassin's Creed Mirage", 'uplay://launch/17828/0', 'Ubisoft\\ACM.url'],
  ['EA SPORTS FC 25', 'link2ea://launchgame/1013179', 'EA\\FC25.url'],
  [
    'League of Legends',
    'C:\\Riot Games\\League of Legends\\LeagueClient.exe',
    'Riot Games\\League of Legends.lnk',
  ],
  [
    'Red Dead Redemption 2',
    'C:\\Program Files\\Rockstar Games\\Red Dead Redemption 2\\RDR2.exe',
    'Rockstar Games\\RDR2.lnk',
  ],
  ['Balatro', 'D:\\Games\\Balatro\\Balatro.exe', 'Balatro.lnk'],
  // Rejected by detection, and here to prove it: the client itself, a tool
  // beside a game, and an application that is not a game at all.
  ['Steam', 'C:\\Program Files (x86)\\Steam\\steam.exe', 'Steam\\Steam.lnk'],
  ['Uninstall Cyberpunk 2077', 'steam://uninstall/1091500', 'Uninstall Cyberpunk 2077.url'],
  ['Firefox', 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', 'Firefox.lnk'],
].map(([display_name, target, shortcut]) => ({
  path: `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\${shortcut}`,
  umid: null,
  toast_activator: null,
  target,
  display_name,
}));

/**
 * A library the detection pass will merge into: the same keys it derives from
 * the shortcuts above, carrying the play time only the panel could have built.
 */
const gamesFile = JSON.stringify({
  version: 1,
  games: [
    ['steam://rungameid/1091500', 'Cyberpunk 2077', 'steam', 1420, 34, 3, true],
    ['steam://rungameid/730', 'Counter-Strike 2', 'steam', 8_640, 612, 0.4, false],
    [
      'd:\\steamlibrary\\steamapps\\common\\factorio\\bin\\x64\\factorio.exe',
      'Factorio',
      'steam',
      60,
      2870,
      41,
      true,
    ],
    [
      'com.epicgames.launcher://apps/fortnite?action=launch',
      'Fortnite',
      'epic',
      20_160,
      96,
      7,
      false,
    ],
    ['c:\\gog games\\disco elysium\\disco.exe', 'Disco Elysium', 'gog', 2_880, 1_915, 12, false],
    ['battlenet://wow', 'World of Warcraft', 'battlenet', 100_000, 24, 1, false],
    ['d:\\games\\balatro\\balatro.exe', 'Balatro', 'other', 180, 744, 22, true],
  ].map(([target, name, launcher, minutesAgo, minutes, launches, favourite], i) => ({
    id: `game-preview-${i}`,
    name,
    target,
    kind: (target as string).includes('://') ? 'url' : 'app',
    umid: null,
    launcher,
    key: `target:${target}`,
    source: 'detected',
    favourite,
    launches,
    minutes,
    lastPlayed: Date.now() - (minutesAgo as number) * 60_000,
  })),
});

const virtualDesktops = {
  monitors: {
    [MONITOR_ID]: {
      workspaces: [
        [
          { id: 'ws-1', name: 'Main', icon: null, wallpaper: null, windows: [1, 2, 3, 4] },
          { id: 'ws-2', name: 'Writing', icon: null, wallpaper: null, windows: [5] },
          { id: 'ws-3', name: null, icon: null, wallpaper: null, windows: [] },
        ],
      ],
      active_workspace: 'ws-1',
    },
  },
  pinned: [],
  switching: false,
};

const batteries = [
  {
    vendor: 'LGC',
    model: 'DELL 5XJ28',
    serialNumber: '4021',
    technology: 'LithiumIon',
    state: 'Discharging',
    capacity: 0.91,
    temperature: null,
    percentage: 68,
    cycleCount: 214,
    smartCharging: false,
    energy: 41.2,
    energyFull: 60.5,
    energyFullDesign: 68,
    energyRate: 12.4,
    voltage: 11.4,
    timeToFull: null,
    timeToEmpty: 8_040,
  },
];

const powerStatus = {
  acLineStatus: 0,
  batteryFlag: 1,
  batteryLifePercent: 68,
  systemStatusFlag: 0,
  batteryLifeTime: 8_040,
  batteryFullLifeTime: -1,
};

const monitorsBrightness = [
  {
    instanceName: 'DISPLAY\\DEL41A8\\5&2b1c5b8&0&UID4352_0',
    currentBrightness: 70,
    levels: 101,
    availableLevels: [],
    active: true,
  },
  {
    instanceName: 'DISPLAY\\MSI4CE0\\5&2b1c5b8&0&UID4356_0',
    currentBrightness: 45,
    levels: 101,
    availableLevels: [],
    active: true,
  },
];

const radios = [
  { id: 'radio-wifi', name: 'Wi-Fi', kind: 'WiFi', is_enabled: true },
  { id: 'radio-bt', name: 'Bluetooth', kind: 'Bluetooth', is_enabled: true },
];

const adapters = [
  {
    name: 'Ethernet',
    description: 'Realtek Gaming 2.5GbE Family Controller',
    status: 'up',
    dnsSuffix: 'lan',
    type: 'Ethernet',
    ipv6: null,
    ipv4: '192.168.1.42',
    gateway: '192.168.1.1',
    mac: '2C-F0-5D-11-22-33',
  },
  {
    name: 'Wi-Fi',
    description: 'Intel(R) Wi-Fi 6 AX200 160MHz',
    status: 'up',
    dnsSuffix: 'lan',
    type: 'Wireless',
    ipv6: null,
    ipv4: '192.168.1.77',
    gateway: '192.168.1.1',
    mac: '9C-B6-D0-44-55-66',
  },
];

const wlanNetworks = [
  ['Kestrel', 92, true, true, 'WPA2-Personal', true],
  ['Kestrel-5G', 78, true, true, 'WPA3-Personal', false],
  ['BT-HUB-9F21', 54, false, true, 'WPA2-Personal', false],
  ['Cafe Guest', 33, false, false, 'Open', false],
].map(([ssid, signal, known, secured, auth, connected], i) => ({
  ssid,
  bssid: `00:11:22:33:44:${String(i).padStart(2, '0')}`,
  channelFrequency: 5_180_000,
  signal,
  known,
  secured,
  auth,
  connected,
}));

const bluetoothDevices = [
  ['WH-1000XM4', 'AudioVideo', true, true],
  ['MX Master 3S', 'Peripheral', true, false],
  ['Pixel 8', 'Phone', false, true],
  ['Galaxy Watch6', 'Wearable', false, false],
].map(([name, major, connected, paired], i) => ({
  id: `bt-${i}`,
  name,
  address: 1000 + i,
  majorServiceClasses: [],
  class: { major, minor: 0 },
  appearance: null,
  connected,
  paired: paired || connected,
  canPair: !paired && !connected,
  canDisconnect: connected,
  canConnect: !connected,
  isLowEnergy: false,
}));

const toast = (title: string, body: string) => ({
  header: null,
  visual: {
    binding: {
      '@template': 'ToastGeneric',
      $value: [
        { text: { '@id': 1, $value: title } },
        { text: { '@id': 2, $value: body } },
      ],
    },
    '@baseUri': '',
    '@lang': 'en-GB',
    '@version': 1,
    '@addImageQuery': false,
  },
  actions: null,
  '@launch': '',
  '@activationType': 'foreground',
  '@duration': 'short',
});

const notifications = [
  ['Mail', 'Ada Lovelace', 'Re: the widget settings round trip — looks right to me.', 4],
  ['Slack', 'design', 'brand tokens land on Thursday, not Tuesday', 26],
  ['Steam', 'Download finished', 'Factorio is ready to play', 95],
  ['Windows Update', 'Restart required', 'Updates will finish after a restart', 240],
].map(([appName, title, body, minutesAgo], i) => ({
  id: 100 + i,
  appUmid: `Preview.${appName}`,
  appName,
  appDescription: '',
  date: Date.now() - (minutesAgo as number) * 60_000,
  content: toast(title as string, body as string),
}));

const clipboardHistory = [
  ['npm run reload', 'Windows Terminal', 2],
  ['https://github.com/eythaann/Seelen-UI', 'Firefox', 14],
  ['const overridden = moduleKeys(module).filter((key) => config.overrides.has(key));', 'Code', 38],
  ['192.168.1.42', 'Windows Terminal', 95],
  ['Weightless — Marconi Union', 'Spotify', 260],
].map(([text, app, minutesAgo], i) => ({
  id: `clip-${i}`,
  timestamp: Date.now() - (minutesAgo as number) * 60_000,
  sourceAppName: app,
  sourceAppLogo: null,
  content: {
    text,
    html: null,
    rtf: null,
    applicationLink: null,
    webLink: (text as string).startsWith('http') ? text : null,
    bitmap: null,
    files: null,
  },
}));

const recentFiles = [
  'desk.top README.md',
  'module preview.png',
  'Seelen widget notes.md',
  'invoice-2026-08.pdf',
  'palette sketch.fig',
  'monitor-MSI4CE0.json',
  'metadata.yml',
  'settings backup.json',
].map((name) => `C:\\Users\\preview\\Recent\\${name}.lnk`.replace('.lnk.lnk', '.lnk'));

/**
 * A folder as the host returns one: the whole subtree, flat, with the
 * directories in it listed in their own right. The Files module rebuilds the
 * tree from exactly this, so the fixture has to have the shape rather than
 * just the names.
 */
const downloadsTree = [
  // Three games that came from the web rather than a store, each recognisable
  // only by what shipped beside its executable.
  'Vampire Survivors',
  'Vampire Survivors\\VampireSurvivors.exe',
  'Vampire Survivors\\UnityPlayer.dll',
  'Vampire Survivors\\VampireSurvivors_Data',
  'Vampire Survivors\\VampireSurvivors_Data\\resources.assets',
  'Vampire Survivors\\steam_api64.dll',
  'DELTARUNE_v1.11',
  'DELTARUNE_v1.11\\DELTARUNE.exe',
  'DELTARUNE_v1.11\\data.win',
  'DELTARUNE_v1.11\\audiogroup1.dat',
  'itch',
  'itch\\Cassette Beasts demo',
  'itch\\Cassette Beasts demo\\bin',
  'itch\\Cassette Beasts demo\\bin\\game.exe',
  'itch\\Cassette Beasts demo\\bin\\game.pck',
  // Not a game, and it has to stay out of the library on its own merits.
  'PortableTool',
  'PortableTool\\tool.exe',
  'installers',
  'installers\\SeelenUI-2.8.2-x64.msi',
  'installers\\node-v24.3.0-x64.msi',
  'installers\\VSCodeUserSetup-x64.exe',
  'installers\\drivers',
  'installers\\drivers\\nvidia-566.36-desktop-win11.exe',
  'invoices',
  'invoices\\2025',
  'invoices\\2025\\invoice-2025-11.pdf',
  'invoices\\2025\\invoice-2025-12.pdf',
  'invoices\\2026',
  'invoices\\2026\\invoice-2026-07.pdf',
  'invoices\\2026\\invoice-2026-08.pdf',
  'invoices\\2026\\invoice-2026-09.pdf',
  'photos',
  'photos\\rooftop',
  'photos\\rooftop\\DSC_0041.jpg',
  'photos\\rooftop\\DSC_0042.jpg',
  'photos\\rooftop\\DSC_0057.jpg',
  'photos\\wallpaper-4k.png',
  'archive.zip',
  'desk.top-preview.png',
  'monitor-MSI4CE0.json',
  'notes for the widget.md',
  'seelen-settings-backup.json',
  'desktop.ini',
].map((name) => `C:\\Users\\preview\\Downloads\\${name}`);

const notesFile = JSON.stringify({
  version: 1,
  note: 'Ship the module preview, then measure the memory again with everything switched on.',
  todos: [
    { id: 't1', text: 'Check the Wi-Fi list dedupes a mesh', done: true },
    { id: 't2', text: 'Confirm the timer chime is not too loud', done: false },
    { id: 't3', text: 'Screenshot every module', done: false },
  ],
});

/** What each event delivers once, shortly after something subscribes to it. */
const EVENT_FIXTURES: Partial<Record<string, unknown>> = {
  [SeelenEvent.NetworkWlanScanned]: wlanNetworks,
};

/** What each command answers with. */
const COMMAND_FIXTURES: Partial<Record<string, unknown>> = {
  [SeelenCommand.GetSystemCores]: cores,
  [SeelenCommand.GetSystemMemory]: memory,
  [SeelenCommand.GetSystemDisks]: disks,
  [SeelenCommand.GetSystemNetwork]: network,
  [SeelenCommand.GetMediaSessions]: mediaPlayers,
  [SeelenCommand.GetMediaDevices]: mediaDevices,
  [SeelenCommand.GetUserAppWindows]: appWindows,
  [SeelenCommand.StateGetVirtualDesktops]: virtualDesktops,
  [SeelenCommand.GetBatteries]: batteries,
  [SeelenCommand.GetPowerStatus]: powerStatus,
  [SeelenCommand.GetPowerMode]: 'Balanced',
  [SeelenCommand.GetAllMonitorsBrightness]: monitorsBrightness,
  [SeelenCommand.GetRadios]: radios,
  [SeelenCommand.GetNetworkInternetConnection]: true,
  [SeelenCommand.GetNetworkDefaultLocalIp]: '192.168.1.42',
  [SeelenCommand.GetNetworkAdapters]: adapters,
  [SeelenCommand.WlanScan]: null,
  [SeelenCommand.GetBluetoothDevices]: bluetoothDevices,
  [SeelenCommand.GetNotifications]: notifications,
  [SeelenCommand.GetFocusAssist]: false,
  [SeelenCommand.GetNotificationsMode]: 'All',
  [SeelenCommand.ClipboardGetData]: { isHistoryEnabled: true, history: clipboardHistory },
  [SeelenCommand.GetTrashBinInfo]: { itemCount: 23, sizeInBytes: 1.24 * GB },
  [SeelenCommand.GetMediaWaveform]: { data: Array.from({ length: 128 }, () => -120) },
  [SeelenCommand.GetStartMenuItems]: startMenuItems,
};

export function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  if (command === SeelenCommand.ReadFile) {
    const filename = String(args?.filename ?? '');
    if (filename === 'notes.json') return Promise.resolve(notesFile);
    if (filename === 'games.json') return Promise.resolve(gamesFile);
    // Anything else falls back to its defaults, exactly as a first run would.
    return Promise.reject(new Error(`preview: no ${filename}`));
  }
  if (command === SeelenCommand.WriteFile) return Promise.resolve(undefined);

  // The only fixture that depends on its argument: the Files module browses a
  // tree, and `Recent` is the one known folder that never has one.
  if (command === SeelenCommand.GetUserFolderContent) {
    return Promise.resolve(args?.folderType === 'Recent' ? recentFiles : downloadsTree);
  }

  if (command in COMMAND_FIXTURES) return Promise.resolve(COMMAND_FIXTURES[command]);
  // Commands with no fixture are the ones that *do* something; in a preview
  // there is nothing to do, and nothing should throw because of it.
  return Promise.resolve(undefined);
}

export function subscribe(
  event: string,
  callback: (payload: { payload: unknown }) => void,
): Promise<UnSubscriber> {
  if (event in EVENT_FIXTURES) {
    const timer = setTimeout(() => callback({ payload: EVENT_FIXTURES[event] }), 60);
    return Promise.resolve(() => clearTimeout(timer));
  }
  return Promise.resolve(() => {});
}

/** Enough of the settings API for `config.start()` to resolve. */
export const Settings = {
  getAsync: () =>
    Promise.resolve({
      inner: { byWidget: {}, monitorsV3: {} },
      getCurrentWidgetConfig: () => ({}),
      save: () => Promise.resolve(),
    }),
};

export const Widget = {
  self: {
    id: '@ralfm/desktop',
    decoded: { monitorId: MONITOR_ID },
  },
};

export const ConnectedMonitorList = {
  getAsync: () => Promise.resolve({ all: () => [] }),
};

/** Copied rather than imported: this module *is* `seelen.ts` in this build. */
export class Disposables {
  #handles: UnSubscriber[] = [];
  #disposed = false;

  add(pending: Promise<UnSubscriber>): void {
    void pending.then((off) => {
      if (this.#disposed) off();
      else this.#handles.push(off);
    });
  }

  addFn(off: UnSubscriber): void {
    if (this.#disposed) off();
    else this.#handles.push(off);
  }

  dispose(): void {
    this.#disposed = true;
    for (const off of this.#handles.splice(0)) off();
  }
}

export const PREVIEW_MONITOR_ID = MONITOR_ID;
