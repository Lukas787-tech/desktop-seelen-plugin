import { FolderType, type MediaDevice } from '@seelen-ui/lib/types';
import { DEFAULT_CONFIG, config, type ConfigKey } from './config.svelte';
import { FOLDERS, commonRoot, displayName, listDirectory } from './files.svelte';
import { apps, launch, revealInExplorer } from './launch.svelte';
import { sessionLabel } from './media.svelte';
import { MODULES, MODULE_ORDER } from './modules';
import { notes } from './notes.svelte';
import { toastLines } from './notifications.svelte';
import { previewOf } from './clipboard.svelte';
import { levelsOf, shortMonitorName } from './quick.svelte';
import { SeelenCommand, invoke } from './seelen';
import { formatBytes } from './system.svelte';
import { bool, num, schema, str, type ToolDefinition } from './tool';
import { activateWindow, ownMonitorId, showDesktop } from './windows.svelte';
import { workspacesOf } from './workspaces.svelte';

/**
 * What the assistant is allowed to know about this machine, and what it is
 * allowed to do to it.
 *
 * Everything reads through one-shot host commands rather than the live stores
 * the panels use. A tool call is a rare, user-provoked event, so the
 * reference-counted subscriptions those stores are built on would be all cost
 * and no benefit - and a tool that quietly held a subscription for the life of
 * the widget is exactly the kind of thing this module should not do.
 *
 * Every tool declares a risk (see `tool.ts`), and the store decides from that
 * and the user's autonomy setting whether it asks first. A language model
 * choosing to empty the recycle bin is not the same thing as a person choosing
 * it, and a model choosing to pause the music nearly is.
 */

async function withApps<T>(fn: () => T): Promise<T> {
  const release = await apps.acquire();
  try {
    return fn();
  } finally {
    release();
  }
}

/** Case-insensitive "contains", in either direction, for names a model paraphrases. */
function matches(name: string, wanted: string): boolean {
  const a = name.toLowerCase();
  const b = wanted.toLowerCase().trim();
  return !!b && (a.includes(b) || b.includes(a));
}

async function outputs(): Promise<MediaDevice[]> {
  const pair = await invoke(SeelenCommand.GetMediaDevices);
  return [...(pair[0] ?? []), ...(pair[1] ?? [])].filter((d) => d.type === 'output');
}

async function defaultOutput(): Promise<MediaDevice | null> {
  const all = await outputs();
  return all.find((d) => d.isDefaultMultimedia) ?? all[0] ?? null;
}

async function defaultPlayerId(): Promise<string | null> {
  const players = await invoke(SeelenCommand.GetMediaSessions);
  return (players.find((p) => p.default) ?? players.find((p) => p.playing) ?? players[0])?.umid ?? null;
}

function folderFrom(value: string): FolderType | null {
  return FOLDERS.find((f) => f.value.toLowerCase() === value.trim().toLowerCase())?.value ?? null;
}

const FOLDER_NAMES = FOLDERS.map((f) => f.value);

async function folderPaths(folder: FolderType): Promise<string[]> {
  return invoke(SeelenCommand.GetUserFolderContent, { folderType: folder });
}

