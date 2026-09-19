<script lang="ts">
  import { onMount } from 'svelte';

  import { DEFAULT_CONFIG, config } from '$lib/config.svelte';
  import { applySurfaceVars, applyUserCss } from '$lib/appearance';
  import { lookById, resolveLook } from '$lib/looks';
  import type { AppearanceTab } from '$lib/appearance-fields';
  import { MODULES, MODULE_ORDER } from '$lib/modules';
  import { icons } from '$lib/icons.svelte';
  import { media } from '$lib/media.svelte';
  import { notes } from '$lib/notes.svelte';
  import { chat } from '$lib/chat.svelte';
  import { voice } from '$lib/voice.svelte';
  import { store } from '$lib/store.svelte';
  import { system } from '$lib/system.svelte';
  import { SeelenCommand, invoke } from '$lib/seelen';
  import { addDays, toDateKey } from '$lib/agenda';

  import Panel from '$modules/Panel.svelte';
  import ModuleView from '$modules/ModuleView.svelte';
  import IconView from '$modules/launcher/IconView.svelte';
  import ContextMenu from '$modules/ContextMenu.svelte';
  import ModuleSettings from '$modules/ModuleSettings.svelte';
  import AppearanceSettings from '$modules/AppearanceSettings.svelte';
  import { applyLook } from '$lib/apply-appearance';
  import AssistantSettings from '$modules/chat/AssistantSettings.svelte';
  import GameMode from '$modules/gamemode/GameMode.svelte';
  import GameModeSettings from '$modules/gamemode/GameModeSettings.svelte';
  import Overlay from '../overlay/Overlay.svelte';
  import { gameMode } from '$lib/gamemode.svelte';
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import { MODULE_GROUPS, modulesInGroup } from '$lib/modules';
  import type { PanelKind } from '$lib/store.svelte';

  /**
   * The surface at 3440x1440, the widest display `DEFAULT_PANEL_LAYOUT` is
   * drawn for: the first twenty modules sit inside its left 1620x1050, the
   * larger ones added later in the columns to their right. Everything below
   * seeds the real stores and then gets out of the way - the panels, their
   * chrome and their contents are the shipped components.
   */
  const STAGE = { width: 3440, height: 1440 };

  /** Defaults, with every module switched on. */
  const previewConfig = { ...DEFAULT_CONFIG };
  // Recent is a flat folder of shortcuts; Downloads is where the Files module
  // has a tree to browse, which is what its chrome is for.
  previewConfig.filesFolder = 'Downloads';
  // A place, so the Weather panel previews a forecast - fetched for real from
  // Open-Meteo, which answers any origin - rather than its place search.
  previewConfig.weatherPlace = 'Berlin, Germany';
  // The shipped default is the local Ollama, which a `file://` preview cannot
  // reach (it allows localhost origins only), so the panel would preview its
  // "not reachable" card rather than a conversation. `?assistant=live`, with
  // the preview served over http://localhost, talks to the real Ollama instead
  // - the whole agent loop against a real model, with mock host tools.
  const liveAssistant = new URLSearchParams(location.search).get('assistant') === 'live';
  previewConfig.chatProvider = liveAssistant ? 'ollama' : 'gemini';
  for (const kind of MODULE_ORDER) {
    (previewConfig as Record<string, unknown>)[MODULES[kind].enabledKey] = true;
  }

  /*
   * `?look=terminal` and `?scheme=nord` dress the stage before anything mounts,
   * so a screenshot per look needs no clicking; `?ui=appearance` (or
   * `appearance-css`, `appearance-share`, ...) opens the Appearance dialog on a
   * tab. From the rig, `__applyLook('retro')` and `__config.set(...)` change it
   * live, through the same store the surface writes.
   */
  const params = new URLSearchParams(location.search);
  const startLook = lookById(params.get('look') ?? '');
  if (startLook) Object.assign(previewConfig, resolveLook(startLook, DEFAULT_CONFIG));
  const startScheme = params.get('scheme');
  if (startScheme) (previewConfig as Record<string, unknown>).colorScheme = startScheme;
  config.current = previewConfig;

  Object.assign(globalThis, {
    __config: config,
    __applyLook: (id: string) => {
      const look = lookById(id);
      if (look) applyLook(look);
    },
  });

  $effect(() => applyUserCss(config.current.customCss));

  const appearanceUi = params.get('ui')?.match(/^appearance(?:-(\w+))?$/);
  if (appearanceUi) {
    overlay.openDialog(AppearanceSettings, {
      tab: (appearanceUi[1] ?? 'looks') as AppearanceTab,
      onclose: () => overlay.closeDialog(),
    });
  }

  // The rig drives the voice mode from the Browser tool: it plays recorded
  // clips through `__voice.transcribeClip`, and puts the panel into a phase to
  // look at it, since a preview tab has no microphone to open.
  Object.assign(globalThis, { __voice: voice, __chat: chat });

  /**
   * Stand-in app icons.
   *
   * The real ones come from Seelen's icon packs, which need the host; a
   * coloured tile per target at least shows where an icon sits and that a list
   * of them reads properly.
   */
  function fakeIcon(key: string): string {
    let hash = 7;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 3600;
    const hue = hash % 360;
    const name = key.split(/[\\/]/).pop() ?? key;
    const letter = (name.replace(/\.(exe|lnk|url)$/i, '')[0] ?? '?').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="hsl(${hue} 55% 46%)"/>
      <text x="16" y="22" font-family="Segoe UI, sans-serif" font-size="17"
        font-weight="600" fill="#fff" text-anchor="middle">${letter}</text>
    </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  icons.resolve = (query) => fakeIcon(query.umid ?? query.path ?? '?');
  icons.resolveWithOverride = (_override, query) => fakeIcon(query.umid ?? query.path ?? '?');

  // A few launcher icons, along the strip under every panel.
  store.state.icons = [
    ['Firefox', 'app'],
    ['Visual Studio Code', 'app'],
    ['Downloads', 'folder'],
    ['README.md', 'file'],
    ['Seelen UI', 'app'],
  ].map(([label, kind], i) => ({
    id: `preview-icon-${i}`,
    label: label as string,
    target: `C:\\Preview\\${label}`,
    kind: kind as 'app' | 'file' | 'folder',
    umid: null,
    x: 40 + i * 104,
    y: 1260,
  }));

  let ready = $state(false);

  /* The surface's opening wave, as `Surface.svelte` runs it. */
  let booting = $state(true);

  $effect(() => {
    if (!ready) return;
    const timer = setTimeout(() => (booting = false), 2600);
    return () => clearTimeout(timer);
  });

  /**
   * `?ui=menu` and `?ui=settings` open one of the two things a screenshot of a
   * static surface would otherwise miss. The menu is rebuilt here rather than
   * imported because `Surface.svelte` owns it; it is the same shape.
   */
  const ui = new URLSearchParams(location.search).get('ui');

  function toggleItem(key: string, label: string): MenuItem {
    return {
      label,
      checked: (config.current as unknown as Record<string, unknown>)[key] === true,
      action: () => {},
    };
  }

  function modulesSubmenu(): MenuItem[] {
    const items: MenuItem[] = [];
    for (const group of MODULE_GROUPS) {
      items.push({ label: group.label, header: true });
      for (const kind of modulesInGroup(group.id)) {
        items.push(toggleItem(MODULES[kind].enabledKey, MODULES[kind].title));
      }
    }
    return items;
  }

  function panelMenu(kind: PanelKind): MenuItem[] {
    const module = MODULES[kind];
    return [
      { label: module.title, header: true },
      ...module.quick.map((key) => {
        const field = module.fields.find((f) => f.key === key);
        return toggleItem(key, field?.label ?? key);
      }),
      menuSeparator,
      { label: `${module.title} settings...`, action: () => {} },
      menuSeparator,
      {
        label: 'Hide this module',
        items: [
          { label: 'On this display', action: () => {} },
          { label: 'On all displays', action: () => {} },
        ],
      },
      { label: 'Modules', items: modulesSubmenu() },
      menuSeparator,
      { label: 'Reset size', action: () => {} },
      { label: 'Reset position', action: () => {} },
      { label: 'Use the same settings as other displays', disabled: true, action: () => {} },
      menuSeparator,
      { label: 'Desktop settings...', action: () => {} },
    ];
  }

  $effect(() => applySurfaceVars(config.current));

  /**
   * A few weeks of plausible data for the newer modules, written through the
   * mock's data directory before any panel mounts - so each one reads a file the
   * way it does on the host, rather than being handed state directly.
   */
  async function seedNewerModules(): Promise<void> {
    const write = (filename: string, value: unknown) =>
      invoke(SeelenCommand.WriteFile, { filename, content: JSON.stringify(value) });
    const today = toDateKey(new Date());
    const day = (offset: number) => addDays(today, offset);
    const synced = (collections: Record<string, unknown[]>) => ({ version: 1, collections, deleted: {} });

    // Screen time: a week of work in a handful of apps.
    const usageApps = {
      'exe:code.exe': { name: 'Visual Studio Code', exe: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', umid: null },
      'exe:firefox.exe': { name: 'Firefox', exe: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', umid: null },
      'exe:spotify.exe': { name: 'Spotify', exe: 'C:\\Users\\preview\\AppData\\Roaming\\Spotify\\Spotify.exe', umid: null },
      'exe:windowsterminal.exe': { name: 'Terminal', exe: 'C:\\Program Files\\WindowsApps\\Terminal\\WindowsTerminal.exe', umid: null },
      'exe:discord.exe': { name: 'Discord', exe: 'C:\\Users\\preview\\AppData\\Local\\Discord\\Discord.exe', umid: null },
      'exe:factorio.exe': { name: 'Factorio', exe: 'D:\\SteamLibrary\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe', umid: null },
    };
    const shape = [
      [3.2, 1.6, 0.9, 0.7, 0.4, 0.0],
      [4.1, 1.2, 1.1, 0.9, 0.2, 0.0],
      [2.4, 2.0, 0.6, 0.5, 0.8, 1.9],
      [3.8, 1.4, 1.0, 1.1, 0.3, 0.0],
      [1.1, 1.9, 0.4, 0.2, 1.2, 3.1],
      [3.5, 1.3, 1.2, 0.8, 0.5, 0.4],
      [2.6, 1.1, 0.8, 0.6, 0.3, 0.0],
    ];
    const keys = Object.keys(usageApps);
    await write('usage.json', {
      version: 1,
      apps: usageApps,
      days: Object.fromEntries(
        shape.map((hours, i) => [day(i - 6), Object.fromEntries(keys.map((key, k) => [key, (hours[k] ?? 0) * 3600]))]),
      ),
      switches: { [today]: 146 },
    });

    const event = (id: string, title: string, date: string, time: string | null, extra: Record<string, unknown> = {}) => ({
      id, title, date, time, duration: null, repeat: 'none', until: null, colour: 'blue', remind: null, note: '', updatedAt: 1, ...extra,
    });
    await write('agenda.json', synced({
      events: [
        event('e1', 'Stand-up', day(0), '09:30', { duration: 15, repeat: 'weekdays', colour: 'teal', remind: 5 }),
        event('e2', 'Design review', day(0), '14:00', { duration: 60, colour: 'purple', note: 'Bring the module screenshots' }),
        event('e3', 'Dentist', day(1), '08:15', { colour: 'red', remind: 30 }),
        event('e4', 'Ship desk.top 0.2', day(2), null, { colour: 'green' }),
        event('e5', 'Gym', day(3), '18:00', { duration: 90, repeat: 'weekly', colour: 'amber' }),
        event('e6', 'Ada\u2019s birthday', day(5), null, { repeat: 'yearly', colour: 'pink' }),
      ],
      fired: [],
    }));

    const card = (id: string, columnId: string, title: string, order: number, extra: Record<string, unknown> = {}) => ({
      id, columnId, title, note: '', label: null, due: null, order, createdAt: 1, updatedAt: 1, ...extra,
    });
    await write('board.json', synced({
      columns: [
        { id: 'column-todo', title: 'To do', order: 1, updatedAt: 1 },
        { id: 'column-doing', title: 'Doing', order: 2, updatedAt: 1 },
        { id: 'column-done', title: 'Done', order: 3, updatedAt: 1 },
      ],
      cards: [
        card('c1', 'column-todo', 'Write the release notes', 1, { label: 'blue', due: day(2) }),
        card('c2', 'column-todo', 'Check the tray icons on a laptop', 2, { note: 'Battery and Wi-Fi icons change often' }),
        card('c3', 'column-todo', 'Translate the settings to German', 3, { label: 'purple' }),
        card('c4', 'column-doing', 'Screenshot every new module', 1, { label: 'orange', due: day(0) }),
        card('c5', 'column-doing', 'Measure memory with all modules on', 2, { label: 'red', due: day(-1) }),
        card('c6', 'column-done', 'Board drag and drop', 1, { label: 'green' }),
        card('c7', 'column-done', 'Weather from Open-Meteo', 2),
      ],
    }));

    const habitList = [
      ['h1', 'Read 20 pages', 'blue', 7, 0.8],
      ['h2', 'Gym', 'amber', 3, 0.45],
      ['h3', 'No phone after 22:00', 'purple', 7, 0.6],
      ['h4', 'Water the plants', 'green', 2, 0.3],
    ] as const;
    const checks: unknown[] = [];
    habitList.forEach(([id, , , , rate], h) => {
      for (let i = 0; i < 112; i++) {
        // Deterministic, and denser recently, so a streak shows.
        const noise = Math.abs(Math.sin((i + 1) * (h + 3) * 12.9898)) % 1;
        if (noise < rate + (i < 6 ? 0.3 : 0)) checks.push({ id: `${id}@${day(-i)}`, habitId: id, date: day(-i), updatedAt: 1 });
      }
    });
    await write('habits.json', synced({
      habits: habitList.map(([id, name, colour, perWeek], i) => ({ id, name, colour, perWeek, order: i + 1, createdAt: 1, updatedAt: 1 })),
      checks,
    }));

    const now = Date.now();
    await write('alarms.json', synced({
      timers: [
        { id: 't1', label: 'Tea', duration: 240_000, endsAt: now + 151_000, remaining: 240_000, done: false, createdAt: 1, updatedAt: 1 },
        { id: 't2', label: 'Focus', duration: 1_500_000, endsAt: null, remaining: 912_000, done: false, createdAt: 2, updatedAt: 1 },
      ],
      alarms: [
        { id: 'a1', label: 'Wake up', time: '07:00', days: [1, 2, 3, 4, 5], enabled: true, snoozeUntil: null, lastRang: now, createdAt: 1, updatedAt: 1 },
        { id: 'a2', label: '', time: '09:30', days: [0, 6], enabled: false, snoozeUntil: null, lastRang: now, createdAt: 2, updatedAt: 1 },
      ],
    }));

    await write('calculator.json', {
      version: 1,
      variables: { ans: 1073.741824 },
      history: [
        ['1 GiB to MB', '1,073.741824 MB', 1073.741824],
        ['200 + 19%', '238', 238],
        ['60 km/h in mph', '37.28227153 mph', 37.28227153],
        ['sqrt(2)*pi', '4.442882938', 4.442882938],
      ].map(([expression, result, value], i) => ({ id: `calc-${i}`, expression, result, value, at: now - i * 60_000 })),
    });
  }

  onMount(() => {
    void (async () => {
      await seedNewerModules();
      await notes.load();
      await Promise.all([media.start(), system.start()]);

      // The sparklines need a history the host would have built up over a few
      // minutes; one sample would draw nothing at all.
      const wave = (base: number, amp: number, phase: number) =>
        Array.from({ length: 60 }, (_, i) =>
          Math.max(2, Math.min(98, base + Math.sin(i / 5 + phase) * amp + Math.sin(i / 1.7) * 4)),
        );
      system.cpuHistory = wave(28, 16, 0);
      system.ramHistory = wave(61, 5, 2);

      if (liveAssistant) {
        await chat.load();
        chat.claimTimers();
      } else {
        // A stand-in key and one exchange that used tools, so the assistant
        // panel previews an agent turn rather than the "paste a key" form.
        chat.setKey('gemini', 'preview-key-not-a-credential');
        const now = Date.now();
        const answer =
          'Your PC is fine: **CPU 25%**, 19.6 GB of 32 GB memory in use, and 284 GB free on `C:`.\n\nBerlin right now:\n- Partly cloudy, **18°C**\n- Rain likely tomorrow afternoon';
        chat.file.conversations = [
          {
            id: 'preview-conv',
            title: 'How is my PC doing?',
            createdAt: now,
            updatedAt: now,
            messages: [
              { id: 'preview-msg-1', role: 'user', at: now, text: 'How is my PC doing, and is it going to rain in Berlin?' },
              {
                id: 'preview-msg-2',
                role: 'assistant',
                at: now,
                text: answer,
                via: 'Gemini · gemini-2.5-flash',
                parts: [
                  { kind: 'thinking', text: 'Check the machine, then the weather.', ms: 1400 },
                  { kind: 'tool', call: { id: 'p1', name: 'get_system_status', args: {} }, label: 'Checked system status', status: 'done', result: { cpuPercent: 25 } },
                  { kind: 'tool', call: { id: 'p2', name: 'get_weather', args: { place: 'Berlin' } }, label: 'Checked the weather in Berlin', status: 'done', result: { now: { temperatureC: 18 } } },
                  { kind: 'text', text: answer },
                ],
              },
            ],
          },
        ];
        chat.file.activeId = 'preview-conv';
      }

      ready = true;

      // Game mode holds the library and the pad reader itself, so it is opened
      // through its own entry point rather than by setting a flag - the preview
      // then exercises exactly what the surface does.
      if (ui === 'gamemode') {
        gameMode.enter('the preview');
        Object.assign(globalThis, { __gameMode: gameMode });
      }
    })();
  });
</script>

<main class="surface" class:booting>
  <div class="wallpaper"></div>

  <!--
    `?ui=gamemode` draws the launcher over the stage, which is the only way to
    look at it: on a real machine it is a desktop sitting behind every window.
    `?ui=gamemode-settings` opens its dialog instead, and `?ui=overlay` draws the
    in-game overlay widget. `__gameMode.go('library')` from the rig moves game
    mode between its sections.
  -->
  {#if ready && ui === 'gamemode'}
    <GameMode />
  {/if}

  {#if ready}
    <div class="items">
      {#each store.state.icons as icon (icon.id)}
        <IconView
          {icon}
          bounds={STAGE}
          selected={false}
          onselect={() => {}}
          oncontext={() => {}}
        />
      {/each}

      {#each store.state.panels as panel (panel.id)}
        <Panel {panel} bounds={STAGE} title={MODULES[panel.kind].title} onmenu={() => {}}>
          <ModuleView kind={panel.kind} covered={false} />
        </Panel>
      {/each}
    </div>

    {#if ui === 'menu'}
      <ContextMenu x={700} y={120} items={panelMenu('network')} onclose={() => {}} />
    {:else if ui === 'settings'}
      <ModuleSettings kind="network" onclose={() => {}} />
    {:else if ui === 'games'}
      <ModuleSettings kind="games" onclose={() => {}} />
    {:else if ui === 'gamemode-settings'}
      <GameModeSettings onclose={() => {}} />
    {:else if ui === 'overlay'}
      <!-- The separate `@ralfm/overlay` widget, drawn here rather than in its own
           window: in the rig there is nothing for it to be an overlay over. -->
      <Overlay />
    {:else if ui?.startsWith('assistant')}
      <AssistantSettings onclose={() => {}} tab={(ui.split('-')[1] ?? 'model') as 'model'} />
    {/if}

    <!-- The same overlay layer the surface renders, so a module's own menus and
         dialogs work here too. -->
    {#if overlay.menu}
      {@const open = overlay.menu}
      <ContextMenu x={open.x} y={open.y} items={open.items} onclose={() => overlay.closeMenu()} />
    {/if}

    {#if overlay.dialog}
      {@const Dialog = overlay.dialog.component}
      <Dialog {...overlay.dialog.props} />
    {/if}
  {/if}
</main>

<style>
  .surface {
    position: relative;
    width: 3440px;
    height: 1440px;
    overflow: hidden;
  }

  /* Something for the panels' translucency and blur to sit over. */
  .wallpaper {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 18% 22%, #2b3a67 0%, transparent 52%),
      radial-gradient(circle at 76% 12%, #5b3b6e 0%, transparent 46%),
      radial-gradient(circle at 62% 88%, #1f5e63 0%, transparent 50%),
      linear-gradient(155deg, #0d1017 0%, #151a26 55%, #0b0d13 100%);
  }

  .items {
    position: absolute;
    inset: 0;
  }
</style>
