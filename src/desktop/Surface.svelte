<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SeelenSettingsWidgetId } from '@seelen-ui/lib';

  import { Disposables, SeelenCommand, SeelenEvent, Widget, invoke, subscribe } from '$lib/seelen';
  import { keepFittedToMonitor } from '$lib/surface';
  import { resolveOwnMonitor } from '$lib/monitor';
  import { keepTextInputUsable } from '$lib/input';
  import { firedShortcut } from '$lib/hotkeys';
  import { applySurfaceVars, applyUserCss } from '$lib/appearance';
  import { syncShellStyle } from '$lib/shellstyle';
  import { sampleWallpaperTint } from '$lib/glass';
  import { DEFAULT_CONFIG, config, type ConfigKey } from '$lib/config.svelte';
  import { LOOKS, currentLook } from '$lib/looks';
  import { SCHEME_OPTIONS, schemePolarity } from '$lib/schemes';
  import { MODULES, MODULE_GROUPS, MODULE_ORDER, moduleKeys, modulesInGroup } from '$lib/modules';
  import { findFreeSpot, isOffSurface, overlaps, store, type PanelKind } from '$lib/store.svelte';
  import { icons } from '$lib/icons.svelte';
  import { launch, revealInExplorer } from '$lib/launch.svelte';
  import { showDesktop } from '$lib/windows.svelte';
  import { notes } from '$lib/notes.svelte';
  import { chat } from '$lib/chat.svelte';
  import { wallpapers } from '$lib/wallpapers.svelte';
  import { OcclusionWatcher } from '$lib/occlusion.svelte';
  import { DesktopLayer } from '$lib/desktoplayer.svelte';
  import { noteAction, writeDiagnostics } from '$lib/diagnostics';

  import Wallpaper from '$modules/wallpaper/Wallpaper.svelte';
  import WallpaperPicker from '$modules/wallpaper/WallpaperPicker.svelte';
  import IconView from '$modules/launcher/IconView.svelte';
  import AddDialog from '$modules/launcher/AddDialog.svelte';
  import Panel from '$modules/Panel.svelte';
  import ContextMenu from '$modules/ContextMenu.svelte';
  import ModuleSettings from '$modules/ModuleSettings.svelte';
  import AppearanceSettings from '$modules/AppearanceSettings.svelte';
  import { applyLook, applyPreset } from '$lib/apply-appearance';
  import { presets } from '$lib/presets.svelte';
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import ModuleView from '$modules/ModuleView.svelte';
  import AssistantSettings from '$modules/chat/AssistantSettings.svelte';
  import { gameMode, ownsGameMode } from '$lib/gamemode.svelte';
  import { padControl } from '$lib/padcontrol.svelte';
  import GameMode from '$modules/gamemode/GameMode.svelte';
  import GameModeSettings from '$modules/gamemode/GameModeSettings.svelte';
  import PadCursor from '$modules/gamemode/PadCursor.svelte';
  import type { FocusedApp, PhysicalMonitor } from '@seelen-ui/lib/types';

  const cfg = $derived(config.current);
  const occlusion = new OcclusionWatcher();
  const disposables = new Disposables();

  /*
   * Raises the surface back over Explorer's desktop after Windows' own "Show
   * desktop". While it is raised the windows are still up underneath, so the
   * occlusion watcher would call the display covered and freeze the wallpaper
   * and the visualiser on the very surface that is being looked at.
   */
  const layer = new DesktopLayer();
  const covered = $derived(occlusion.covered && !layer.lifted);

  /*
   * The appearance settings go on `body` rather than on this element, because
   * `base.css` composes tokens out of them *there* - and a custom property's
   * `var()`s are substituted where the property is declared, not where it is
   * used. Set one level down and the composition never sees them. See
   * `src/lib/appearance.ts`.
   */
  $effect(() => applySurfaceVars(cfg));

  /* The user's own stylesheet, kept last in the document; see `applyUserCss`. */
  $effect(() => applyUserCss(cfg.customCss));

  /*
   * ...and the same choices outward, into the shell theme's own variables.
   * Shape and typography only; see `src/lib/shellstyle.ts` for why colour
   * travels the other way and must not travel this one.
   */
  /*
   * The colour this surface's panels are actually showing, measured from the
   * wallpaper. Sent to the shell so a dock is made of the same thing a module
   * panel is made of - see `glass.ts` for why nothing else brought the two
   * materials together.
   */
  let stillUrl = $state<string | null>(null);
  let glassTint = $state<string | null>(null);

  $effect(() => {
    const url = stillUrl;
    const alpha = cfg.panelOpacity / 100;
    // A scheme changes both the ground the glass is mixed from and the ink it
    // has to carry, so choosing one re-measures.
    const ink = schemePolarity(cfg.colorScheme, cfg.schemeGround) === 'light' ? 'dark' : 'light';
    let dropped = false;
    void sampleWallpaperTint(url, alpha, ink).then((result) => {
      if (dropped) return;
      glassTint = result.tint;
      noteAction(`glass tint: ${result.note} ${result.tint ?? '-'}`);
    });
    return () => {
      dropped = true;
    };
  });

  $effect(() => syncShellStyle(cfg, cfg.styleShell, glassTint));

  let bounds = $state({ width: window.innerWidth, height: window.innerHeight });
  let ready = $state(false);

  /*
   * Which display this replica is, and whether it is the one game mode belongs
   * to. Both replicas run this file; exactly one of them may draw the launcher,
   * and `gameModeDisplay` - a setting with no per-monitor scope - is what
   * decides it. See `ownsGameMode`.
   */
  let ownMonitor = $state<PhysicalMonitor | null>(null);
  const ownMonitorId = Widget.self.decoded.monitorId ?? null;
  const ownsGame = $derived(
    ownsGameMode(ownMonitorId, cfg.gameModeDisplay, ownMonitor?.isPrimary ?? false),
  );

  /*
   * A display that stops being the launcher's closes it, rather than leaving
   * two of them up after the setting is pointed somewhere else.
   */
  $effect(() => {
    if (!ownsGame && gameMode.active) gameMode.leave('this display is no longer the launcher');
  });

  /*
   * The controller, driving the ordinary desktop.
   *
   * Only while game mode is *not* up: the launcher has its own navigation, and
   * a second reader translating the same presses into key events at the same
   * time would double every one of them.
   */
  $effect(() => {
    padControl.configure({
      preset: cfg.padPreset,
      overrides: cfg.padCustomKeys,
      pointer: cfg.padPointer,
      cursor: {
        speed: cfg.padPointerSpeed,
        accel: cfg.padPointerAccel / 100,
        scrollSpeed: cfg.padScrollSpeed,
        size: cfg.padPointerSize,
        hideAfter: cfg.padPointerHide,
        stickScrolls: cfg.padStickScrolls,
      },
    });
  });

  $effect(() => {
    if (cfg.padEnabled && cfg.padDesktop && !gameMode.active) padControl.start();
    else padControl.stop();
    // Its loop belongs to this surface; a reload must not leave one running.
    return () => padControl.stop();
  });

  /*
   * ...and the keyboard it needs to be read at all.
   *
   * `navigator.getGamepads()` reports nothing unless the document has focus,
   * and a desktop-preset widget is never focused by being clicked. So it is
   * asked for at the one moment the user has plainly said they want the desktop
   * and not what is over it: "show desktop", which is exactly what lifts this
   * surface over Explorer's. Anything else would be taking the keyboard out of
   * whatever they were typing in.
   */
  $effect(() => {
    if (!cfg.padEnabled || !cfg.padDesktop || gameMode.active || !layer.lifted) return;
    void Widget.self.focus().catch(() => {});
  });

  /*
   * True for the surface's first moments, while its icons and panels come in
   * as a wave from the top-left corner (see `Panel.svelte`). Off afterwards,
   * so a module switched on later arrives at once rather than waiting for its
   * place in a wave that has already passed.
   */
  let booting = $state(true);

  $effect(() => {
    if (!ready) return;
    const timer = setTimeout(() => (booting = false), 2600);
    return () => clearTimeout(timer);
  });

  let selection = $state<Set<string>>(new Set());
  let dialog = $state<'none' | 'add' | 'wallpaper'>('none');
  /** The module whose settings dialog is open, if any. */
  let settingsFor = $state<PanelKind | null>(null);
  let dropAt = $state({ x: 80, y: 80 });

  /** Panels the user has enabled, in stored order. */
  const visiblePanels = $derived(
    store.state.panels.filter((p) => cfg[MODULES[p.kind].enabledKey] === true),
  );

  /*
   * Where a module lands when it is switched on.
   *
   * Every kind has a place in `DEFAULT_PANEL_LAYOUT`, but thirty-two modules do
   * not fit on a 1080p display, and the later ones are laid out for a wide one:
   * switched on as they were, they arrived on top of another panel or past the
   * edge of the screen, where nothing can drag them back. So a module that was
   * off a moment ago and now overlaps something moves to the first free space,
   * and a panel that is off the display altogether - a resolution change, a
   * layout from a wider screen - is brought back on. A layout the user arranged
   * with overlaps on purpose is left alone: only the switch-on is moved.
   */
  let shownBefore: Set<PanelKind> | null = null;

  $effect(() => {
    const shown = visiblePanels;
    const surface = bounds;
    if (!ready) return;
    untrack(() => {
      const previous = shownBefore;
      shownBefore = new Set(shown.map((panel) => panel.kind));
      for (const panel of shown) {
        const others = shown.filter((other) => other.id !== panel.id);
        const lost = isOffSurface(panel, surface);
        const landedOnSomething = previous !== null && !previous.has(panel.kind) && others.some((o) => overlaps(panel, o));
        if (!lost && !landedOnSomething) continue;

        const spot = findFreeSpot({ w: panel.w, h: panel.h }, others, surface, cfg.snapToGrid ? cfg.gridSize / 4 : 20);
        if (spot) {
          store.placePanel(panel.id, spot.x, spot.y);
        } else if (lost) {
          store.placePanel(
            panel.id,
            Math.max(0, Math.min(panel.x, surface.width - Math.min(panel.w, surface.width))),
            Math.max(0, Math.min(panel.y, surface.height - Math.min(panel.h, surface.height))),
          );
        }
        noteAction(`layout: placed ${panel.kind} at ${panel.x},${panel.y} (${lost ? 'was off the display' : 'was covering another panel'})`);
      }
    });
  });

  onMount(() => {
    void (async () => {
      // Geometry first: everything else positions against the surface size.
      disposables.add(
        keepFittedToMonitor((m) => {
          occlusion.setMonitor(m);
          ownMonitor = m;
          bounds = { width: window.innerWidth, height: window.innerHeight };
        }),
      );

      const own = Widget.self.decoded.monitorId ?? 'primary';

      /*
       * Only what decides the first frame is waited for: which modules are on
       * (the config) and where everything sits (the store). This used to hold
       * the panels back until the assistant's conversation file, the icon
       * packs, the wallpaper library, both window watchers and the media and
       * system streams had all answered - every one of which fills itself in
       * perfectly well after the panels are up.
       */
      const assistant = chat.load().catch((err) => console.error('[surface] assistant did not load', err));
      const [, , offConfig] = await Promise.all([store.load(own), notes.load(), config.start()]);
      disposables.addFn(offConfig);
      ready = true;

      // Every store is event-driven; none of these start a polling timer. The
      // media and system streams are not among them: their panels hold them.
      const [subscriptions, monitor] = await Promise.all([
        Promise.all([icons.start(), wallpapers.start(), occlusion.start(), layer.start()]),
        resolveOwnMonitor(),
        assistant,
      ]);
      for (const sub of subscriptions) disposables.addFn(sub);

      /*
       * A trigger reaches every replica, so each one decides for itself what to
       * do with it.
       *
       * Three things arrive this way. The command palette and the overlay send
       * `{ action: 'game-mode' }`, and only the replica that owns the launcher
       * acts on it; `customArgs` is free-form on the host's side, so it is read
       * defensively rather than cast. The two declared shortcuts carry nothing
       * at all - `widget trigger` takes no arguments - so which of them fired is
       * asked of the keyboard, and `show-desktop` is what an unclear answer
       * means, because that is the binding this widget has always had. Only the
       * primary replica shows the desktop: a second call would see nothing left
       * up and put every window back again.
       */
      Widget.self.onTrigger((payload) => {
        const args = payload?.customArgs as Record<string, unknown> | null | undefined;
        if (args?.action === 'game-mode') {
          if (ownsGame) gameMode.toggle('the command palette');
          return;
        }
        void firedShortcut().then((id) => {
          if (id === 'game-mode') {
            if (ownsGame) gameMode.toggle('its shortcut');
          } else if (monitor?.isPrimary) {
            void showDesktop();
          }
        });
      });

      if (monitor?.isPrimary) {
        // Reminders are shared by every replica; only one may chime.
        chat.claimTimers();
      }

      /*
       * Who holds the foreground, which is what decides whether a controller
       * can be read at all. Game mode asks for it back when it loses it; see
       * `gamemode.svelte.ts`.
       */
      disposables.add(
        subscribe(SeelenEvent.GlobalFocusChanged, ({ payload }) => {
          const app = payload as FocusedApp;
          const ours =
            app.hwnd === Widget.self.windowId || app.ownerHwnd === Widget.self.windowId;
          if (ours) gameMode.onForegroundTaken();
          else gameMode.onForegroundLost();
        }),
      );

      if (ownsGame && cfg.gameModeAtStart) gameMode.enter('start-up');

      // Leave a snapshot on disk: this surface sits behind every window and has
      // no visible console, so this is how a run gets inspected afterwards.
      void writeDiagnostics(Widget.self.id, Widget.self.decoded.monitorId, {
        icons: store.state.icons.length,
        panels: visiblePanels.length,
        wallpapers: wallpapers.entries.length,
      });
    })().catch((err) => {
      console.error('[surface] startup failed', err);
    });

    const onResize = () => (bounds = { width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);

    // A desktop-preset window is never activated by a click, so without this
    // every text field on the surface silently discards what is typed into it.
    disposables.addFn(keepTextInputUsable());

    // Accept files dragged from Explorer onto the desktop.
    disposables.add(
      Widget.self.webview.onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return;
        const { paths, position } = event.payload;
        paths.forEach((path, i) => {
          const name = path.split(/[\\/]/).pop() ?? path;
          store.addIcon({
            label: name.replace(/\.(lnk|exe|url)$/i, ''),
            target: path,
            // Extension-less paths are almost always folders here.
            kind: /\.[a-z0-9]{1,6}$/i.test(name) ? 'file' : 'folder',
            umid: null,
            x: Math.round(position.x) + i * 12,
            y: Math.round(position.y) + i * 12,
          });
        });
      }),
    );

    return () => {
      window.removeEventListener('resize', onResize);
      disposables.dispose();
      // The launcher holds the game library, the pad reader and a key listener
      // of its own; leaving releases all three.
      gameMode.leave('the surface was torn down');
      padControl.stop();
      void store.flush();
      void notes.flush();
      void chat.flush();
      void config.flush();
    };
  });

  function openSettings() {
    void invoke(SeelenCommand.TriggerWidget, {
      payload: { id: SeelenSettingsWidgetId },
    }).catch((err) => console.error('[surface] could not open settings', err));
  }

  /*
   * Rendered through the overlay rather than this component's own `dialog`
   * state, so a module's settings dialog can hand over to it as well.
   */
  function openAppearance() {
    overlay.openDialog(AppearanceSettings, { onclose: () => overlay.closeDialog() });
  }

  function openGameModeSettings() {
    overlay.openDialog(GameModeSettings, { onclose: () => overlay.closeDialog() });
  }

  /**
   * Game mode, from the desktop it takes over.
   *
   * "Open here" is deliberately more than a toggle: on a display that is not
   * the launcher's, it moves the setting first. Otherwise the menu would offer
   * something that silently did nothing on three of four displays.
   */
  function gameModeSubmenu(): MenuItem[] {
    return [
      {
        label: gameMode.active ? 'Close game mode' : 'Open game mode here',
        hint: !gameMode.active && !ownsGame ? 'moves it to this display' : undefined,
        action: () => {
          if (gameMode.active) {
            gameMode.leave('the desktop menu');
            return;
          }
          if (!ownsGame && ownMonitorId) config.set('gameModeDisplay', ownMonitorId, 'all');
          gameMode.enter('the desktop menu');
        },
      },
      {
        label: 'Open at start-up',
        checked: cfg.gameModeAtStart,
        action: () => config.set('gameModeAtStart', !cfg.gameModeAtStart, 'all'),
      },
      menuSeparator,
      {
        label: 'Read the controller',
        checked: cfg.padEnabled,
        action: () => config.set('padEnabled', !cfg.padEnabled, 'all'),
      },
      {
        label: 'Drive the desktop with the controller',
        hint: 'this desktop only',
        checked: cfg.padDesktop,
        action: () => config.set('padDesktop', !cfg.padDesktop, 'all'),
      },
      menuSeparator,
      { label: 'Game mode settings...', action: openGameModeSettings },
    ];
  }

  /**
   * A toggle for one setting.
   *
   * Left on `auto` scope: it edits this display's own value if there already is
   * one and every display's otherwise, so a single click never quietly detaches
   * this display from the others nor discards a deliberate override.
   */
  function toggleItem(key: ConfigKey, label: string): MenuItem {
    return {
      label,
      checked: cfg[key] === true,
      hint: config.overrides.has(key) ? 'this display' : undefined,
      action: () => config.toggle(key),
    };
  }

  /** Whole looks, one click each - a desktop's theme switcher. */
  function lookSubmenu(): MenuItem[] {
    const active = currentLook(cfg, DEFAULT_CONFIG);
    void presets.load();
    const saved: MenuItem[] = presets.list.length
      ? [
          { label: 'Your presets', header: true },
          ...presets.list.map((preset) => ({
            label: preset.label,
            hint: preset.source === 'ai' ? 'AI' : undefined,
            action: () => void applyPreset(preset),
          })),
          { label: 'Built in', header: true },
        ]
      : [];
    return [
      ...saved,
      ...LOOKS.map((look) => ({
        label: look.label,
        checked: active === look.id,
        action: () => applyLook(look),
      })),
      menuSeparator,
      { label: 'Appearance...', action: openAppearance },
    ];
  }

  /** Colour alone, leaving every other appearance setting where it is. */
  function schemeSubmenu(): MenuItem[] {
    const [theme, custom, ...named] = SCHEME_OPTIONS.map((option) => ({
      label: option.label,
      checked: cfg.colorScheme === option.value,
      hint: cfg.colorScheme === option.value && config.overrides.has('colorScheme') ? 'this display' : undefined,
      action: () => config.set('colorScheme', option.value),
    }));
    return [...(theme ? [theme] : []), ...(custom ? [custom] : []), menuSeparator, ...named];
  }

  /** Show/hide every module, plus the escape hatches for a customised display. */
  function modulesSubmenu(): MenuItem[] {
    // Only the ones this display is hiding for itself: with most modules off
    // by default, "show everything" would bury the desktop rather than undo a
    // customisation.
    const hiddenHere = MODULE_ORDER.filter(
      (kind) =>
        cfg[MODULES[kind].enabledKey] !== true && config.overrides.has(MODULES[kind].enabledKey),
    );
    const overridden = MODULE_ORDER.flatMap((kind) => moduleKeys(MODULES[kind])).filter((key) =>
      config.overrides.has(key),
    );

    // Grouped rather than listed flat: thirty-two modules in one column is more
    // than a menu can be read at a glance.
    const groups: MenuItem[] = [];
    for (const group of MODULE_GROUPS) {
      const kinds = modulesInGroup(group.id);
      if (!kinds.length) continue;
      groups.push({ label: group.label, header: true });
      for (const kind of kinds) {
        groups.push(toggleItem(MODULES[kind].enabledKey, MODULES[kind].title));
      }
    }

    return [
      ...groups,
      menuSeparator,
      {
        label: 'Show the modules hidden only here',
        disabled: hiddenHere.length === 0,
        action: () => {
          for (const kind of hiddenHere) config.set(MODULES[kind].enabledKey, true, 'monitor');
        },
      },
      {
        label: 'Use the same modules as other displays',
        disabled: overridden.length === 0,
        action: () => config.clearOverrides(overridden),
      },
    ];
  }

  function onSurfaceContext(event: MouseEvent) {
    dropAt = { x: event.clientX, y: event.clientY };
    overlay.openMenu(event, [
      { label: 'Add to desktop...', action: () => (dialog = 'add') },
      { label: 'Change wallpaper...', action: () => (dialog = 'wallpaper') },
      { label: 'Appearance...', action: openAppearance },
      menuSeparator,
      { label: 'Look', items: lookSubmenu() },
      { label: 'Colour scheme', items: schemeSubmenu() },
      { label: 'Modules', items: modulesSubmenu() },
      { label: 'Game mode', items: gameModeSubmenu() },
      menuSeparator,
      toggleItem('lockLayout', 'Lock layout'),
      toggleItem('snapToGrid', 'Snap to grid'),
      menuSeparator,
      {
        label: 'Show desktop',
        hint: 'minimise windows',
        action: () => void showDesktop(),
      },
      { label: 'Desktop settings...', action: openSettings },
    ]);
  }

  /** The menu for one module panel: its own settings, then how to hide it. */
  function onPanelContext(event: MouseEvent, kind: PanelKind) {
    const module = MODULES[kind];
    const overridden = moduleKeys(module).filter((key) => config.overrides.has(key));
    // By kind rather than by id: a state file written by an older build may
    // carry its own panel ids.
    const panel = store.state.panels.find((p) => p.kind === kind);

    overlay.openMenu(event, [
      { label: module.title, header: true },
      ...module.quick.map((key) => {
        const field = module.fields.find((f) => f.key === key);
        return toggleItem(key, field?.label ?? key);
      }),
      menuSeparator,
      {
        label: `${module.title} settings...`,
        // The assistant has more to set than the generic dialog can hold; its
        // own dialog links back to this one for size and placement.
        action: () =>
          kind === 'chat'
            ? overlay.openDialog(AssistantSettings, { onclose: () => overlay.closeDialog() })
            : (settingsFor = kind),
      },
      menuSeparator,
      {
        label: 'Hide this module',
        items: [
          {
            label: 'On this display',
            action: () => config.set(module.enabledKey, false, 'monitor'),
          },
          {
            label: 'On all displays',
            action: () => config.set(module.enabledKey, false, 'all'),
          },
        ],
      },
      { label: 'Modules', items: modulesSubmenu() },
      menuSeparator,
      {
        label: 'Reset size',
        disabled: !panel,
        action: () => panel && store.resetPanel(panel.id, 'size'),
      },
      {
        label: 'Reset position',
        disabled: !panel,
        action: () => panel && store.resetPanel(panel.id, 'position'),
      },
      {
        label: 'Use the same settings as other displays',
        disabled: overridden.length === 0,
        action: () => config.clearOverrides(overridden),
      },
      menuSeparator,
      { label: 'Look', items: lookSubmenu() },
      { label: 'Appearance...', action: openAppearance },
      { label: 'Desktop settings...', action: openSettings },
    ]);
  }

  function onIconContext(event: MouseEvent, id: string) {
    const icon = store.state.icons.find((i) => i.id === id);
    if (!icon) return;
    selection = new Set([id]);
    overlay.openMenu(event, [
      { label: 'Open', action: () => void launch(icon.target, icon.kind) },
      { label: 'Show in Explorer', action: () => void revealInExplorer(icon.target) },
      menuSeparator,
      { label: 'Remove from desktop', danger: true, action: () => store.removeIcon(id) },
    ]);
  }

  function selectIcon(id: string, additive: boolean) {
    const next = additive ? new Set(selection) : new Set<string>();
    if (additive && next.has(id)) next.delete(id);
    else next.add(id);
    selection = next;
  }

  function clearSelection() {
    if (selection.size) selection = new Set();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && clearSelection()} />