const SYSTEM: ToolDefinition[] = [
  {
    name: 'get_system_status',
    group: 'system',
    risk: 'read',
    description: 'CPU load, memory use and free disk space on this PC.',
    summarise: () => 'Checked system status',
    async run() {
      const [cores, memory, disks] = await Promise.all([
        invoke(SeelenCommand.GetSystemCores),
        invoke(SeelenCommand.GetSystemMemory),
        invoke(SeelenCommand.GetSystemDisks),
      ]);
      const cpu = cores.length ? Math.round(cores.reduce((s, c) => s + c.usage, 0) / cores.length) : 0;
      return {
        cpuPercent: cpu,
        cpu: cores[0]?.brand ?? '',
        cores: cores.length,
        memory: { used: formatBytes(memory.total - memory.free), total: formatBytes(memory.total) },
        disks: disks.map((d) => ({ mount: d.mountPoint, name: d.name, free: formatBytes(d.availableSpace), total: formatBytes(d.totalSpace) })),
      };
    },
  },
  {
    name: 'get_power',
    group: 'system',
    risk: 'read',
    description: 'Battery charge, whether the PC is on mains power, time remaining and the power mode.',
    summarise: () => 'Checked the battery',
    async run() {
      const [status, batteries, mode] = await Promise.all([
        invoke(SeelenCommand.GetPowerStatus),
        invoke(SeelenCommand.GetBatteries).catch(() => []),
        invoke(SeelenCommand.GetPowerMode).catch(() => null),
      ]);
      const seconds = status.batteryLifeTime;
      return {
        onMains: status.acLineStatus === 1,
        percent: status.batteryLifePercent > 100 ? null : status.batteryLifePercent,
        minutesRemaining: seconds > 0 && seconds < 0xffffffff ? Math.round(seconds / 60) : null,
        powerMode: mode,
        batteries: batteries.map((b) => ({ model: b.model, state: b.state, percent: b.percentage })),
      };
    },
  },
  {
    name: 'get_network',
    group: 'system',
    risk: 'read',
    description: 'Whether this PC is online, its local IP address, adapters, and whether Wi-Fi and bluetooth radios are on.',
    summarise: () => 'Checked the network',
    async run() {
      const [online, ip, adapters, radios] = await Promise.all([
        invoke(SeelenCommand.GetNetworkInternetConnection).catch(() => null),
        invoke(SeelenCommand.GetNetworkDefaultLocalIp).catch(() => null),
        invoke(SeelenCommand.GetNetworkAdapters).catch(() => []),
        invoke(SeelenCommand.GetRadios).catch(() => []),
      ]);
      return {
        online,
        localIp: ip,
        adapters: adapters.filter((a) => a.status === 'up').map((a) => ({ name: a.name, type: a.type, ipv4: a.ipv4 })),
        radios: radios.map((r) => ({ kind: r.kind, on: r.is_enabled })),
      };
    },
  },
  {
    name: 'get_focused_app',
    group: 'system',
    risk: 'read',
    description: 'The window the user is working in right now: its title and application.',
    summarise: () => 'Looked at the focused window',
    async run() {
      const app = await invoke(SeelenCommand.GetFocusedApp);
      return { title: app.title, app: app.name, exe: app.exe, maximised: app.isMaximized, fullscreen: app.isFullscreened };
    },
  },
  {
    name: 'list_notifications',
    group: 'system',
    risk: 'read',
    sensitive: true,
    description: 'Notifications waiting in the Windows action center, newest first.',
    summarise: () => 'Read notifications',
    async run() {
      const list = await invoke(SeelenCommand.GetNotifications);
      return {
        notifications: list.slice(0, 20).map((n) => ({
          id: n.id,
          app: n.appName,
          lines: toastLines(n.content).slice(0, 3),
          minutesAgo: Math.round((Date.now() - n.date) / 60000),
        })),
      };
    },
  },
  {
    name: 'dismiss_notifications',
    group: 'system',
    risk: 'act',
    description: 'Dismiss one notification by id, or all of them when no id is given.',
    parameters: schema({ id: { type: 'number', description: 'From list_notifications; omit for all.' } }),
    summarise: (a) => (num(a, 'id') === null ? 'Clear all notifications' : 'Dismiss a notification'),
    async run(args) {
      const id = num(args, 'id');
      if (id === null) await invoke(SeelenCommand.NotificationsCloseAll);
      else await invoke(SeelenCommand.NotificationsClose, { id });
      return { ok: true };
    },
  },
  {
    name: 'get_recycle_bin',
    group: 'system',
    risk: 'read',
    description: 'How many items are in the recycle bin and how much space they take.',
    summarise: () => 'Checked the recycle bin',
    async run() {
      const info = await invoke(SeelenCommand.GetTrashBinInfo);
      return { items: info.itemCount, size: formatBytes(info.sizeInBytes) };
    },
  },
];

