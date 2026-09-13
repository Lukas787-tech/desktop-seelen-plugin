import type { ConfigKey } from './config.svelte';
import type { PanelKind } from './store.svelte';

/**
 * What each module panel is, and which settings belong to it.
 *
 * One declaration drives four things: the panel title, the right-click menu
 * (its quick toggles and its "Settings..." dialog), the `Modules` submenu that
 * shows and hides them, and the set of keys that "use the same settings as
 * other displays" has to clear. Keeping them in one table is what stops a new
 * setting from appearing in the dialog but being missed by the reset, or vice
 * versa.
 *
 * Every key here is declared in `widgets/desktop/metadata.yml` with
 * `allowSetByMonitor: true`, which is what makes the per-display scope work.
 */

export type FieldType = 'switch' | 'range' | 'select' | 'text';

export interface ModuleField {
  key: ConfigKey;
  label: string;
  description?: string;
  type: FieldType;
  /** `range` only. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** `select` only. */
  options?: readonly { label: string; value: string }[];
  /** `text` only. */
  placeholder?: string;
}

/** Sections of the `Modules` menu, so eighteen entries stay readable. */
export type ModuleGroup = 'time' | 'system' | 'devices' | 'desktop';

export const MODULE_GROUPS: readonly { id: ModuleGroup; label: string }[] = [
  { id: 'time', label: 'Time' },
  { id: 'system', label: 'System' },
  { id: 'devices', label: 'Devices' },
  { id: 'desktop', label: 'Desktop' },
];

export interface ModuleDefinition {
  kind: PanelKind;
  title: string;
  group: ModuleGroup;
  /** The switch that shows or hides this module. */
  enabledKey: ConfigKey;
  /** Booleans surfaced directly in the right-click menu, in order. */
  quick: readonly ConfigKey[];
  fields: readonly ModuleField[];
}

