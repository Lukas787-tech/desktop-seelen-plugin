<script lang="ts">
  import { onMount } from 'svelte';
  import { SeelenSettingsWidgetId } from '@seelen-ui/lib';

  import { Disposables, SeelenCommand, Widget, invoke } from '$lib/seelen';
  import { keepFittedToMonitor } from '$lib/surface';
  import { resolveOwnMonitor } from '$lib/monitor';
  import { keepTextInputUsable } from '$lib/input';
  import { applySurfaceVars } from '$lib/appearance';
  import { syncShellStyle } from '$lib/shellstyle';
  import { sampleWallpaperTint } from '$lib/glass';
  import { config, type ConfigKey } from '$lib/config.svelte';
  import { MODULES, MODULE_GROUPS, MODULE_ORDER, moduleKeys, modulesInGroup } from '$lib/modules';
  import { store, type PanelKind } from '$lib/store.svelte';
  import { icons } from '$lib/icons.svelte';
  import { launch, revealInExplorer } from '$lib/launch.svelte';
  import { media } from '$lib/media.svelte';
  import { showDesktop } from '$lib/windows.svelte';
  import { system } from '$lib/system.svelte';
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
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import ModuleView from '$modules/ModuleView.svelte';
  import AssistantSettings from '$modules/chat/AssistantSettings.svelte';

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
   * The appearance settings go on the document root rather than on this
   * element, because `base.css` composes `--panel-bg` out of them *there* -
   * and a custom property's `var()`s are substituted where the property is
   * declared, not where it is used. Set one level down and the composition
   * never sees them. See `src/lib/appearance.ts`.
   */
  $effect(() => applySurfaceVars(cfg));

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
    let dropped = false;
    void sampleWallpaperTint(url, alpha).then((result) => {
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

  let selection = $state<Set<string>>(new Set());
  let dialog = $state<'none' | 'add' | 'wallpaper'>('none');
  /** The module whose settings dialog is open, if any. */
  let settingsFor = $state<PanelKind | null>(null);
  let dropAt = $state({ x: 80, y: 80 });

  /** Panels the user has enabled, in stored order. */
  const visiblePanels = $derived(
    store.state.panels.filter((p) => cfg[MODULES[p.kind].enabledKey] === true),
  );

  onMount(() => {
    void (async () => {
      // Geometry first: everything else positions against the surface size.
      disposables.add(
        keepFittedToMonitor((m) => {
          occlusion.setMonitor(m);
          bounds = { width: window.innerWidth, height: window.innerHeight };
        }),
      );

      const own = Widget.self.decoded.monitorId ?? 'primary';
      await Promise.all([store.load(own), notes.load(), chat.load()]);

      // The Win+Shift+D shortcut triggers the widget, and a trigger reaches
      // every replica - so only the primary one acts, or the second call would
      // see nothing left up and put all the windows back again.
      const monitor = await resolveOwnMonitor();
      if (monitor?.isPrimary) {
        Widget.self.onTrigger(() => void showDesktop());
        // Reminders are shared by every replica; only one may chime.
        chat.claimTimers();
      }

      // Every store is event-driven; none of these start a polling timer.
      const subscriptions = await Promise.all([
        config.start(),
        icons.start(),
        wallpapers.start(),
        occlusion.start(),
        layer.start(),
        media.start(),
        system.start(),
      ]);
      for (const sub of subscriptions.flat()) disposables.addFn(sub);

      ready = true;

      // Leave a snapshot on disk: this surface sits behind every window and has
      // no visible console, so this is how a run gets inspected afterwards.
      void writeDiagnostics(Widget.self.id, Widget.self.decoded.monitorId, {
        icons: store.state.icons.length,
        panels: visiblePanels.length,
        mediaSessions: media.players.length,
        audioDevices: media.outputs.length,
        mixerSessions: media.defaultOutput?.sessions.length ?? 0,
        cpuCores: system.cores.length,
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

    // Grouped rather than listed flat: eighteen modules in one column is more
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
      menuSeparator,
      { label: 'Modules', items: modulesSubmenu() },
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
  oncontextmenu={onSurfaceContext}
  onclick={clearSelection}
>
  <Wallpaper
    choice={store.state.wallpaper}
    {covered}
    onstill={(url) => (stillUrl = url)}
  />

  {#if ready}
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