const APPS: ToolDefinition[] = [
  {
    name: 'find_app',
    group: 'apps',
    risk: 'read',
    description: 'Search installed applications by name. Use before launch_app when unsure what an app is called.',
    parameters: schema({ query: { type: 'string' } }, ['query']),
    summarise: (a) => `Looked for apps matching “${str(a, 'query')}”`,
    async run(args) {
      const found = await withApps(() => apps.search(str(args, 'query'), 12));
      return { matches: found.map((i) => i.display_name) };
    },
  },
  {
    name: 'launch_app',
    group: 'apps',
    risk: 'act',
    description: 'Open an installed application by name.',
    parameters: schema({ name: { type: 'string' } }, ['name']),
    summarise: (a) => `Open ${str(a, 'name') || 'an application'}`,
    async run(args) {
      const name = str(args, 'name');
      const match = await withApps(() => apps.search(name, 1)[0] ?? null);
      if (!match) return { ok: false, error: `No installed app matches "${name}". Try find_app.` };
      await launch(match.path, 'app');
      return { ok: true, launched: match.display_name };
    },
  },
  {
    name: 'open',
    group: 'apps',
    risk: 'act',
    description: 'Open a file, a folder or a web address with its default program, as double-clicking it would.',
    parameters: schema({ target: { type: 'string', description: 'A full path or an http(s) address.' } }, ['target']),
    summarise: (a) => `Open ${str(a, 'target').slice(0, 70)}`,
    async run(args) {
      const target = str(args, 'target').trim();
      if (!target) return { ok: false, error: 'target is required.' };
      await invoke(SeelenCommand.OpenFile, { path: target });
      return { ok: true };
    },
  },
  {
    name: 'show_in_explorer',
    group: 'apps',
    risk: 'act',
    description: 'Open Explorer with a file or folder selected.',
    parameters: schema({ path: { type: 'string' } }, ['path']),
    summarise: (a) => `Show ${displayName(str(a, 'path'))} in Explorer`,
    async run(args) {
      await revealInExplorer(str(args, 'path'));
      return { ok: true };
    },
  },
  {
    name: 'run_program',
    group: 'apps',
    risk: 'danger',
    description:
      'Start a program with command-line arguments, e.g. notepad.exe with a file, or cmd.exe /c with a command. Its output is not returned. Prefer launch_app or open when they do the job.',
    parameters: schema(
      {
        program: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        working_dir: { type: 'string' },
      },
      ['program'],
    ),
    summarise: (a) => {
      const list = Array.isArray(a.args) ? a.args.join(' ') : str(a, 'args');
      return `Run ${str(a, 'program')} ${list}`.trim();
    },
    async run(args) {
      const list = Array.isArray(args.args) ? args.args.map(String) : str(args, 'args') ? [str(args, 'args')] : null;
      await invoke(SeelenCommand.Run, {
        program: str(args, 'program'),
        args: list,
        workingDir: str(args, 'working_dir') || null,
        elevated: false,
      });
      return { ok: true, note: 'Started. Output is not available to you.' };
    },
  },
];

const WINDOWS: ToolDefinition[] = [
  {
    name: 'list_windows',
    group: 'windows',
    risk: 'read',
    description: 'The windows open on this PC, with the hwnd the other window tools need.',
    summarise: () => 'Listed open windows',
    async run() {
      const windows = await invoke(SeelenCommand.GetUserAppWindows);
      return {
        windows: windows.map((w) => ({ hwnd: w.hwnd, title: w.title, app: w.appName, minimised: w.isIconic, fullscreen: w.isFullscreen })),
      };
    },
  },
  {
    name: 'focus_window',
    group: 'windows',
    risk: 'act',
    description: 'Bring a window to the front, restoring it if minimised.',
    parameters: schema({ hwnd: { type: 'number', description: 'From list_windows.' } }, ['hwnd']),
    summarise: () => 'Bring a window to the front',
    async run(args) {
      const hwnd = num(args, 'hwnd');
      if (hwnd === null) return { ok: false, error: 'hwnd must be a number from list_windows.' };
      await activateWindow(hwnd, 'assistant');
      return { ok: true };
    },
  },
  {
    name: 'minimise_window',
    group: 'windows',
    risk: 'act',
    description: 'Minimise one window.',
    parameters: schema({ hwnd: { type: 'number' } }, ['hwnd']),
    summarise: () => 'Minimise a window',
    async run(args) {
      const hwnd = num(args, 'hwnd');
      const windows = await invoke(SeelenCommand.GetUserAppWindows);
      const target = windows.find((w) => w.hwnd === hwnd);
      if (!target || hwnd === null) return { ok: false, error: 'No such window.' };
      // A toggle: sending it to a window that is already down would restore it.
      if (!target.isIconic) await invoke(SeelenCommand.WegToggleWindowState, { hwnd, wasFocused: true });
      return { ok: true };
    },
  },
  {
    name: 'close_window',
    group: 'windows',
    risk: 'danger',
    description: 'Close a window, as its close button would. Unsaved work may be lost.',
    parameters: schema({ hwnd: { type: 'number' }, title: { type: 'string', description: 'For the confirmation.' } }, ['hwnd']),
    summarise: (a) => `Close ${str(a, 'title') || 'a window'}`,
    async run(args) {
      const hwnd = num(args, 'hwnd');
      if (hwnd === null) return { ok: false, error: 'hwnd must be a number from list_windows.' };
      await invoke(SeelenCommand.WegCloseApp, { hwnd });
      return { ok: true };
    },
  },
  {
    name: 'show_desktop',
    group: 'windows',
    risk: 'act',
    description: 'Minimise every window to reveal the desktop; a second call puts them back.',
    summarise: () => 'Show the desktop',
    async run() {
      await showDesktop();
      return { ok: true };
    },
  },
  {
    name: 'list_workspaces',
    group: 'windows',
    risk: 'read',
    description: 'The virtual desktops on this display and which one is active.',
    summarise: () => 'Listed workspaces',
    async run() {
      const desktops = await invoke(SeelenCommand.StateGetVirtualDesktops);
      return {
        workspaces: workspacesOf(desktops, ownMonitorId()).map((e) => ({
          id: e.workspace.id,
          name: e.workspace.name || `Desktop ${e.index}`,
          active: e.active,
          windows: e.workspace.windows.length,
        })),
      };
    },
  },
  {
    name: 'switch_workspace',
    group: 'windows',
    risk: 'act',
    description: 'Switch to a virtual desktop by id, or create a new one with id "new".',
    parameters: schema({ id: { type: 'string', description: 'From list_workspaces, or "new".' } }, ['id']),
    summarise: (a) => (str(a, 'id') === 'new' ? 'Create a workspace' : 'Switch workspace'),
    async run(args) {
      const id = str(args, 'id');
      if (id === 'new') {
        const monitorId = ownMonitorId();
        if (!monitorId) return { ok: false, error: 'This display has no workspaces.' };
        await invoke(SeelenCommand.CreateWorkspace, { monitorId });
      } else {
        await invoke(SeelenCommand.SwitchWorkspace, { workspaceId: id });
      }
      return { ok: true };
    },
  },
  {
    name: 'move_window_to_workspace',
    group: 'windows',
    risk: 'act',
    description: 'Move a window to another virtual desktop.',
    parameters: schema({ hwnd: { type: 'number' }, workspace_id: { type: 'string' } }, ['hwnd', 'workspace_id']),
    summarise: () => 'Move a window to another workspace',
    async run(args) {
      const hwnd = num(args, 'hwnd');
      if (hwnd === null) return { ok: false, error: 'hwnd must be a number.' };
      await invoke(SeelenCommand.MoveWindowToWorkspace, { hwnd, workspaceId: str(args, 'workspace_id') });
      return { ok: true };
    },
  },
];

