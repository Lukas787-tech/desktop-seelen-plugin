<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SeelenSettingsWidgetId } from '@seelen-ui/lib';
  import { Alignment, type WidgetId } from '@seelen-ui/lib/types';
  import { ConnectedMonitorList, Disposables, SeelenCommand, Widget, invoke } from '$lib/seelen';
  import { displayName, games, launcherOf } from '$lib/games.svelte';
  import { apps, launch } from '$lib/launch.svelte';
  import { icons } from '$lib/icons.svelte';
  import { media } from '$lib/media.svelte';
  import { motionEnabled } from '$lib/motion';
  import { showDesktop } from '$lib/windows.svelte';

  interface Entry {
    id: string;
    label: string;
    hint: string;
    iconSrc?: string | null;
    glyph?: string;
    run: () => void;
  }

  const disposables = new Disposables();

  /** The desktop surface, which the game-mode summon is addressed to. */
  const DESKTOP_WIDGET_ID = '@ralfm/desktop' as unknown as WidgetId;

  let query = $state('');
  let active = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let shell = $state<HTMLElement | null>(null);
  let list = $state<HTMLUListElement | null>(null);

  const widget = Widget.self;

  function close() {
    widget.hide();
  }

  /** Quick actions, matched by name like anything else. */
  const actions: Entry[] = [
    {
      id: 'action-playpause',
      label: 'Play / pause',
      hint: 'Media',
      glyph: '⏯',
      run: () => media.togglePlayPause(),
    },
    { id: 'action-next', label: 'Next track', hint: 'Media', glyph: '⏭', run: () => media.next() },
    {
      id: 'action-prev',
      label: 'Previous track',
      hint: 'Media',
      glyph: '⏮',
      run: () => media.previous(),
    },
    {
      id: 'action-mute',
      label: 'Mute / unmute',
      hint: 'Audio',
      glyph: '\u{1F507}',
      run: () => {
        const out = media.defaultOutput;
        if (out) media.toggleMute(out.id);
      },
    },
    {
      id: 'action-showdesktop',
      label: 'Show desktop',
      hint: 'Minimise windows',
      glyph: '▦',
      // Deliberately not the host's `show_desktop`, which raises Explorer's
      // desktop over this package's surface and hides it. See `showDesktop`.
      run: () => void showDesktop(),
    },
    {
      id: 'action-lock',
      label: 'Lock',
      hint: 'Lock this session',
      glyph: '\u{1F512}',
      run: () => void invoke(SeelenCommand.Lock).catch(() => {}),
    },
    {
      id: 'action-sleep',
      label: 'Sleep',
      hint: 'Suspend the machine',
      glyph: '\u{1F319}',
      run: () => void invoke(SeelenCommand.Suspend).catch(() => {}),
    },
    {
      id: 'action-startmenu',
      label: 'Start menu',
      hint: "Open Windows' own",
      glyph: '⊞',
      run: () => void invoke(SeelenCommand.ShowStartMenu).catch(() => {}),
    },
    {
      id: 'action-wallpaper',
      label: 'Next wallpaper',
      hint: 'Desktop',
      glyph: '\u{1F5BC}',
      run: () => void invoke(SeelenCommand.WallpaperNext).catch(() => {}),
    },
    {
      /*
       * The way into game mode from anywhere.
       *
       * The palette is a Popup widget and so actually holds the keyboard, which
       * the desktop surface does not - so this is the one place a summon can
       * come from while another window is in front. The trigger reaches every
       * desktop replica and only the one that owns the launcher acts on it; see
       * `ownsGameMode`.
       */
      id: 'action-gamemode',
      label: 'Game mode',
      hint: 'Console launcher',
      glyph: '\u{1F3AE}',
      run: () =>
        void invoke(SeelenCommand.TriggerWidget, {
          // The host brands widget ids; this is the surface's own, by name.
          payload: { id: DESKTOP_WIDGET_ID, customArgs: { action: 'game-mode' } },
        }).catch(() => {}),
    },
    {
      id: 'action-settings',
      label: 'Desktop settings',
      hint: 'Open Seelen settings',
      glyph: '⚙',
      run: () =>
        void invoke(SeelenCommand.TriggerWidget, { payload: { id: SeelenSettingsWidgetId } }).catch(
          () => {},
        ),
    },
  ];

  /**
   * Evaluates a pure arithmetic expression.
   *
   * Restricted to digits and operators before evaluation, so nothing but maths
   * can ever be run here.
   */
  function calculate(expression: string): string | null {
    const trimmed = expression.trim();
    if (!/^[-+*/().\d\s%]+$/.test(trimmed) || !/\d/.test(trimmed) || !/[-+*/%]/.test(trimmed)) {
      return null;
    }
    try {
      const result = Function(`"use strict"; return (${trimmed});`)() as unknown;
      return typeof result === 'number' && Number.isFinite(result) ? String(result) : null;
    } catch {
      return null;
    }
  }

  const results = $derived.by((): Entry[] => {
    const term = query.trim();
    const out: Entry[] = [];

    const sum = calculate(term);
    if (sum !== null) {
      out.push({
        id: 'calc',
        label: sum,
        hint: `= ${term}`,
        glyph: '=',
        run: () => void navigator.clipboard.writeText(sum).catch(() => {}),
      });
    }

    const needle = term.toLowerCase();
    if (needle) {
      for (const action of actions) {
        if (action.label.toLowerCase().includes(needle)) out.push(action);
      }
    }

    // Games first: a library is a few dozen entries the user chose, and typing
    // three letters of one should not be outranked by an installer that shares
    // them. Launching from here deliberately records nothing - the play clock
    // belongs to the surface's panel, and two processes keeping it would double
    // every session.
    if (needle) {
      for (const game of games.all) {
        if (game.hidden || !displayName(game).toLowerCase().includes(needle)) continue;
        out.push({
          id: `game-${game.id}`,
          label: displayName(game),
          hint: `${launcherOf(game).label} game`,
          iconSrc: icons.resolve({ path: game.iconKey ?? game.target, umid: game.umid }),
          run: () => void launch(game.target, game.kind === 'url' ? 'url' : 'app'),
        });
        if (out.length >= 6) break;
      }
    }

    for (const app of apps.search(term, 12)) {
      out.push({
        id: `app-${app.path}`,
        label: app.display_name,
        hint: 'Application',
        iconSrc: icons.resolve({ path: app.target ?? app.path, umid: app.umid }),
        run: () => void launch(app.path, 'app'),
      });
    }

    if (!needle) out.push(...actions);

    return out.slice(0, 12);
  });

  // Keep the highlighted row valid as the result set changes.
  $effect(() => {
    void results;
    active = 0;
  });

  /*
   * The highlight is one element that slides between rows rather than a
   * background each row switches on, which is what makes arrowing down the
   * list - or running the pointer over it - read as one continuous movement.
   * Measured after each render; `offsetTop` ignores the rows' own entrance
   * transforms, so it is where the row will come to rest.
   */
  let marker = $state<{ top: number; height: number } | null>(null);

  $effect(() => {
    void results;
    const index = active;
    const node = list;
    if (!node) {
      marker = null;
      return;
    }
    const row = node.querySelectorAll<HTMLElement>('button[role="option"]')[index];
    marker = row ? { top: row.offsetTop, height: row.offsetHeight } : null;
  });

  /**
   * Comes into focus each time it is summoned. The host shows the same window
   * again rather than a new one, so nothing is inserted for a CSS entrance to
   * play on - the animation is started here instead.
   */
  function arrive() {
    if (!shell || !motionEnabled()) return;
    shell.animate(
      [
        { opacity: 0, transform: 'translateY(-12px) scale(0.965)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }

  function choose(entry: Entry | undefined) {
    if (!entry) return;
    entry.run();
    query = '';
    close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % Math.max(1, results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + results.length) % Math.max(1, results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      query = '';
      close();
    }
  }

  /** Centres the palette on the display containing `point` (or the primary). */
  async function centreOnActiveDisplay(point: { x: number; y: number } | null) {
    try {
      const monitors = (await ConnectedMonitorList.getAsync()).all();
      const target =
        (point &&
          monitors.find(
            (m) =>
              point.x >= m.rect.left &&
              point.x < m.rect.right &&
              point.y >= m.rect.top &&
              point.y < m.rect.bottom,
          )) ||
        monitors.find((m) => m.isPrimary) ||
        monitors[0];
      if (!target) return;

      const centreX = (target.rect.left + target.rect.right) / 2;
      // Slightly above centre reads better for a launcher than dead centre.
      const centreY = target.rect.top + (target.rect.bottom - target.rect.top) * 0.36;
      await widget.adjustAndSetPosition(
        Math.round(centreX),
        Math.round(centreY),
        Alignment.Center,
        Alignment.Center,
      );
    } catch (err) {
      console.error('[palette] could not centre on display', err);
    }
  }

  onMount(() => {
    void (async () => {
      const subs = await Promise.all([apps.acquire(), icons.start(), media.acquire()]);
      for (const sub of subs.flat()) disposables.addFn(sub);
      // Read once, watch nothing: see `readOnly`.
      await games.readOnly();
    })();

    // Each time the palette is summoned it should start empty, centred and
    // focused. The Popup preset places it at the cursor, which is right for a
    // context popup but wrong for a launcher, so we recentre afterwards - and
    // only then animate in, so it arrives where it will stay.
    widget.onTrigger((payload) => {
      query = '';
      active = 0;
      void tick().then(async () => {
        await centreOnActiveDisplay(payload.desiredPosition ?? null);
        arrive();
        input?.focus();
      });
    });

    void tick().then(() => {
      arrive();
      input?.focus();
    });

    return () => disposables.dispose();
  });
</script>

<div class="palette" bind:this={shell}>
  <input
    bind:this={input}
    bind:value={query}
    onkeydown={onKeyDown}
    placeholder="Search applications, actions, or type a calculation"
    aria-label="Command palette"
    spellcheck="false"
    autocomplete="off"
  />

  {#if results.length}
    <ul role="listbox" aria-label="Results" bind:this={list}>
      {#if marker}
        <li
          class="marker"
          aria-hidden="true"
          style:transform="translateY({marker.top}px)"
          style:height="{marker.height}px"
        ></li>
      {/if}
      {#each results as entry, i (`${entry.id}#${i}`)}
        <li>
          <button
            role="option"
            aria-selected={i === active}
            class:active={i === active}
            onclick={() => choose(entry)}
            onmouseenter={() => (active = i)}
          >
            {#if entry.iconSrc}
              <img src={entry.iconSrc} alt="" />
            {:else}
              <span class="glyph">{entry.glyph ?? '▸'}</span>
            {/if}
            <span class="label">{entry.label}</span>
            <span class="hint">{entry.hint}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .palette {
    /* A fixed width, deliberately: the host autosizer measures this element,
       so any viewport-relative cap here feeds back into the window size and
       shrinks it on every trigger. `autoSizeFitOnScreen` keeps it on screen. */
    width: 620px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: calc(16px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-50, #16161e) 82%, transparent);
    border: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 32%, transparent);
    backdrop-filter: blur(24px);
    box-shadow: var(--shadow-l, 8px 8px 24px rgb(0 0 0 / 0.35));
  }

  input {
    width: 100%;
    padding: 10px 12px;
    font: inherit;
    font-size: calc(15px * var(--text-scale, 1));
    border-radius: calc(10px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 45%, transparent);
    outline: none;
    transition:
      background-color var(--dur) var(--ease),
      box-shadow var(--dur-slow) var(--ease);
  }

  /* The field glows in the accent while it is being typed into. */
  input:focus {
    background: color-mix(in oklab, var(--color-gray-100, #333) 60%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--accent, var(--rs-accent, #7aa2f7)) 50%, transparent),
      0 0 0 5px color-mix(in oklab, var(--accent, var(--rs-accent, #7aa2f7)) 14%, transparent);
  }

  ul {
    position: relative;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 420px;
    overflow-y: auto;
  }

  .marker {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    border-radius: calc(9px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 34%, transparent);
    pointer-events: none;
    transition:
      transform var(--dur) var(--ease-move),
      height var(--dur) var(--ease-move);
  }

  /* Positioned so each row paints above the marker that slides beneath it. */
  li:not(.marker) {
    position: relative;
    animation: fx-rise var(--dur-slow) var(--ease) backwards;
  }

  @supports (order: sibling-index()) {
    li:not(.marker) {
      animation-delay: calc(max(0, min(sibling-index() - 2, 12)) * var(--step) * 0.5);
    }
  }

  button {
    display: grid;
    grid-template-columns: 22px 1fr max-content;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border-radius: calc(9px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg);
    font: inherit;
    font-size: calc(13px * var(--text-scale, 1));
    text-align: left;
    cursor: pointer;
    transition: scale var(--dur) var(--ease-spring);
  }

  button:active {
    scale: 0.985;
    transition-duration: var(--dur-fast);
  }

  img,
  .glyph {
    transition: scale var(--dur) var(--ease-spring);
  }

  button.active img,
  button.active .glyph {
    scale: 1.15;
  }

  img {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }

  .glyph {
    text-align: center;
    color: var(--panel-fg-muted);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    transition: color var(--dur) var(--ease);
  }

  button.active .hint {
    color: var(--panel-fg);
  }
</style>
