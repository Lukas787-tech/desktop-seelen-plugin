<script lang="ts">
  import { onMount } from 'svelte';

  import { config } from '$lib/config.svelte';
  import { kindOfTarget, launcherFor } from '$lib/detect';
  import { coverUrl, displayName, games, sortGames, type GameEntry } from '$lib/games.svelte';
  import { gameMode, navItem, SECTION_LABELS, type GameSection } from '$lib/gamemode.svelte';
  import { dedupe, homeRows } from '$lib/gamerows';
  import { GAME_MODE_FIELDS } from '$lib/gamemode-fields';
  import { parseBindings, type PadAction } from '$lib/gamepad';
  import { pad } from '$lib/gamepad.svelte';
  import { icons } from '$lib/icons.svelte';
  import { naturalSize } from '$lib/iconsize';
  import { apps, launch } from '$lib/launch.svelte';
  import { SESSION_ACTIONS, runSessionAction } from '$lib/power.svelte';
  import { store } from '$lib/store.svelte';
  import { activateWindow, openWindows, sortWindows } from '$lib/windows.svelte';
  import type { StartMenuItem } from '@seelen-ui/lib/types';

  import GameDetails from './GameDetails.svelte';
  import GameHero from './GameHero.svelte';
  import GameRow from './GameRow.svelte';
  import OnScreenKeyboard from './OnScreenKeyboard.svelte';
  import PadLegend from './PadLegend.svelte';
  import SettingRow from './SettingRow.svelte';

  interface Props {
    /** The wallpaper still, for the `wallpaper` backdrop. */
    wallpaperUrl?: string | null;
  }

  let { wallpaperUrl = null }: Props = $props();

  const cfg = $derived(config.current);

  /* ------------------------------------------------------------- tuning -- */

  const bindings = $derived(parseBindings(cfg.padBindings));

  /*
   * The reader's tuning, written from the settings.
   *
   * Assigned in an effect rather than passed down because the reader is a
   * plain object the whole surface shares - the pad is one piece of hardware,
   * not one per component - and the percentages the sliders store are turned
   * into the ratios the maths wants here, in one place.
   */
  $effect(() => {
    pad.tuning = {
      bindings,
      deadzone: cfg.padDeadzone / 100,
      curve: cfg.padCurve / 100,
      stickThreshold: cfg.padStickThreshold / 100,
      stickNavigates: cfg.padStickNavigates,
      repeatDelayMs: cfg.padRepeatDelay,
      repeatIntervalMs: cfg.padRepeatInterval,
      repeatMinMs: Math.min(cfg.padRepeatMin, cfg.padRepeatInterval),
      triggerThreshold: cfg.padTriggerThreshold / 100,
      rumble: cfg.padRumble,
      rumbleStrength: cfg.padRumbleStrength / 100,
    };
  });

  $effect(() => {
    gameMode.keepFocus = cfg.gameModeKeepFocus;
    gameMode.onLaunch = cfg.gameModeOnLaunch;
  });

  /* The sections actually offered, which the shoulder buttons step through. */
  const sections = $derived.by(() => {
    const list: GameSection[] = ['home', 'library', 'add', 'running'];
    if (cfg.gameModeShowApps) list.push('apps');
    list.push('settings');
    if (cfg.gameModeShowPower) list.push('power');
    return list;
  });

  $effect(() => {
    gameMode.sections = sections;
    // A section switched off while it was open would otherwise be unreachable
    // and unleavable at once.
    if (!sections.includes(gameMode.section)) gameMode.go('home');
  });

  /* -------------------------------------------------------------- lists -- */

  // Hidden and uninstalled entries are both out: this screen is a shelf of
  // things to press Play on, and neither of those can be played.
  const visible = $derived(games.all.filter((game) => !game.hidden && !game.missing));

  // Deduped once, here, so every row below inherits one tile per game.
  const ordered = $derived(dedupe(sortGames(visible, cfg.gameModeSort, cfg.gameModeFavouritesFirst)));

  const needle = $derived(gameMode.query.trim().toLowerCase());
  const found = $derived(
    needle ? ordered.filter((game) => displayName(game).toLowerCase().includes(needle)) : ordered,
  );

  /*
   * The home screen's rows, filled in order so no game appears in two of them -
   * see `gamerows.ts`. Shelves only: the grid and wall layouts wrap, and three
   * wrapped blocks stacked down the page is a list, not a home screen.
   */
  const rows = $derived(
    homeRows(ordered, {
      recentCount: cfg.gameModeRecentCount,
      split: cfg.gameModeLayout === 'shelf',
    }),
  );

  /* ------------------------------------------------------- adding games -- */

  /*
   * The installed-application index, held only while the Add games section is
   * open. It is a few hundred entries the host re-reads on every subscribe, and
   * the launcher is meant to cost nothing while a game is running.
   */
  $effect(() => {
    if (gameMode.section !== 'add') return;
    let release: (() => void) | null = null;
    let left = false;
    void apps.acquire().then((off) => (left ? off() : (release = off)));
    return () => {
      left = true;
      release?.();
    };
  });

  /** Everything the library already points at, so nothing is offered twice. */
  const owned = $derived(new Set(games.all.map((game) => game.target.toLowerCase())));

  const installed = $derived(
    gameMode.section === 'add'
      ? apps
          .search(gameMode.query, 120)
          .filter((item) => !owned.has((item.target ?? item.path).toLowerCase()))
      : [],
  );

  /** What a scan found and was not sure enough about to add by itself. */
  const offered = $derived(games.suggestions.filter((one) => !owned.has(one.target.toLowerCase())));

  function addApp(item: StartMenuItem): void {
    const target = (item.target ?? item.path).trim();
    if (!target) return;
    games.addManual({
      name: item.display_name,
      target,
      kind: kindOfTarget(target),
      umid: item.umid,
      // The shortcut, not the target: it is what the icon packs resolve, and
      // for a protocol target it is the only thing that has an icon at all.
      iconKey: item.path,
      launcher: launcherFor(target, item.path),
    });
    gameMode.say(`Added ${item.display_name}`);
  }

  /* Already unique: `ordered` is the deduplicated library. */
  const running = $derived(ordered.filter((game) => games.isRunning(game.id)));

  /**
   * The game the hero and the backdrop are about.
   *
   * An open details sheet wins, then whatever the selection was last on - see
   * `lastGame`, which is what stops the whole screen going blank the moment the
   * selection steps onto a section tab.
   */
  const selected = $derived.by<GameEntry | null>(() => {
    const id = gameMode.detailsFor ?? gameMode.focusedGame() ?? gameMode.lastGame;
    return (id ? games.find(id) : null) ?? null;
  });

  /* The desktop's own windows, for the Running section. Held for as long as
     the launcher is up, which is also as long as this component exists. */
  $effect(() => openWindows.acquire());
  const windows = $derived(sortWindows(openWindows.current));

  /** The settings screen's groups, in the order they are worth meeting. */
  const settingGroups = $derived([
    { title: 'Controller', fields: GAME_MODE_FIELDS.controller },
    { title: 'Look', fields: GAME_MODE_FIELDS.look },
    { title: 'Library', fields: GAME_MODE_FIELDS.library },
    { title: 'Behaviour', fields: GAME_MODE_FIELDS.display },
    { title: 'Drive the desktop', fields: GAME_MODE_FIELDS.desktop },
  ]);

  /* ----------------------------------------------------------- backdrop -- */

  /*
   * The backdrop is a real picture or nothing at all.
   *
   * It used to fall back to a gradient mixed from the selected game's name,
   * which meant the whole screen changed colour on every step along a shelf -
   * a second background per game, on top of the one each tile carried. Both are
   * gone: the wallpaper is the desktop's own, and `art` only shows a cover the
   * user actually chose, falling back to that same wallpaper.
   */
  const backdrop = $derived.by(() => {
    if (cfg.gameModeBackdrop === 'plain') return null;
    if (cfg.gameModeBackdrop === 'wallpaper') return wallpaperUrl;
    return (selected ? coverUrl(selected) : null) ?? wallpaperUrl;
  });

  /* -------------------------------------------------------------- clock -- */

  let now = $state(new Date());
  onMount(() => {
    const timer = setInterval(() => (now = new Date()), 20_000);
    return () => clearInterval(timer);
  });
  const clock = $derived(
    now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: !cfg.clock24h,
    }),
  );

  /* ------------------------------------------------------------- legend -- */

  const legend = $derived.by<PadAction[]>(() => {
    if (gameMode.keyboard) return ['confirm', 'back', 'search'];
    if (gameMode.detailsFor) return ['confirm', 'back'];
    if (gameMode.section === 'settings') return ['confirm', 'back', 'sectionPrev', 'sectionNext', 'quit'];
    return ['confirm', 'back', 'details', 'favourite', 'search', 'sectionPrev', 'sectionNext', 'quit'];
  });

  const legendLabels = $derived.by(() => {
    if (gameMode.keyboard) return { confirm: 'Type', back: 'Close the keyboard', search: 'Close the keyboard' };
    if (gameMode.section === 'settings') return { confirm: 'Change' };
    return {};
  });