const MEDIA: ToolDefinition[] = [
  {
    name: 'get_now_playing',
    group: 'media',
    risk: 'read',
    description: 'What is playing, the volume, and each application’s volume and mute state.',
    summarise: () => 'Checked what is playing',
    async run() {
      const [players, device] = await Promise.all([invoke(SeelenCommand.GetMediaSessions), defaultOutput()]);
      return {
        players: players.map((p) => ({ title: p.title, artist: p.author, playing: p.playing, app: p.owner.name })),
        output: device && {
          name: device.name,
          volume: Math.round(device.volume * 100),
          muted: device.muted,
          apps: device.sessions.map((s) => ({ name: sessionLabel(s), volume: Math.round(s.volume * 100), muted: s.muted })),
        },
      };
    },
  },
  {
    name: 'media_control',
    group: 'media',
    risk: 'act',
    description: 'Play, pause or skip whatever is playing.',
    parameters: schema({ action: { type: 'string', enum: ['play_pause', 'next', 'previous'] } }, ['action']),
    summarise: (a) => ({ next: 'Skip to the next track', previous: 'Go to the previous track' })[str(a, 'action')] ?? 'Play or pause',
    async run(args) {
      const id = await defaultPlayerId();
      if (!id) return { ok: false, error: 'Nothing is playing.' };
      const action = str(args, 'action');
      const command = action === 'next' ? SeelenCommand.MediaNext : action === 'previous' ? SeelenCommand.MediaPrev : SeelenCommand.MediaTogglePlayPause;
      await invoke(command, { id });
      return { ok: true, action };
    },
  },
  {
    name: 'set_volume',
    group: 'media',
    risk: 'act',
    description: 'Set the output volume from 0 to 100, for the whole system or for one application.',
    parameters: schema({ level: { type: 'number' }, app: { type: 'string', description: 'Omit for the system volume.' } }, ['level']),
    summarise: (a) => `Set ${str(a, 'app') ? `${str(a, 'app')} volume` : 'the volume'} to ${num(a, 'level') ?? '?'}%`,
    async run(args) {
      const level = num(args, 'level');
      if (level === null) return { ok: false, error: 'level must be a number from 0 to 100.' };
      const device = await defaultOutput();
      if (!device) return { ok: false, error: 'No output device.' };
      const app = str(args, 'app');
      const session = app ? device.sessions.find((s) => matches(sessionLabel(s), app)) : null;
      if (app && !session) return { ok: false, error: `No application called ${app} is making sound.` };
      const clamped = Math.min(1, Math.max(0, level / 100));
      await invoke(SeelenCommand.SetVolumeLevel, { deviceId: device.id, sessionId: session?.id ?? null, level: clamped });
      return { ok: true, level: Math.round(clamped * 100) };
    },
  },
  {
    name: 'set_mute',
    group: 'media',
    risk: 'act',
    description: 'Mute or unmute the system output, or one application.',
    parameters: schema({ muted: { type: 'boolean' }, app: { type: 'string' } }, ['muted']),
    summarise: (a) => `${bool(a, 'muted') === false ? 'Unmute' : 'Mute'} ${str(a, 'app') || 'the sound'}`,
    async run(args) {
      const want = bool(args, 'muted') ?? true;
      const device = await defaultOutput();
      if (!device) return { ok: false, error: 'No output device.' };
      const app = str(args, 'app');
      const session = app ? device.sessions.find((s) => matches(sessionLabel(s), app)) : null;
      if (app && !session) return { ok: false, error: `No application called ${app} is making sound.` };
      const current = session ? session.muted : device.muted;
      // The host only toggles, so it is sent only when the state differs.
      if (current !== want) await invoke(SeelenCommand.MediaToggleMute, { deviceId: device.id, sessionId: session?.id ?? null });
      return { ok: true, muted: want };
    },
  },
  {
    name: 'set_output_device',
    group: 'media',
    risk: 'act',
    description: 'Switch the default speakers or headphones. Call with no name to list them.',
    parameters: schema({ name: { type: 'string' } }),
    summarise: (a) => (str(a, 'name') ? `Switch audio to ${str(a, 'name')}` : 'Listed audio outputs'),
    async run(args) {
      const all = await outputs();
      const name = str(args, 'name');
      if (!name) return { outputs: all.map((d) => ({ name: d.name, default: d.isDefaultMultimedia })) };
      const device = all.find((d) => matches(d.name, name));
      if (!device) return { ok: false, error: `No output matches ${name}.`, outputs: all.map((d) => d.name) };
      await invoke(SeelenCommand.MediaSetDefaultDevice, { id: device.id, role: 'multimedia' });
      return { ok: true, output: device.name };
    },
  },
];

