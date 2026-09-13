<script lang="ts">
  import { onMount } from 'svelte';

  import { DEFAULT_CONFIG, config } from '$lib/config.svelte';
  import { applySurfaceVars } from '$lib/appearance';
  import { MODULES, MODULE_ORDER } from '$lib/modules';
  import { icons } from '$lib/icons.svelte';
  import { media } from '$lib/media.svelte';
  import { notes } from '$lib/notes.svelte';
  import { chat } from '$lib/chat.svelte';
  import { voice } from '$lib/voice.svelte';
  import { store } from '$lib/store.svelte';
  import { system } from '$lib/system.svelte';

  import Panel from '$modules/Panel.svelte';
  import ModuleView from '$modules/ModuleView.svelte';
  import IconView from '$modules/launcher/IconView.svelte';
  import ContextMenu from '$modules/ContextMenu.svelte';
  import ModuleSettings from '$modules/ModuleSettings.svelte';
  import AssistantSettings from '$modules/chat/AssistantSettings.svelte';
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import { MODULE_GROUPS, modulesInGroup } from '$lib/modules';
  import type { PanelKind } from '$lib/store.svelte';

  /**
   * The surface at 1920x1080, which is what `DEFAULT_PANEL_LAYOUT` is drawn
   * for. Everything below seeds the real stores and then gets out of the way -
   * the panels, their chrome and their contents are the shipped components.
   */
  const STAGE = { width: 1920, height: 1080 };

  /** Defaults, with every module switched on. */
  const previewConfig = { ...DEFAULT_CONFIG };
  // Recent is a flat folder of shortcuts; Downloads is where the Files module
  // has a tree to browse, which is what its chrome is for.
  previewConfig.filesFolder = 'Downloads';
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
  config.current = previewConfig;

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

  // A few launcher icons, in the strip the default panel layout leaves free.
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
    x: 1690,
    y: 40 + i * 104,
  }));

  let ready = $state(false);

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

  onMount(() => {
    void (async () => {
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
    })();
  });
</script>

<main class="surface">
  <div class="wallpaper"></div>

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
    width: 1920px;
    height: 1080px;
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