<!--
  The desktop ground is a surface, not a control: clicking empty space clears
  the selection, exactly as Explorer's desktop does. Escape does the same for
  keyboard users, handled above.
-->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<main
  class="surface"
  class:no-animations={!cfg.animations}
  class:booting
  class:covered
  oncontextmenu={onSurfaceContext}
  onclick={clearSelection}
>
  <Wallpaper
    choice={store.state.wallpaper}
    {covered}
    onstill={(url) => (stillUrl = url)}
  />

  <!--
    While the launcher is up the icons and the panels are not merely hidden,
    they are unmounted - every module acquires its host subscriptions on mount,
    so this is what makes game mode cost nothing but itself while a game is
    running. The wallpaper above stays, because the launcher can use it as its
    own backdrop.
  -->
  {#if ready && !gameMode.active}
    <div class="items">
      {#each store.state.icons as icon (icon.id)}
        <IconView
          {icon}
          {bounds}
          selected={selection.has(icon.id)}
          onselect={selectIcon}
          oncontext={onIconContext}
        />
      {/each}

      {#each visiblePanels as panel (panel.id)}
        <Panel
          {panel}
          {bounds}
          title={MODULES[panel.kind].title}
          onmenu={(event) => onPanelContext(event, panel.kind)}
        >
          <ModuleView kind={panel.kind} {covered} />
        </Panel>
      {/each}
    </div>
  {/if}

  {#if gameMode.active}
    <GameMode wallpaperUrl={stillUrl} />
  {/if}

  <!-- Over everything, including the launcher: it is the pointer. -->
  <PadCursor />

  {#if overlay.menu}
    {@const open = overlay.menu}
    <ContextMenu x={open.x} y={open.y} items={open.items} onclose={() => overlay.closeMenu()} />
  {/if}

  {#if dialog === 'add'}
    <AddDialog {dropAt} onclose={() => (dialog = 'none')} />
  {:else if dialog === 'wallpaper'}
    <WallpaperPicker onclose={() => (dialog = 'none')} />
  {/if}

  {#if settingsFor}
    <ModuleSettings kind={settingsFor} onclose={() => (settingsFor = null)} />
  {/if}

  <!--
    A dialog a module asked for. It is rendered here rather than by the module
    because a panel's `backdrop-filter` clips the fixed-position layers a modal
    and a menu are both built from; see `src/lib/overlay.svelte.ts`.
  -->
  {#if overlay.dialog}
    {@const Dialog = overlay.dialog.component}
    <Dialog {...overlay.dialog.props} />
  {/if}
</main>

<style>
  .surface {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .items {
    position: absolute;
    inset: 0;
  }

  /* Honour the "animations off" setting for everything on the surface. */
  .surface.no-animations :global(*) {
    transition: none !important;
    animation: none !important;
  }
</style>