const DEVICES: ToolDefinition[] = [
  {
    name: 'set_brightness',
    group: 'devices',
    risk: 'act',
    description: 'Set display brightness 0-100 on every controllable monitor, or read it when no level is given.',
    parameters: schema({ level: { type: 'number' } }),
    summarise: (a) => (num(a, 'level') === null ? 'Checked brightness' : `Set brightness to ${num(a, 'level')}%`),
    async run(args) {
      const monitors = await invoke(SeelenCommand.GetAllMonitorsBrightness);
      const level = num(args, 'level');
      if (level === null) return { monitors: monitors.map((m) => ({ name: shortMonitorName(m.instanceName), level: m.currentBrightness })) };
      if (!monitors.length) return { ok: false, error: 'No monitor here accepts brightness changes.' };
      for (const monitor of monitors) {
        const levels = levelsOf(monitor);
        const nearest = levels.reduce((best, l) => (Math.abs(l - level) < Math.abs(best - level) ? l : best), levels[0] ?? level);
        await invoke(SeelenCommand.SetMonitorBrightness, { instanceName: monitor.instanceName, level: nearest });
      }
      return { ok: true, monitors: monitors.length };
    },
  },
  {
    name: 'set_radio',
    group: 'devices',
    risk: 'act',
    description: 'Turn Wi-Fi or bluetooth on or off. Turning Wi-Fi off may cut off a cloud model mid-answer.',
    parameters: schema({ radio: { type: 'string', enum: ['wifi', 'bluetooth'] }, on: { type: 'boolean' } }, ['radio', 'on']),
    summarise: (a) => `Turn ${str(a, 'radio') === 'bluetooth' ? 'bluetooth' : 'Wi-Fi'} ${bool(a, 'on') ? 'on' : 'off'}`,
    async run(args) {
      const radios = await invoke(SeelenCommand.GetRadios);
      const wanted = str(args, 'radio') === 'bluetooth' ? 'Bluetooth' : 'WiFi';
      const radio = radios.find((r) => r.kind === wanted);
      if (!radio) return { ok: false, error: `This PC has no ${wanted} radio Windows lets us switch.` };
      await invoke(SeelenCommand.SetRadioState, { kind: radio.kind, enabled: bool(args, 'on') ?? true });
      return { ok: true };
    },
  },
  {
    name: 'bluetooth_devices',
    group: 'devices',
    risk: 'read',
    description: 'Paired bluetooth devices and whether each is connected.',
    summarise: () => 'Listed bluetooth devices',
    async run() {
      const devices = await invoke(SeelenCommand.GetBluetoothDevices);
      return { devices: devices.filter((d) => d.paired || d.connected).map((d) => ({ name: d.name, kind: d.class.major, connected: d.connected })) };
    },
  },
  {
    name: 'bluetooth_connect',
    group: 'devices',
    risk: 'act',
    description: 'Connect or disconnect a paired bluetooth device by name.',
    parameters: schema({ name: { type: 'string' }, connect: { type: 'boolean' } }, ['name', 'connect']),
    summarise: (a) => `${bool(a, 'connect') === false ? 'Disconnect' : 'Connect'} ${str(a, 'name')}`,
    async run(args) {
      const devices = await invoke(SeelenCommand.GetBluetoothDevices);
      const device = devices.find((d) => matches(d.name, str(args, 'name')));
      if (!device) return { ok: false, error: `No paired device matches ${str(args, 'name')}.` };
      if (bool(args, 'connect') === false) await invoke(SeelenCommand.DisconnectBluetoothDevice, { id: device.id });
      else await invoke(SeelenCommand.ConnectBluetoothDevice, { id: device.id });
      return { ok: true, device: device.name };
    },
  },
  {
    name: 'set_focus_assist',
    group: 'devices',
    risk: 'act',
    description: 'Turn Windows focus assist (do not disturb) on or off.',
    parameters: schema({ on: { type: 'boolean' } }, ['on']),
    summarise: (a) => `Turn focus assist ${bool(a, 'on') ? 'on' : 'off'}`,
    async run(args) {
      await invoke(SeelenCommand.SetFocusAssist, { enabled: bool(args, 'on') ?? true });
      return { ok: true };
    },
  },
];