</script>

<!--
  The launcher.

  Absolutely positioned over the whole surface rather than replacing it, so the
  wallpaper layer underneath keeps playing and the desktop is still there the
  moment this is closed - leaving game mode is one state flip, with nothing to
  rebuild.
-->
<div class="gamemode" class:still={!cfg.gameModeAnimate} class:hide-cursor={cfg.gameModeHideCursor}>
  <div class="backdrop" aria-hidden="true">
    {#if backdrop}
      {#key backdrop}
        <img src={backdrop} alt="" style:filter="blur({cfg.gameModeBackdropBlur}px) saturate(1.1)" />
      {/key}
    {/if}
    <div class="dim" style:opacity={cfg.gameModeBackdropDim / 100}></div>
  </div>

  <nav class="rail">
    <span class="mark">Games</span>

    {#each sections as section (section)}
      <button
        class="tab"
        class:on={gameMode.section === section}
        class:selected={gameMode.focusId === `sec:${section}`}
        use:navItem={{ id: `sec:${section}`, group: 'rail', onactivate: () => gameMode.go(section) }}
        onclick={() => gameMode.go(section)}
        onpointerenter={() => gameMode.focus(`sec:${section}`)}
      >
        {SECTION_LABELS[section]}
      </button>
    {/each}

    <div class="status">
      {#if gameMode.query}
        <span class="chip">“{gameMode.query}”</span>
      {/if}
      {#if pad.connected}
        <span class="chip pad" title={pad.primary?.id}>Controller</span>
      {:else if !gameMode.hasKeyboard}
        <span class="chip warn" title="A controller can only be read while this display holds the keyboard.">
          No keyboard focus
        </span>
      {/if}
      {#if cfg.gameModeShowClock}
        <span class="clock">{clock}</span>
      {/if}
      <button
        class="tab quit"
        class:selected={gameMode.focusId === 'sec:quit'}
        use:navItem={{ id: 'sec:quit', group: 'rail', onactivate: () => gameMode.leave('the exit button') }}
        onclick={() => gameMode.leave('the exit button')}
        onpointerenter={() => gameMode.focus('sec:quit')}
      >
        Exit
      </button>
    </div>
  </nav>

  <main class="stage">
    {#if gameMode.section === 'home'}
      {#if cfg.gameModeShowHero}
        <GameHero game={selected} total={visible.length} />
      {/if}
      {#each rows as row, i (row.id)}
        <GameRow
          id={row.id}
          label={row.label}
          games={row.games}
          autofocus={i === 0}
          empty={i === rows.length - 1
            ? 'Nothing found yet. Open the Games module on the desktop and run a scan.'
            : undefined}
        />
      {/each}
    {:else if gameMode.section === 'library'}
      <div class="head">
        <h1>Library</h1>
        {#if cfg.gameModeShowSearch}
          <button
            class="search"
            class:selected={gameMode.focusId === 'lib:search'}
            use:navItem={{ id: 'lib:search', group: 'libhead', onactivate: () => (gameMode.keyboard = true) }}
            onclick={() => (gameMode.keyboard = true)}
            onpointerenter={() => gameMode.focus('lib:search')}
          >
            {gameMode.query ? `Search: ${gameMode.query}` : 'Search…'}
          </button>
        {/if}
      </div>
      <GameRow
        id="lib"
        label={needle ? `${found.length} matching` : `${ordered.length} games`}
        games={found}
        autofocus
        empty={needle ? 'Nothing matches that.' : 'The library is empty.'}
      />
    {:else if gameMode.section === 'add'}
      <div class="head">
        <h1>Add games</h1>
        <button
          class="pill"
          class:selected={gameMode.focusId === 'add:search'}
          use:navItem={{ id: 'add:search', group: 'addhead', onactivate: () => (gameMode.keyboard = true) }}
          onclick={() => (gameMode.keyboard = true)}
          onpointerenter={() => gameMode.focus('add:search')}
        >
          {gameMode.query ? `Search: ${gameMode.query}` : 'Search\u2026'}
        </button>
        <button
          class="pill"
          class:selected={gameMode.focusId === 'add:scan'}
          use:navItem={{
            id: 'add:scan',
            group: 'addhead',
            onactivate: () => {
              gameMode.say('Scanning\u2026');
              void games.scan({ deep: true });
            },
          }}
          onclick={() => void games.scan({ deep: true })}
          onpointerenter={() => gameMode.focus('add:scan')}
        >
          {games.scanning ? 'Scanning\u2026' : 'Scan this machine'}
        </button>
        {#if games.duplicateCount}
          <button
            class="pill"
            class:selected={gameMode.focusId === 'add:merge'}
            use:navItem={{
              id: 'add:merge',
              group: 'addhead',
              onactivate: () => {
                const gone = games.mergeDuplicates();
                gameMode.say(gone ? `Merged ${gone} duplicate ${gone === 1 ? 'entry' : 'entries'}` : 'Nothing to merge');
              },
            }}
            onclick={() => games.mergeDuplicates()}
            onpointerenter={() => gameMode.focus('add:merge')}
          >
            Merge {games.duplicateCount} duplicate{games.duplicateCount === 1 ? '' : 's'}
          </button>
        {/if}
      </div>

      {#if offered.length}
        <section class="list">
          <h2>Found on this machine</h2>
          {#each offered as one (one.key)}
            <div class="offer" class:selected={gameMode.focusId === `sug:${one.key}`}>
              <div class="offertext">
                <span class="rowtitle">{one.name}</span>
                <span class="rowsub">{one.reason}</span>
              </div>
              <button
                class="pill go"
                class:selected={gameMode.focusId === `sug:${one.key}`}
                use:navItem={{
                  id: `sug:${one.key}`,
                  group: 'offers',
                  onactivate: () => {
                    games.addSuggestion(one);
                    gameMode.say(`Added ${one.name}`);
                  },
                }}
                onclick={() => games.addSuggestion(one)}
                onpointerenter={() => gameMode.focus(`sug:${one.key}`)}
              >
                Add
              </button>
              <button
                class="pill"
                class:selected={gameMode.focusId === `no:${one.key}`}
                use:navItem={{
                  id: `no:${one.key}`,
                  group: 'offers',
                  onactivate: () => games.dismissSuggestion(one.key),
                }}
                onclick={() => games.dismissSuggestion(one.key)}
                onpointerenter={() => gameMode.focus(`no:${one.key}`)}
              >
                Not a game
              </button>
            </div>
          {/each}
        </section>
      {/if}

      <section class="list">
        <h2>{gameMode.query ? `Matching \u201c${gameMode.query}\u201d` : 'Everything in the Start Menu'}</h2>
        <div class="appgrid">
          {#each installed as item, i (item.path)}
            {@const src = icons.resolve({ path: item.path, umid: item.umid })}
            <button
              class="app"
              class:selected={gameMode.focusId === `ins:${item.path}`}
              use:navItem={{
                id: `ins:${item.path}`,
                group: 'installed',
                autofocus: i === 0 && !offered.length,
                onactivate: () => addApp(item),
              }}
              onclick={() => addApp(item)}
              onpointerenter={() => gameMode.focus(`ins:${item.path}`)}
            >
              {#if src}
                <img src={src} alt="" draggable="false" use:naturalSize />
              {:else}
                <span class="glyph">{item.display_name.slice(0, 1).toUpperCase()}</span>
              {/if}
              <span class="appname">{item.display_name}</span>
            </button>
          {:else}
            <p class="empty">
              {gameMode.query
                ? 'Nothing in the Start Menu matches that.'
                : 'Everything in the Start Menu is already in the library.'}
            </p>
          {/each}
        </div>
      </section>
    {:else if gameMode.section === 'running'}
      <div class="head"><h1>Running</h1></div>
      <GameRow id="run" label="Games" games={running} empty="No games are running." autofocus />

      <section class="list">
        <h2>Windows</h2>
        {#each windows as window (window.hwnd)}
          <button
            class="listrow"
            class:selected={gameMode.focusId === `win:${window.hwnd}`}
            use:navItem={{
              id: `win:${window.hwnd}`,
              group: 'windows',
              onactivate: () => void activateWindow(window.hwnd, window.appName || window.title),
            }}
            onclick={() => void activateWindow(window.hwnd, window.appName || window.title)}
            onpointerenter={() => gameMode.focus(`win:${window.hwnd}`)}
          >
            <span class="rowtitle">{window.appName || window.title || 'Untitled'}</span>
            <span class="rowsub">{window.title}</span>
          </button>
        {:else}
          <p class="empty">Nothing is open.</p>
        {/each}
      </section>
    {:else if gameMode.section === 'apps'}
      <div class="head"><h1>Apps</h1></div>
      <div class="appgrid">
        {#each store.state.icons as icon, i (icon.id)}
          {@const src = icons.resolveWithOverride(icon.iconPath, { path: icon.target, umid: icon.umid })}
          <button
            class="app"
            class:selected={gameMode.focusId === `app:${icon.id}`}
            use:navItem={{
              id: `app:${icon.id}`,
              group: 'apps',
              autofocus: i === 0,
              onactivate: () => {
                void launch(icon.target, icon.kind);
                gameMode.say(`Opening ${icon.label}`);
              },
            }}
            onclick={() => void launch(icon.target, icon.kind)}
            onpointerenter={() => gameMode.focus(`app:${icon.id}`)}
          >
            {#if src}
              <img src={src} alt="" draggable="false" />
            {:else}
              <span class="glyph">{icon.label.slice(0, 1).toUpperCase()}</span>
            {/if}
            <span class="appname">{icon.label}</span>
          </button>
        {:else}
          <p class="empty">No desktop icons yet.</p>
        {/each}
      </div>
    {:else if gameMode.section === 'settings'}
      <div class="head"><h1>Settings</h1></div>
      <div class="settings">
        <p class="note">
          Changed here, these apply to every display. The desktop's own
          <strong>Game mode…</strong> dialog has the rest, including the button bindings and which
          display the launcher takes over.
        </p>
        {#each settingGroups as group, g (group.title)}
          <h2>{group.title}</h2>
          {#each group.fields as def, i (def.key)}
            <SettingRow {def} autofocus={g === 0 && i === 0} />
          {/each}
        {/each}
      </div>
    {:else if gameMode.section === 'power'}
      <div class="head"><h1>Power</h1></div>
      <div class="power">
        {#each SESSION_ACTIONS as action, i (action.id)}
          <button
            class="powerbtn"
            class:selected={gameMode.focusId === `pwr:${action.id}`}
            use:navItem={{
              id: `pwr:${action.id}`,
              group: 'power',
              autofocus: i === 0,
              onactivate: () => {
                runSessionAction(action.command);
                gameMode.say(`${action.label}…`);
              },
            }}
            onclick={() => runSessionAction(action.command)}
            onpointerenter={() => gameMode.focus(`pwr:${action.id}`)}
          >
            {action.label}
          </button>
        {/each}
        <button
          class="powerbtn leave"
          class:selected={gameMode.focusId === 'pwr:leave'}
          use:navItem={{ id: 'pwr:leave', group: 'power', onactivate: () => gameMode.leave('the power screen') }}
          onclick={() => gameMode.leave('the power screen')}
          onpointerenter={() => gameMode.focus('pwr:leave')}
        >
          Back to the desktop
        </button>
      </div>
    {/if}
  </main>

  {#if cfg.gameModeShowLegend}
    <PadLegend {bindings} actions={legend} labels={legendLabels} />
  {/if}

  {#if gameMode.keyboard}
    <OnScreenKeyboard />
  {/if}

  {#if gameMode.detailsFor}
    <GameDetails id={gameMode.detailsFor} />
  {/if}

  {#if gameMode.toast}
    <p class="toast panel" role="status">{gameMode.toast}</p>
  {/if}
</div>

<style>
  /*
   * The launcher's own small design system.
   *
   * Every surface on this screen was composed separately once - four different
   * greys at five different strengths, three different radii, and three ideas
   * of what "selected" looks like - and a screen read from a sofa shows that
   * kind of drift far more than a panel read at a desk does. These are the only
   * values below, and they are all derived from the user's own theme rather
   * than chosen here: the same ground, edge and accent the desktop is built
   * from, so game mode stays this desktop full-screen rather than becoming a
   * second look of its own.
   */
  .gamemode {
    --gm-gutter: 44px;
    --gm-radius: calc(14px * var(--round, 1));
    --gm-pill: 999px;
    /* Two weights of the panel material: a resting surface and the one a
       heading or a hovered control sits on. */
    --gm-surface: color-mix(
      in oklab,
      var(--panel-ground) calc(var(--panel-alpha, 0.72) * 62%),
      transparent
    );
    --gm-surface-strong: color-mix(
      in oklab,
      var(--panel-ground) calc(var(--panel-alpha, 0.72) * 88%),
      transparent
    );
    --gm-edge: var(--panel-border-width, 1px) solid
      color-mix(in oklab, var(--color-gray-300, #666) var(--panel-edge, 34%), transparent);
    /* One idea of "the pad is here": an accent outline and a faint wash of it.
       Never a fill, which would need its own text colour per scheme. */
    --gm-wash: color-mix(in oklab, var(--accent, #7aa2f7) 22%, transparent);
    --gm-ring: 0 0 0 2px var(--accent, #7aa2f7);

    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* Its own stacking and typographic ground: everything here is read from
       several times the distance a desktop panel is. */
    font-size: calc(var(--ui-size) * 1.05);
    background: var(--panel-ground, #12131a);
  }

  .gamemode.hide-cursor {
    cursor: none;
  }

  .gamemode.still :global(*) {
    transition: none !important;
    animation: none !important;
  }

  /* -------------------------------------------------------- backdrop -- */

  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .backdrop img {
    position: absolute;
    /* Bled past the edges so the blur has real pixels to sample rather than
       fading to transparent at the frame. */
    inset: -8%;
    width: 116%;
    height: 116%;
    object-fit: cover;
    animation: bleed 600ms ease both;
  }

  @keyframes bleed {
    from {
      opacity: 0;
      scale: 1.04;
    }
  }

  .dim {
    position: absolute;
    inset: 0;
    /*
     * The vignette is the scheme's own ground, not black: on a light scheme a
     * black wash would make the launcher the one dark thing on the desktop, and
     * the point of the whole screen is that it is the same material as the
     * panels beside it.
     */
    background:
      radial-gradient(120% 90% at 20% 10%, transparent 10%, var(--panel-ground) 85%),
      linear-gradient(to top, var(--panel-ground) 4%, transparent 55%);
  }

  /* ------------------------------------------------------------ rail -- */

  .rail {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 22px var(--gm-gutter) 10px;
  }

  .mark {
    margin-right: 22px;
    font-family: var(--display-font);
    font-size: calc(20px * var(--text-scale, 1));
    font-weight: 700;
    letter-spacing: 0.02em;
    opacity: 0.85;
  }

  .tab {
    padding: 9px 20px;
    cursor: pointer;
    font-size: calc(16px * var(--text-scale, 1));
    font-weight: 600;
    color: var(--panel-fg-muted);
    border-radius: 999px;
    transition:
      color 140ms ease,
      background 140ms ease;
  }

  .tab:hover {
    color: var(--panel-fg);
  }

  .tab.on {
    color: var(--panel-fg);
    background: var(--gm-surface-strong);
    border: var(--gm-edge);
    /* The border would otherwise move the tab a pixel when it is switched on. */
    padding: calc(9px - var(--panel-border-width, 1px)) calc(20px - var(--panel-border-width, 1px));
  }

  .tab.selected {
    color: var(--panel-fg);
    background: var(--gm-wash);
    box-shadow: var(--gm-ring);
  }

  .status {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .chip {
    padding: 5px 12px;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: var(--gm-pill);
    color: var(--panel-fg-muted);
    background: var(--gm-surface);
  }

  .chip.pad {
    color: var(--color-green-400, #4ade80);
  }

  .chip.warn {
    color: var(--color-yellow-400, #facc15);
  }

  .clock {
    font-family: var(--display-font);
    font-size: calc(19px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
  }

  .tab.quit {
    color: var(--panel-fg-muted);
  }

  /* ----------------------------------------------------------- stage -- */

  .stage {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 18px var(--gm-gutter) 10px;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px 18px;
  }

  h1 {
    margin: 0;
    font-family: var(--display-font);
    font-size: clamp(28px, 2.4vw, 42px);
    font-weight: var(--display-weight, 200);
  }

  /* Every secondary action on this screen, so they are all the same shape. */
  .search,
  .pill {
    padding: 11px 22px;
    cursor: pointer;
    font-size: calc(15px * var(--text-scale, 1));
    font-weight: 600;
    border-radius: var(--gm-pill);
    color: var(--panel-fg);
    background: var(--gm-surface-strong);
    border: var(--gm-edge);
    scroll-margin: 120px;
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .pill.go {
    background: var(--gm-wash);
  }

  .search.selected,
  .pill.selected {
    background: var(--gm-wash);
    box-shadow: var(--gm-ring);
  }

  /* ------------------------------------------------------- the lists -- */

  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* The same heading a shelf uses, so a list and a shelf read as one page. */
  h2 {
    margin: 10px 0 4px;
    padding-inline: 4px;
    font-family: var(--display-font);
    font-size: calc(19px * var(--text-scale, 1));
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .listrow,
  .offer {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 13px 20px;
    cursor: pointer;
    text-align: left;
    border-radius: var(--gm-radius);
    background: var(--gm-surface);
    border: var(--gm-edge);
    scroll-margin: 120px;
    /* A line of text is unreadable at the full width of an ultrawide, and the
       buttons that answer it end up a screen away from the words. */
    max-width: 1200px;
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .listrow.selected,
  .offer.selected {
    background: var(--gm-wash);
    box-shadow: var(--gm-ring);
  }

  /* A suggestion is a row with two answers, so it is a row of its own. */
  .offer {
    flex-direction: row;
    align-items: center;
    gap: 14px;
    cursor: default;
  }

  .offertext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .offer .pill {
    padding: 8px 18px;
    font-size: calc(14px * var(--text-scale, 1));
  }

  .rowtitle {
    font-size: calc(16px * var(--text-scale, 1));
    font-weight: 600;
  }

  .rowsub {
    font-size: calc(13px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
    padding: 14px 4px;
    color: var(--panel-fg-muted);
  }

  /* ------------------------------------------------------------ apps -- */

  .appgrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
    padding-bottom: 20px;
  }

  .app {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 20px 12px;
    cursor: pointer;
    border-radius: var(--gm-radius);
    background: var(--gm-surface);
    border: var(--gm-edge);
    scroll-margin: 120px;
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .app.selected {
    background: var(--gm-wash);
    box-shadow: var(--gm-ring);
  }

  /* As on a game tile: never drawn bigger than the file is. See `iconsize.ts`. */
  .app img {
    width: min(52px, var(--natural, 52px));
    height: min(52px, var(--natural, 52px));
    object-fit: contain;
  }

  .app .glyph {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    font-size: 24px;
    font-weight: 700;
    border-radius: var(--gm-radius);
    background: var(--gm-surface-strong);
    color: var(--panel-fg-muted);
  }

  .appname {
    font-size: calc(13px * var(--text-scale, 1));
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  /* -------------------------------------------------------- settings -- */

  .settings {
    display: flex;
    flex-direction: column;
    max-width: 1000px;
    padding-bottom: 30px;
  }

  .note {
    margin: 0 0 12px;
    padding: 14px 20px;
    font-size: calc(14px * var(--text-scale, 1));
    line-height: 1.5;
    color: var(--panel-fg-muted);
    border-radius: var(--gm-radius);
    background: var(--gm-surface);
    border: var(--gm-edge);
  }

  /* ----------------------------------------------------------- power -- */

  .power {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
    max-width: 920px;
  }

  .powerbtn {
    padding: 26px 20px;
    cursor: pointer;
    font-size: calc(17px * var(--text-scale, 1));
    font-weight: 600;
    border-radius: var(--gm-radius);
    background: var(--gm-surface);
    border: var(--gm-edge);
    scroll-margin: 120px;
    transition:
      background 140ms ease,
      box-shadow 140ms ease;
  }

  .powerbtn.selected {
    background: var(--gm-wash);
    box-shadow: var(--gm-ring);
  }

  .powerbtn.leave {
    grid-column: 1 / -1;
  }

  /* ----------------------------------------------------------- toast -- */

  .toast {
    position: absolute;
    left: 50%;
    bottom: 110px;
    translate: -50% 0;
    z-index: 70;
    margin: 0;
    padding: 12px 24px;
    font-size: calc(15px * var(--text-scale, 1));
    animation: rise 220ms ease both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% 10px;
    }
  }
</style>