export const MODULES: Record<PanelKind, ModuleDefinition> = {
  clock: {
    kind: 'clock',
    title: 'Clock',
    group: 'time',
    enabledKey: 'moduleClock',
    quick: ['clock24h', 'clockShowSeconds', 'clockShowDate'],
    fields: [
      { key: 'clock24h', label: '24-hour time', type: 'switch' },
      {
        key: 'clockShowSeconds',
        label: 'Show seconds',
        description: 'Ticks once a second instead of once a minute.',
        type: 'switch',
      },
      { key: 'clockShowDate', label: 'Show date', type: 'switch' },
    ],
  },
  calendar: {
    kind: 'calendar',
    title: 'Calendar',
    group: 'time',
    enabledKey: 'moduleCalendar',
    quick: ['calendarStartMonday', 'calendarWeekNumbers', 'calendarHighlightWeekend'],
    fields: [
      { key: 'calendarStartMonday', label: 'Weeks start on Monday', type: 'switch' },
      {
        key: 'calendarWeekNumbers',
        label: 'Show week numbers',
        description: 'ISO-8601 weeks, in a column down the left.',
        type: 'switch',
      },
      { key: 'calendarHighlightWeekend', label: 'Mute weekends', type: 'switch' },
    ],
  },
  worldclock: {
    kind: 'worldclock',
    title: 'World clock',
    group: 'time',
    enabledKey: 'moduleWorldClock',
    quick: ['worldClock24h', 'worldClockOffsets'],
    fields: [
      {
        key: 'worldClockZones',
        label: 'Time zones',
        description: 'IANA names separated by commas, e.g. Europe/London, Asia/Tokyo.',
        type: 'text',
        placeholder: 'UTC, Europe/London',
      },
      { key: 'worldClock24h', label: '24-hour time', type: 'switch' },
      { key: 'worldClockOffsets', label: 'Show offset from here', type: 'switch' },
    ],
  },
  timer: {
    kind: 'timer',
    title: 'Timer',
    group: 'time',
    enabledKey: 'moduleTimer',
    quick: ['timerChime', 'timerAutoContinue'],
    fields: [
      {
        key: 'timerWorkMinutes',
        label: 'Focus length',
        type: 'range',
        min: 1,
        max: 120,
        step: 1,
        unit: ' min',
      },
      {
        key: 'timerBreakMinutes',
        label: 'Break length',
        type: 'range',
        min: 1,
        max: 60,
        step: 1,
        unit: ' min',
      },
      {
        key: 'timerChime',
        label: 'Chime when it ends',
        description: 'Two short tones, played through the default output.',
        type: 'switch',
      },
      { key: 'timerAutoContinue', label: 'Start the next phase automatically', type: 'switch' },
    ],
  },
  media: {
    kind: 'media',
    title: 'Media',
    group: 'desktop',
    enabledKey: 'moduleMedia',
    quick: ['mediaShowArt', 'mediaShowVisualiser', 'mediaShowMixer'],
    fields: [
      { key: 'mediaShowArt', label: 'Show album art', type: 'switch' },
      {
        key: 'mediaShowVisualiser',
        label: 'Show visualiser',
        description: 'Only drawn once the waveform stream carries real signal.',
        type: 'switch',
      },
      {
        key: 'mediaShowMixer',
        label: 'Show audio mixer',
        description: 'Per-application volume, mute and output device.',
        type: 'switch',
      },
    ],
  },
  sysmon: {
    kind: 'sysmon',
    title: 'System',
    group: 'system',
    enabledKey: 'moduleSysmon',
    quick: ['sysmonCpu', 'sysmonRam', 'sysmonDisk', 'sysmonNet'],
    fields: [
      { key: 'sysmonCpu', label: 'CPU', type: 'switch' },
      { key: 'sysmonRam', label: 'Memory', type: 'switch' },
      { key: 'sysmonDisk', label: 'Disks', type: 'switch' },
      { key: 'sysmonNet', label: 'Network', type: 'switch' },
    ],
  },
  battery: {
    kind: 'battery',
    title: 'Battery',
    group: 'system',
    enabledKey: 'moduleBattery',
    quick: ['batteryShowRate', 'batteryShowHealth', 'batteryShowPowerMode'],
    fields: [
      {
        key: 'batteryShowRate',
        label: 'Show power draw',
        description: 'Watts in or out, while the battery is not idle.',
        type: 'switch',
      },
      {
        key: 'batteryShowHealth',
        label: 'Show health',
        description: 'Full charge as a share of the design capacity.',
        type: 'switch',
      },
      { key: 'batteryShowPowerMode', label: 'Show power mode', type: 'switch' },
    ],
  },
  power: {
    kind: 'power',
    title: 'Power',
    group: 'system',
    enabledKey: 'modulePower',
    quick: ['powerConfirm', 'powerShowSleep', 'powerShowHibernate', 'powerShowShutdown'],
    fields: [
      {
        key: 'powerConfirm',
        label: 'Confirm before ending the session',
        description: 'Sign out, restart and shut down ask twice.',
        type: 'switch',
      },
      { key: 'powerShowSleep', label: 'Show sleep', type: 'switch' },
      { key: 'powerShowHibernate', label: 'Show hibernate', type: 'switch' },
      { key: 'powerShowShutdown', label: 'Show restart and shut down', type: 'switch' },
    ],
  },
  quick: {
    kind: 'quick',
    title: 'Quick settings',
    group: 'system',
    enabledKey: 'moduleQuick',
    quick: ['quickBrightness', 'quickRadios', 'quickFocusAssist'],
    fields: [
      {
        key: 'quickBrightness',
        label: 'Brightness',
        description: 'Only monitors that answer a brightness request appear.',
        type: 'switch',
      },
      { key: 'quickRadios', label: 'Wi-Fi and bluetooth switches', type: 'switch' },
      { key: 'quickFocusAssist', label: 'Focus assist', type: 'switch' },
    ],
  },
  windows: {
    kind: 'windows',
    title: 'Windows',
    group: 'desktop',
    enabledKey: 'moduleWindows',
    quick: ['windowsThisDisplayOnly', 'windowsGroupByApp', 'windowsHideMinimised'],
    fields: [
      { key: 'windowsThisDisplayOnly', label: 'Only windows on this display', type: 'switch' },
      { key: 'windowsGroupByApp', label: 'Group by application', type: 'switch' },
      { key: 'windowsHideMinimised', label: 'Hide minimised windows', type: 'switch' },
      { key: 'windowsShowIcons', label: 'Show icons', type: 'switch' },
    ],
  },
  workspaces: {
    kind: 'workspaces',
    title: 'Workspaces',
    group: 'desktop',
    enabledKey: 'moduleWorkspaces',
    quick: ['workspacesShowNames', 'workspacesShowCounts', 'workspacesShowControls'],
    fields: [
      { key: 'workspacesShowNames', label: 'Show names', type: 'switch' },
      { key: 'workspacesShowCounts', label: 'Show window counts', type: 'switch' },
      {
        key: 'workspacesShowControls',
        label: 'Allow editing',
        description: 'Adds, renames and removes desktops from the panel.',
        type: 'switch',
      },
    ],
  },
  network: {
    kind: 'network',
    title: 'Network',
    group: 'devices',
    enabledKey: 'moduleNetwork',
    quick: ['networkShowWifi', 'networkShowIp', 'networkShowAdapters'],
    fields: [
      {
        key: 'networkShowWifi',
        label: 'Show wireless networks',
        description: 'Scans when the panel appears, and whenever you press Scan.',
        type: 'switch',
      },
      { key: 'networkShowIp', label: 'Show local address', type: 'switch' },
      { key: 'networkShowAdapters', label: 'Show adapters', type: 'switch' },
    ],
  },
  bluetooth: {
    kind: 'bluetooth',
    title: 'Bluetooth',
    group: 'devices',
    enabledKey: 'moduleBluetooth',
    quick: ['bluetoothPairedOnly', 'bluetoothShowRadio'],
    fields: [
      {
        key: 'bluetoothPairedOnly',
        label: 'Only paired devices',
        description: 'Turn off to also list whatever a scan finds nearby.',
        type: 'switch',
      },
      { key: 'bluetoothShowRadio', label: 'Show the bluetooth switch', type: 'switch' },
    ],
  },
  notifications: {
    kind: 'notifications',
    title: 'Notifications',
    group: 'desktop',
    enabledKey: 'moduleNotifications',
    quick: ['notificationsShowBody', 'notificationsShowApp', 'notificationsShowControls'],
    fields: [
      { key: 'notificationsShowBody', label: 'Show message text', type: 'switch' },
      { key: 'notificationsShowApp', label: 'Show app and time', type: 'switch' },
      {
        key: 'notificationsShowControls',
        label: 'Show focus assist',
        description: 'The switch, and what still gets through while it is on.',
        type: 'switch',
      },
      {
        key: 'notificationsMax',
        label: 'How many to list',
        type: 'range',
        min: 3,
        max: 40,
        step: 1,
      },
    ],
  },
  clipboard: {
    kind: 'clipboard',
    title: 'Clipboard',
    group: 'desktop',
    enabledKey: 'moduleClipboard',
    quick: ['clipboardPasteOnClick', 'clipboardShowImages', 'clipboardShowSource'],
    fields: [
      {
        key: 'clipboardPasteOnClick',
        label: 'Paste on click',
        description: 'Otherwise a click only puts the entry back on the clipboard.',
        type: 'switch',
      },
      { key: 'clipboardShowImages', label: 'Show image previews', type: 'switch' },
      { key: 'clipboardShowSource', label: 'Show source app and time', type: 'switch' },
      { key: 'clipboardMax', label: 'How many to list', type: 'range', min: 3, max: 50, step: 1 },
    ],
  },
  trash: {
    kind: 'trash',
    title: 'Recycle bin',
    group: 'desktop',
    enabledKey: 'moduleTrash',
    quick: ['trashConfirmEmpty'],
    fields: [
      {
        key: 'trashConfirmEmpty',
        label: 'Confirm before emptying',
        description: 'Emptying the bin cannot be undone.',
        type: 'switch',
      },
    ],
  },
  files: {
    kind: 'files',
    title: 'Files',
    group: 'desktop',
    enabledKey: 'moduleFiles',
    quick: ['filesShowIcons', 'filesShowSearch'],
    fields: [
      {
        key: 'filesFolder',
        label: 'Folder',
        description: 'Where browsing starts. Subfolders are opened in the panel.',
        type: 'select',
        options: [
          { label: 'Recent', value: 'Recent' },
          { label: 'Downloads', value: 'Downloads' },
          { label: 'Documents', value: 'Documents' },
          { label: 'Pictures', value: 'Pictures' },
          { label: 'Music', value: 'Music' },
          { label: 'Videos', value: 'Videos' },
          { label: 'Desktop', value: 'Desktop' },
        ],
      },
      {
        key: 'filesView',
        label: 'View',
        type: 'select',
        options: [
          { label: 'List', value: 'list' },
          { label: 'Tiles', value: 'grid' },
        ],
      },
      {
        key: 'filesTileSize',
        label: 'Tile size',
        description: 'Tiles view only.',
        type: 'range',
        min: 40,
        max: 140,
        step: 4,
        unit: 'px',
      },
      {
        key: 'filesSort',
        label: 'Order',
        description: 'Folders always come first.',
        type: 'select',
        options: [
          { label: 'Name', value: 'name' },
          { label: 'Type', value: 'type' },
        ],
      },
      { key: 'filesShowSearch', label: 'Show the filter box', type: 'switch' },
      { key: 'filesMax', label: 'How many to list', type: 'range', min: 5, max: 200, step: 5 },
      { key: 'filesShowIcons', label: 'Show icons', type: 'switch' },
    ],
  },
  games: {
    kind: 'games',
    title: 'Games',
    group: 'desktop',
    enabledKey: 'moduleGames',
    quick: ['gamesDeepScan', 'gamesScanRunning', 'gamesShowStats', 'gamesGroupByLauncher'],
    fields: [
      {
        key: 'gamesAutoDetect',
        label: 'Find games automatically',
        description: "Matches the Start Menu index against each store's own shortcuts.",
        type: 'switch',
      },
      {
        key: 'gamesDeepScan',
        label: 'Search Downloads, Desktop and Documents',
        description:
          'Recognises a game by the engine and store files that shipped with it, which is what finds one that came from the web rather than a store.',
        type: 'switch',
      },
      {
        key: 'gamesScanRunning',
        label: 'Add games when they are played',
        description:
          'Anything running from a game library is added, which is the only way to see a Game Pass title.',
        type: 'switch',
      },
      {
        key: 'gamesTrackPlaytime',
        label: 'Track play time',
        description: "Timed from the game's own window, and only while this panel is shown.",
        type: 'switch',
      },
      {
        key: 'gamesLayout',
        label: 'Layout',
        type: 'select',
        options: [
          { label: 'Grid', value: 'grid' },
          { label: 'Shelf', value: 'shelf' },
          { label: 'List', value: 'list' },
        ],
      },
      {
        key: 'gamesTileSize',
        label: 'Tile size',
        type: 'range',
        min: 48,
        max: 200,
        step: 4,
        unit: 'px',
      },
      {
        key: 'gamesArtShape',
        label: 'Art shape',
        type: 'select',
        options: [
          { label: 'Square', value: 'square' },
          { label: 'Box art (2:3)', value: 'portrait' },
          { label: 'Capsule (16:9)', value: 'wide' },
        ],
      },
      {
        key: 'gamesArtStyle',
        label: 'Art',
        description: 'Cover images you choose are used whatever this is set to.',
        type: 'select',
        options: [
          { label: 'Gradient and icon', value: 'auto' },
          { label: 'Icon only', value: 'icon' },
          { label: 'Initials', value: 'plain' },
        ],
      },
      {
        key: 'gamesLabelMode',
        label: 'Titles',
        type: 'select',
        options: [
          { label: 'Always', value: 'always' },
          { label: 'On hover', value: 'hover' },
          { label: 'Never', value: 'never' },
        ],
      },
      {
        key: 'gamesSort',
        label: 'Order',
        type: 'select',
        options: [
          { label: 'Recently played', value: 'recent' },
          { label: 'Most played', value: 'played' },
          { label: 'Name', value: 'name' },
          { label: 'Store', value: 'launcher' },
        ],
      },
      { key: 'gamesFavouritesFirst', label: 'Favourites first', type: 'switch' },
      { key: 'gamesGroupByLauncher', label: 'Group by store', type: 'switch' },
      { key: 'gamesShowSearch', label: 'Show the search box', type: 'switch' },
      { key: 'gamesShowLauncher', label: 'Show the store badge', type: 'switch' },
      { key: 'gamesShowRunning', label: 'Mark games that are running', type: 'switch' },
      { key: 'gamesShowStats', label: 'Show play time', type: 'switch' },
      { key: 'gamesHoverZoom', label: 'Lift the art on hover', type: 'switch' },
      {
        key: 'gamesShowMissing',
        label: 'Show uninstalled games',
        description: 'Entries a rescan no longer finds, kept for their play time.',
        type: 'switch',
      },
    ],
  },
  notes: {
    kind: 'notes',
    title: 'Notes',
    group: 'desktop',
    enabledKey: 'moduleNotes',
    quick: ['notesHideCompleted'],
    fields: [
      {
        key: 'notesDefaultTab',
        label: 'Opens on',
        type: 'select',
        options: [
          { label: 'Todo', value: 'todo' },
          { label: 'Note', value: 'note' },
        ],
      },
      {
        key: 'notesHideCompleted',
        label: 'Hide completed tasks',
        description: 'They are kept, just not listed.',
        type: 'switch',
      },
    ],
  },
  chat: {
    kind: 'chat',
    title: 'Assistant',
    group: 'desktop',
    enabledKey: 'moduleChat',
    quick: ['chatRouting', 'chatTools', 'chatContext', 'chatStream'],
    fields: [
      {
        key: 'chatProvider',
        label: 'Service',
        description:
          'Keys, local models, tools and memory are in the assistant’s own settings: the gear in its panel.',
        type: 'select',
        options: [
          { label: 'Ollama (local)', value: 'ollama' },
          { label: 'LM Studio (local)', value: 'lmstudio' },
          { label: 'Custom endpoint', value: 'custom' },
          { label: 'Gemini', value: 'gemini' },
          { label: 'OpenAI', value: 'openai' },
          { label: 'Claude', value: 'anthropic' },
          { label: 'OpenRouter', value: 'openrouter' },
          { label: 'Groq', value: 'groq' },
        ],
      },
      {
        key: 'chatModel',
        label: 'Model',
        description: "Leave blank for the service's default, or the first installed local model.",
        type: 'text',
        placeholder: 'gemma4:12b',
      },
      {
        key: 'chatRouting',
        label: 'Choose the model per question',
        description:
          'Keeps questions about this PC local, sends harder ones to the strongest service you have a key for, and moves on when one is rate limited or down.',
        type: 'switch',
      },
      {
        key: 'chatTools',
        label: 'Let it use this PC',
        description:
          'Works as an agent: reads and controls apps, windows, media, devices, files, notes and the web. Which of those, and when it asks first, is set in its own settings.',
        type: 'switch',
      },
      {
        key: 'chatContext',
        label: 'Send a status summary',
        description:
          'Puts the time, load, battery and open apps at the top of every turn so it does not have to ask.',
        type: 'switch',
      },
      {
        key: 'chatSystemPrompt',
        label: 'System prompt',
        description: 'Sets the tone for every reply.',
        type: 'text',
        placeholder: 'Be concise and direct.',
      },
      {
        key: 'chatStream',
        label: 'Stream replies',
        description: 'Shows the answer as it is written instead of all at once.',
        type: 'switch',
      },
    ],
  },
};