const FILES: ToolDefinition[] = [
  {
    name: 'list_folder',
    group: 'files',
    risk: 'read',
    sensitive: true,
    description: `List a known folder (${FOLDER_NAMES.join(', ')}) or a subfolder inside one. Paths returned can be passed to open.`,
    parameters: schema(
      {
        folder: { type: 'string', enum: FOLDER_NAMES },
        subfolder: { type: 'string', description: 'Relative path inside it, e.g. "invoices\\\\2026".' },
      },
      ['folder'],
    ),
    summarise: (a) => `Looked in ${[str(a, 'folder'), str(a, 'subfolder')].filter(Boolean).join('\\')}`,
    async run(args) {
      const folder = folderFrom(str(args, 'folder'));
      if (!folder) return { error: `folder must be one of ${FOLDER_NAMES.join(', ')}.` };
      const paths = await folderPaths(folder);
      const root = commonRoot(paths);
      const sub = str(args, 'subfolder').replace(/^[\\/]+|[\\/]+$/g, '');
      const listing = listDirectory(paths, sub ? `${root}\\${sub}` : root, { limit: 60, sort: 'name' });
      return {
        path: sub ? `${root}\\${sub}` : root,
        total: listing.total,
        entries: listing.entries.map((e) => ({ name: e.name, path: e.path, folder: e.directory })),
      };
    },
  },
  {
    name: 'search_files',
    group: 'files',
    risk: 'read',
    sensitive: true,
    description: 'Find files by name across Downloads, Documents, Desktop, Pictures, Music and Videos.',
    parameters: schema({ query: { type: 'string', description: 'Part of the file name.' } }, ['query']),
    summarise: (a) => `Searched files for “${str(a, 'query')}”`,
    async run(args) {
      const needle = str(args, 'query').trim().toLowerCase();
      if (!needle) return { error: 'query is required.' };
      const found: { name: string; path: string }[] = [];
      for (const folder of [FolderType.Downloads, FolderType.Documents, FolderType.Desktop, FolderType.Pictures, FolderType.Music, FolderType.Videos]) {
        const paths = await folderPaths(folder).catch(() => [] as string[]);
        for (const path of paths) {
          if (/node_modules|\\\.git\\/i.test(path)) continue;
          const name = displayName(path);
          if (name.toLowerCase().includes(needle)) found.push({ name, path });
          if (found.length >= 40) break;
        }
        if (found.length >= 40) break;
      }
      return { matches: found };
    },
  },
];

const CLIPBOARD: ToolDefinition[] = [
  {
    name: 'get_clipboard_history',
    group: 'clipboard',
    risk: 'read',
    sensitive: true,
    description: 'Recent clipboard entries, newest first.',
    summarise: () => 'Read the clipboard history',
    async run() {
      const data = await invoke(SeelenCommand.ClipboardGetData);
      if (!data.isHistoryEnabled) return { error: 'Clipboard history is off in Windows settings.' };
      return { entries: data.history.slice(0, 10).map((e) => ({ id: e.id, app: e.sourceAppName, ...previewOf(e), image: undefined })) };
    },
  },
  {
    name: 'paste_clipboard_entry',
    group: 'clipboard',
    risk: 'act',
    description: 'Put a clipboard history entry back on the clipboard, ready to paste.',
    parameters: schema({ id: { type: 'string' } }, ['id']),
    summarise: () => 'Copy a clipboard entry back',
    async run(args) {
      await invoke(SeelenCommand.ClipboardSetContent, { id: str(args, 'id') });
      return { ok: true };
    },
  },
];

