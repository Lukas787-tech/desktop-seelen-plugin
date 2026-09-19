<script lang="ts">
  import { onMount } from 'svelte';
  import type { PhysicalMonitor } from '@seelen-ui/lib/types';

  import Modal from '../Modal.svelte';
  import SettingField from '../SettingField.svelte';
  import { config } from '$lib/config.svelte';
  import { ConnectedMonitorList, Widget } from '$lib/seelen';
  import { GAME_MODE_FIELDS, GAME_MODE_TABS, type GameModeTab } from '$lib/gamemode-fields';
  import { gameMode, ownsGameMode } from '$lib/gamemode.svelte';
  import {
    ACTION_LABELS,
    ACTION_ORDER,
    BUTTON_ORDER,
    DEFAULT_BINDINGS,
    formatBindings,
    glyphFor,
    labelFor,
    parseBindings,
    resolveLayout,
    type PadButton,
  } from '$lib/gamepad';
  import { pad } from '$lib/gamepad.svelte';
  import { buildTranslation } from '$lib/padkeys';
  import { blurbs } from '$lib/blurbs.svelte';
  import { displayName, games, launcherOf } from '$lib/games.svelte';
  import { providerFor } from '$lib/providers';

  interface Props {
    tab?: GameModeTab;
    onclose: () => void;
  }

  let { tab: initialTab = 'display', onclose }: Props = $props();

  // The tab it opens on, read once on purpose: after that the tab list owns it.
  // svelte-ignore state_referenced_locally
  let tab = $state<GameModeTab>(initialTab);
  const cfg = $derived(config.current);

  /*
   * Everything here is written for every display.
   *
   * Unlike a module panel, the launcher exists on exactly one display at a
   * time, so "this display only" would mean nothing for most of these and would
   * be actively wrong for the display picker - two replicas disagreeing about
   * which of them is the launcher is precisely the failure to avoid.
   */
  const scope = 'all' as const;

  const sections = $derived([...new Set(GAME_MODE_TABS.map((entry) => entry.section))]);

  /* ------------------------------------------------------- the display -- */

  let monitors = $state<PhysicalMonitor[]>([]);
  const ownId = Widget.self.decoded.monitorId ?? null;

  onMount(() => {
    void ConnectedMonitorList.getAsync()
      .then((list) => (monitors = list.all()))
      .catch((err) => console.error('[game mode] could not list the displays', err));
  });

  const ownsIt = $derived(
    ownsGameMode(ownId, cfg.gameModeDisplay, monitors.find((m) => m.id === ownId)?.isPrimary ?? false),
  );

  /**
   * Opens the launcher from here.
   *
   * On a display that is not the launcher's it moves the setting first. Without
   * that the surface would open it and the ownership guard would close it again
   * in the same frame, which looks like a broken button rather than like a
   * setting pointed somewhere else.
   */
  function openNow(): void {
    if (!ownsIt && ownId) config.set('gameModeDisplay', ownId, scope);
    onclose();
    gameMode.enter('the settings dialog');
  }

  /* ------------------------------------------------------- the bindings -- */

  const bindings = $derived(parseBindings(cfg.padBindings));
  const layout = $derived(resolveLayout(cfg.padLayout, pad.primary?.id ?? ''));

  /** Buttons bound to more than one thing, which is legal but worth flagging. */
  const doubled = $derived.by(() => {
    const counts = new Map<PadButton, number>();
    for (const action of ACTION_ORDER) {
      const button = bindings[action];
      counts.set(button, (counts.get(button) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([button]) => button));
  });

  function bind(action: (typeof ACTION_ORDER)[number], button: PadButton): void {
    config.set('padBindings', formatBindings({ ...bindings, [action]: button }), scope);
  }

  /* --------------------------------------------------------- the tester -- */

  /*
   * A live read-out of the pad.
   *
   * It exists because everything about controller settings is otherwise
   * invisible: a dead zone, a trigger threshold and a repeat rate can only be
   * judged by moving the thing and watching. The reader is acquired for as long
   * as this dialog is open, and the note under it explains the one condition
   * that decides whether anything appears at all.
   */
  $effect(() => pad.acquire());

  // A dialog on the desktop has to ask for the keyboard itself, or the pad
  // reports nothing - the same rule game mode lives by.
  onMount(() => {
    void Widget.self.focus().catch(() => {});
  });

  const down = $derived(pad.pressed());
  const translation = $derived(buildTranslation(cfg.padPreset, cfg.padCustomKeys));

  /* ----------------------------------------------------- the descriptions -- */

  /*
   * The library, read without watching anything.
   *
   * `readOnly` is the same entry point the command palette uses: it loads the
   * file and stops there, so a dialog cannot start a second play clock against
   * the one the Games panel owns.
   */
  onMount(() => {
    void games.readOnly();
    void blurbs.load();
    blurbs.suggest(cfg.chatProvider);
  });

  const describable = $derived(
    games.all.filter((game) => !game.hidden).map((game) => ({ name: displayName(game), launcher: launcherOf(game).label })),
  );
  const missing = $derived(describable.filter((game) => !blurbs.has(game.name)).length);
  const blurbState = $derived(blurbs.ready());
  const blurbService = $derived(providerFor(blurbs.provider));

  async function writeBlurbs(refresh: boolean): Promise<void> {
    try {
      await blurbs.describe(describable, { refresh });
    } catch {
      // The store puts the reason in `blurbs.error`, which the panel shows.
    }
  }
</script>

<Modal title="Game mode" {onclose} width={920}>
  <div class="frame">
    <nav class="side" aria-label="Game mode sections">
      {#each sections as section (section)}
        <span class="section">{section}</span>
        {#each GAME_MODE_TABS.filter((entry) => entry.section === section) as entry (entry.id)}
          <button
            class="nav"
            class:on={tab === entry.id}
            aria-current={tab === entry.id ? 'page' : undefined}
            onclick={() => (tab = entry.id)}
          >
            {entry.label}
          </button>
        {/each}
      {/each}
    </nav>

    <div class="pane">
      {#if tab === 'display'}
        <p class="lead">
          Game mode turns one display's desktop into a full-screen launcher. Open it from that
          desktop's right-click menu, or from the command palette on Win+Alt+Space.
        </p>

        <h3 class="first">Which display</h3>
        <div class="monitors">
          <button
            class="monitor"
            class:on={!cfg.gameModeDisplay}
            onclick={() => config.set('gameModeDisplay', '', scope)}
          >
            <span class="mname">The primary display</span>
            <span class="mid">whichever Windows calls primary</span>
          </button>
          {#each monitors as monitor (monitor.id)}
            <button
              class="monitor"
              class:on={cfg.gameModeDisplay === monitor.id}
              onclick={() => config.set('gameModeDisplay', monitor.id, scope)}
            >
              <span class="mname">
                {monitor.name}
                {#if monitor.isPrimary}<span class="tag">primary</span>{/if}
                {#if monitor.id === ownId}<span class="tag">this one</span>{/if}
              </span>
              <span class="mid">
                {monitor.rect.right - monitor.rect.left} × {monitor.rect.bottom - monitor.rect.top}
              </span>
            </button>
          {/each}
        </div>

        <h3>Behaviour</h3>
        {#each GAME_MODE_FIELDS.display as def (def.key)}
          <SettingField {def} {scope} />
        {/each}

        <div class="buttons">
          <button class="m-btn m-primary" onclick={openNow}>
            {ownsIt ? 'Open game mode now' : 'Open game mode on this display'}
          </button>
        </div>
      {:else if tab === 'controller'}
        <p class="lead">
          A controller is read through the browser's Gamepad API, which only reports while this
          display holds the keyboard. That is why the pad works inside game mode, which asks for the
          keyboard when it opens, and why it does nothing while another window is in front.
        </p>

        <div class="tester" class:live={pad.connected}>
          <div class="tline">
            <span class="tlabel">Controller</span>
            <span class="tvalue">{pad.primary ? pad.primary.id : 'none detected'}</span>
          </div>
          <div class="tline">
            <span class="tlabel">Pressed</span>
            <span class="tvalue">
              {#if down.length}
                {#each down as button (button)}
                  <kbd>{glyphFor(button, layout)}</kbd>
                {/each}
              {:else}
                <span class="dim">press something</span>
              {/if}
            </span>
          </div>
          <div class="tline">
            <span class="tlabel">Left stick</span>
            <span class="tvalue mono">
              {pad.left.x.toFixed(2)}, {pad.left.y.toFixed(2)}
            </span>
          </div>
          <div class="tline">
            <span class="tlabel">Right stick</span>
            <span class="tvalue mono">
              {pad.right.x.toFixed(2)}, {pad.right.y.toFixed(2)}
            </span>
          </div>
          <div class="tline">
            <span class="tlabel">Triggers</span>
            <span class="tvalue mono">
              {pad.triggers.l2.toFixed(2)} / {pad.triggers.r2.toFixed(2)}
            </span>
          </div>
        </div>

        <h3 class="first">Reading the pad</h3>
        {#each GAME_MODE_FIELDS.controller as def (def.key)}
          <SettingField {def} {scope} />
        {/each}

        <div class="buttons">
          <button class="m-btn" onclick={() => pad.buzzPrimary(cfg.padRumbleStrength / 100, 400)}>
            Test the rumble
          </button>
        </div>
      {:else if tab === 'bindings'}
        <p class="lead">
          Buttons are named by <em>position</em>, not by letter: south is the button under your
          thumb, whatever it happens to be lettered. One set of bindings is therefore correct on an
          Xbox pad, a DualSense and a Switch Pro controller alike.
        </p>

        <div class="binds">
          {#each ACTION_ORDER as action (action)}
            <div class="bind" class:pressed={down.includes(bindings[action])}>
              <span class="bname">{ACTION_LABELS[action]}</span>
              <select value={bindings[action]} onchange={(e) => bind(action, e.currentTarget.value as PadButton)}>
                {#each BUTTON_ORDER as button (button)}
                  <option value={button}>{labelFor(button, layout)}</option>
                {/each}
              </select>
              {#if doubled.has(bindings[action])}
                <span class="warn" title="Another action uses this button too.">shared</span>
              {/if}
            </div>
          {/each}
        </div>

        <div class="buttons">
          <button class="m-btn" onclick={() => config.set('padBindings', '', scope)}>
            Back to the defaults
          </button>
        </div>

        <h3>Stored as</h3>
        {#each GAME_MODE_FIELDS.bindings as def (def.key)}
          <SettingField {def} {scope} />
        {/each}
        <p class="note">
          The directions are always the d-pad, and - when it is switched on - the left stick. They
          are not rebindable, because there is nothing else on a pad that four directions could
          sensibly mean. The default is
          <code>{formatBindings(DEFAULT_BINDINGS) || 'the console layout'}</code>.
        </p>
      {:else if tab === 'desktop'}
        <p class="lead">
          Outside game mode, the controller can drive this desktop: buttons become key presses,
          clicks and scrolling, and the right stick becomes a pointer. <strong>It reaches this
          desktop only.</strong> Typing into a game or another application means a Win32 call that
          Seelen's command surface does not offer, so nothing here leaves the surface.
        </p>

        {#each GAME_MODE_FIELDS.desktop as def (def.key)}
          <SettingField {def} {scope} />
        {/each}

        <h3>What each button does</h3>
        <div class="map">
          {#each BUTTON_ORDER as button (button)}
            {@const target = translation[button]}
            <div class="mrow" class:pressed={down.includes(button)}>
              <kbd>{glyphFor(button, layout)}</kbd>
              <span class="mto">{target ? target.label : '—'}</span>
            </div>
          {/each}
        </div>
      {:else if tab === 'library'}
        {#each GAME_MODE_FIELDS.library as def (def.key)}
          <SettingField {def} {scope} />
        {/each}

        <h3>Descriptions</h3>
        <p class="lead">
          Detection finds names and paths; no store tells a widget what a game <em>is</em>. A model
          can fill that in - it is asked for the whole library at once, told to answer with an empty
          string for anything it does not recognise, and the answers are kept on disk so it is only
          asked once. It uses the assistant's own services and keys.
        </p>

        <div class="ai">
          <div class="aistat">
            <span class="aivalue">{blurbs.count}</span>
            <span class="ailabel">written</span>
          </div>
          <div class="aistat">
            <span class="aivalue">{missing}</span>
            <span class="ailabel">still to do</span>
          </div>
          <div class="aiservice">
            {#if blurbState.kind === 'ready'}
              <span>{blurbService.label}</span>
              <span class="aimodel">{blurbs.model()}</span>
            {:else if blurbState.kind === 'key'}
              <span class="aiwarn">{blurbService.label} needs an API key</span>
              <span class="aimodel">Add one in the assistant's settings</span>
            {:else if blurbState.kind === 'offline'}
              <span class="aiwarn">{blurbService.label} is not running</span>
            {:else}
              <span class="aiwarn">The assistant is set to local services only</span>
              <span class="aimodel">Choose Ollama or LM Studio for it</span>
            {/if}
          </div>
        </div>

        {#if blurbs.busy && blurbs.progress}
          <div class="progress" role="status">
            <span
              style:width="{blurbs.progress.total
                ? (blurbs.progress.done / blurbs.progress.total) * 100
                : 0}%"
            ></span>
          </div>
          <p class="note">Describing {blurbs.progress.done} of {blurbs.progress.total}…</p>
        {:else if blurbs.error}
          <p class="note aiwarn">{blurbs.error}</p>
        {:else if blurbs.skipped}
          <p class="note">
            {blurbs.skipped}
            {blurbs.skipped === 1 ? 'entry was' : 'entries were'} left blank - the model did not
            recognise them, which is the right answer for a folder or an installer.
          </p>
        {/if}

        <div class="buttons">
          {#if blurbs.busy}
            <button class="m-btn" onclick={() => blurbs.cancel()}>Stop</button>
          {:else}
            <button
              class="m-btn m-primary"
              disabled={blurbState.kind !== 'ready' || !missing}
              onclick={() => void writeBlurbs(false)}
            >
              {missing ? `Describe ${missing} games` : 'Everything is described'}
            </button>
            <button
              class="m-btn"
              disabled={blurbState.kind !== 'ready' || !describable.length}
              onclick={() => void writeBlurbs(true)}
            >
              Rewrite all
            </button>
            <button class="m-btn" disabled={!blurbs.count} onclick={() => blurbs.clear()}>
              Delete them
            </button>
          {/if}
        </div>
      {:else}
        {#each GAME_MODE_FIELDS[tab] as def (def.key)}
          <SettingField {def} {scope} />
        {/each}
      {/if}
    </div>
  </div>
</Modal>

<style>
  .frame {
    display: flex;
    gap: 18px;
    min-height: 460px;
  }

  .side {
    flex: none;
    width: 210px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 14px;
    border-right: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .section {
    margin: 12px 0 4px;
    font-size: calc(10px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  .section:first-child {
    margin-top: 0;
  }

  .nav {
    padding: 7px 10px;
    text-align: left;
    cursor: pointer;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg-muted);
  }

  .nav:hover {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .nav.on {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 26%, transparent);
  }

  .pane {
    flex: 1;
    min-width: 0;
    max-height: 62vh;
    overflow-y: auto;
    padding-right: 6px;
  }

  .lead,
  .note {
    margin: 0 0 14px;
    font-size: calc(12px * var(--text-scale, 1));
    line-height: 1.55;
    color: var(--panel-fg-muted);
  }

  .note {
    margin-top: 12px;
  }

  code {
    font-family: var(--mono-font);
    font-size: 0.94em;
  }

  h3 {
    margin: 18px 0 4px;
    font-size: calc(10px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  h3.first {
    margin-top: 0;
  }

  /* ------------------------------------------------------- displays -- */

  .monitors {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
    margin-bottom: 4px;
  }

  .monitor {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 11px 13px;
    text-align: left;
    cursor: pointer;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .monitor.on {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 28%, transparent);
    box-shadow: inset 0 0 0 1px var(--accent, #7aa2f7);
  }

  .mname {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: calc(12px * var(--text-scale, 1));
    font-weight: 600;
  }

  .mid {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .tag {
    padding: 1px 6px;
    font-size: calc(9px * var(--text-scale, 1));
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: 999px;
    background: color-mix(in oklab, var(--color-gray-300, #666) 40%, transparent);
  }

  /* --------------------------------------------------------- tester -- */

  .tester {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
    padding: 13px 15px;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 40%, transparent);
    /* Dimmed until a pad is actually answering, which is itself the readout. */
    opacity: 0.55;
  }

  .tester.live {
    opacity: 1;
  }

  .tline {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: calc(12px * var(--text-scale, 1));
  }

  .tlabel {
    flex: none;
    width: 92px;
    color: var(--panel-fg-muted);
  }

  .tvalue {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono {
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--panel-fg-muted);
  }

  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    height: 22px;
    padding-inline: 6px;
    font: inherit;
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 700;
    border-radius: 999px;
    background: color-mix(in oklab, var(--accent, #7aa2f7) 45%, transparent);
  }

  /* ------------------------------------------------------- bindings -- */

  .binds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 7px;
  }

  .bind {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px;
    border-radius: calc(9px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
    transition: background 100ms ease;
  }

  /* Lights up as the button is held, so a binding can be checked by pressing. */
  .bind.pressed,
  .mrow.pressed {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 34%, transparent);
  }

  .bname {
    flex: 1;
    min-width: 0;
    font-size: calc(12px * var(--text-scale, 1));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bind select {
    flex: none;
    width: 108px;
    padding: 4px 6px;
    font-size: calc(11px * var(--text-scale, 1));
    border-radius: calc(7px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 60%, transparent);
  }

  .warn {
    flex: none;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--color-yellow-400, #facc15);
  }

  /* ---------------------------------------------------------- the map -- */

  .map {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 6px;
  }

  .mrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
  }

  .mto {
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 12px;
  }

  /* ---------------------------------------------------- descriptions -- */

  .ai {
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 12px 15px;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 40%, transparent);
  }

  .aistat {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .aivalue {
    font-family: var(--display-font);
    font-size: calc(21px * var(--text-scale, 1));
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .ailabel,
  .aimodel {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .aiservice {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: right;
    font-size: calc(12px * var(--text-scale, 1));
  }

  .aiwarn {
    color: var(--color-yellow-400, #facc15);
  }

  .progress {
    height: 6px;
    margin-top: 12px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .progress > span {
    display: block;
    height: 100%;
    background: var(--accent, #7aa2f7);
    transition: width 200ms ease;
  }
</style>