/** Fixed order for anything that lists every module, grouped as the menu is. */
export const MODULE_ORDER: readonly PanelKind[] = [
  'clock',
  'calendar',
  'worldclock',
  'timer',
  'sysmon',
  'battery',
  'power',
  'quick',
  'network',
  'bluetooth',
  'media',
  'games',
  'windows',
  'workspaces',
  'notifications',
  'clipboard',
  'files',
  'trash',
  'notes',
  'chat',
];

export function modulesInGroup(group: ModuleGroup): PanelKind[] {
  return MODULE_ORDER.filter((kind) => MODULES[kind].group === group);
}

/** Appearance shared by every panel, offered in each module's dialog. */
export const PANEL_FIELDS: readonly ModuleField[] = [
  { key: 'panelOpacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
  { key: 'panelBlur', label: 'Background blur', type: 'range', min: 0, max: 48, step: 1, unit: 'px' },
  { key: 'cornerRadius', label: 'Corner radius', type: 'range', min: 0, max: 36, step: 1, unit: 'px' },
];

/** Every key a module owns, used when resetting a display back to the others. */
export function moduleKeys(module: ModuleDefinition): ConfigKey[] {
  return [module.enabledKey, ...module.fields.map((field) => field.key)];
}

export function fieldFor(module: ModuleDefinition, key: ConfigKey): ModuleField | undefined {
  return module.fields.find((field) => field.key === key);
}