const NOTES: ToolDefinition[] = [
  {
    name: 'get_notes',
    group: 'notes',
    risk: 'read',
    description: 'The notes panel: its free-text note and the todo list.',
    summarise: () => 'Read your notes',
    async run() {
      return { note: notes.state.note, todos: notes.state.todos.map((t) => ({ id: t.id, text: t.text, done: t.done })) };
    },
  },
  {
    name: 'add_todo',
    group: 'notes',
    risk: 'act',
    description: 'Add one or more items to the todo list.',
    parameters: schema({ items: { type: 'array', items: { type: 'string' } } }, ['items']),
    summarise: (a) => `Add ${Array.isArray(a.items) ? a.items.length : 1} todo${Array.isArray(a.items) && a.items.length === 1 ? '' : 's'}`,
    async run(args) {
      const items = Array.isArray(args.items) ? args.items.map(String) : [str(args, 'items')];
      for (const item of items) notes.addTodo(item);
      return { ok: true, added: items.filter((i) => i.trim()).length };
    },
  },
  {
    name: 'complete_todo',
    group: 'notes',
    risk: 'act',
    description: 'Tick off (or untick) a todo by id or by part of its text.',
    parameters: schema({ todo: { type: 'string' }, done: { type: 'boolean' } }, ['todo']),
    summarise: (a) => `Mark “${str(a, 'todo')}” ${bool(a, 'done') === false ? 'not done' : 'done'}`,
    async run(args) {
      const wanted = str(args, 'todo');
      const todo = notes.state.todos.find((t) => t.id === wanted) ?? notes.state.todos.find((t) => matches(t.text, wanted));
      if (!todo) return { ok: false, error: 'No todo matches.' };
      const done = bool(args, 'done') ?? true;
      if (todo.done !== done) notes.toggleTodo(todo.id);
      return { ok: true, todo: todo.text, done };
    },
  },
  {
    name: 'append_note',
    group: 'notes',
    risk: 'act',
    description: 'Add text to the end of the free-text note.',
    parameters: schema({ text: { type: 'string' } }, ['text']),
    summarise: () => 'Add to your note',
    async run(args) {
      const text = str(args, 'text').trim();
      if (!text) return { ok: false, error: 'text is required.' };
      notes.state.note = notes.state.note.trim() ? `${notes.state.note.trimEnd()}\n${text}` : text;
      notes.save();
      return { ok: true };
    },
  },
];

/** Keys the assistant may not change about itself, so it cannot take its own brakes off. */
const PROTECTED: ReadonlySet<string> = new Set(['enabled', 'moduleChat', 'chatTools']);

function fieldDef(key: ConfigKey) {
  for (const kind of MODULE_ORDER) {
    const field = MODULES[kind].fields.find((f) => f.key === key);
    if (field) return field;
  }
  return null;
}

const DESKTOP: ToolDefinition[] = [
  {
    name: 'get_desktop_settings',
    group: 'desktop',
    risk: 'read',
    description: 'The modules on this desktop surface, whether each is shown, and each one’s settings with current values.',
    parameters: schema({ module: { type: 'string', description: 'Omit to list modules only.' } }),
    summarise: () => 'Read desktop settings',
    async run(args) {
      const cfg = config.current as unknown as Record<string, unknown>;
      const wanted = str(args, 'module');
      const kind = MODULE_ORDER.find((k) => k === wanted || matches(MODULES[k].title, wanted));
      if (!wanted || !kind) {
        return { modules: MODULE_ORDER.map((k) => ({ id: k, title: MODULES[k].title, shown: cfg[MODULES[k].enabledKey] === true })) };
      }
      return {
        module: kind,
        settings: MODULES[kind].fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          value: cfg[f.key],
          ...(f.options ? { options: f.options.map((o) => o.value) } : {}),
          ...(f.type === 'range' ? { min: f.min, max: f.max } : {}),
        })),
      };
    },
  },
  {
    name: 'set_desktop_setting',
    group: 'desktop',
    risk: 'act',
    description:
      'Change one desktop surface setting by key, e.g. moduleClock true to show the clock, clock24h false. Keys and allowed values come from get_desktop_settings.',
    parameters: schema({ key: { type: 'string' }, value: { description: 'boolean, number or string to match the setting.' } }, ['key', 'value']),
    summarise: (a) => `Set ${str(a, 'key')} to ${JSON.stringify(a.value)}`,
    async run(args) {
      const key = str(args, 'key');
      if (!Object.hasOwn(DEFAULT_CONFIG, key) || PROTECTED.has(key)) return { ok: false, error: `${key} is not a setting that can be changed here.` };
      const current = DEFAULT_CONFIG[key as ConfigKey];
      let value: unknown = args.value;
      if (typeof current === 'boolean') value = bool(args, 'value');
      else if (typeof current === 'number') value = num(args, 'value');
      else value = typeof value === 'string' ? value : null;
      if (value === null || value === undefined) return { ok: false, error: `${key} takes a ${typeof current}.` };
      const field = fieldDef(key as ConfigKey);
      if (field?.options && !field.options.some((o) => o.value === value)) {
        return { ok: false, error: `${key} must be one of ${field.options.map((o) => o.value).join(', ')}.` };
      }
      if (typeof value === 'number' && field?.type === 'range') {
        value = Math.min(field.max ?? value, Math.max(field.min ?? value, value));
      }
      config.set(key as never, value as never, 'auto');
      return { ok: true, key, value };
    },
  },
];

const POWER_ACTIONS = {
  lock: { command: SeelenCommand.Lock, label: 'Lock the PC' },
  sleep: { command: SeelenCommand.Suspend, label: 'Put the PC to sleep' },
  hibernate: { command: SeelenCommand.Hibernate, label: 'Hibernate the PC' },
  sign_out: { command: SeelenCommand.LogOut, label: 'Sign out of Windows' },
  restart: { command: SeelenCommand.Restart, label: 'Restart the PC' },
  shut_down: { command: SeelenCommand.Shutdown, label: 'Shut down the PC' },
} as const;

type PowerAction = keyof typeof POWER_ACTIONS;

const POWER: ToolDefinition[] = [
  {
    name: 'power_action',
    group: 'power',
    risk: (a) => (str(a, 'action') === 'lock' ? 'act' : 'danger'),
    description: 'Lock, sleep, hibernate, sign out, restart or shut down this PC.',
    parameters: schema({ action: { type: 'string', enum: Object.keys(POWER_ACTIONS) } }, ['action']),
    summarise: (a) => POWER_ACTIONS[str(a, 'action') as PowerAction]?.label ?? 'Change power state',
    async run(args) {
      const action = POWER_ACTIONS[str(args, 'action') as PowerAction];
      if (!action) return { ok: false, error: 'Unknown action.' };
      await invoke(action.command);
      return { ok: true };
    },
  },
  {
    name: 'empty_recycle_bin',
    group: 'power',
    risk: 'danger',
    description: 'Permanently delete everything in the recycle bin. This cannot be undone.',
    summarise: () => 'Permanently empty the recycle bin',
    async run() {
      await invoke(SeelenCommand.TrashBinEmpty);
      return { ok: true };
    },
  },
];

export const PC_TOOLS: readonly ToolDefinition[] = [
  ...SYSTEM,
  ...APPS,
  ...WINDOWS,
  ...MEDIA,
  ...DEVICES,
  ...FILES,
  ...CLIPBOARD,
  ...NOTES,
  ...DESKTOP,
  ...POWER,
];

/**
 * A short description of the machine, added to the system prompt.
 *
 * Deliberately small and cheap: the few lines that would otherwise cost a tool
 * round trip every single turn ("what time is it", "is it charging"). Anything
 * more specific is what the tools are for. Every field is best-effort - a host
 * that cannot answer one leaves it out rather than failing the turn.
 */
export async function contextCard(): Promise<string> {
  const lines: string[] = [];
  const now = new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  lines.push(`Local time: ${now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} (${zone})`);

  const [cores, memory, power, players, windows, focused] = await Promise.all([
    invoke(SeelenCommand.GetSystemCores).catch(() => null),
    invoke(SeelenCommand.GetSystemMemory).catch(() => null),
    invoke(SeelenCommand.GetPowerStatus).catch(() => null),
    invoke(SeelenCommand.GetMediaSessions).catch(() => null),
    invoke(SeelenCommand.GetUserAppWindows).catch(() => null),
    invoke(SeelenCommand.GetFocusedApp).catch(() => null),
  ]);

  if (cores?.length && memory) {
    const cpu = Math.round(cores.reduce((sum, c) => sum + c.usage, 0) / cores.length);
    lines.push(`CPU ${cpu}% across ${cores.length} cores, memory ${formatBytes(memory.total - memory.free)} of ${formatBytes(memory.total)}`);
  }
  if (power && power.batteryLifePercent <= 100) {
    lines.push(`Power: ${power.acLineStatus === 1 ? 'on mains' : 'on battery'}, charge ${power.batteryLifePercent}%`);
  }
  const playing = players?.find((p) => p.playing);
  if (playing) lines.push(`Playing: ${playing.title} - ${playing.author}`);
  if (focused?.name) lines.push(`Focused: ${focused.name}${focused.title ? ` - ${focused.title.slice(0, 80)}` : ''}`);
  if (windows?.length) {
    const names = [...new Set(windows.map((w) => w.appName))].slice(0, 8);
    lines.push(`${windows.length} windows open (${names.join(', ')})`);
  }
  return lines.join('\n');
}
