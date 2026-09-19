<script lang="ts" module>
  import { onDestroy, onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import SettingField from './SettingField.svelte';
  import ShellField from './ShellField.svelte';
  import FieldRow from './FieldRow.svelte';
  import VibeDesigner from './VibeDesigner.svelte';
  import WallpaperPicker from './wallpaper/WallpaperPicker.svelte';
  import { DEFAULT_CONFIG, config, type ConfigKey } from '$lib/config.svelte';
  import { applyUserCss } from '$lib/appearance';
  import { applyLook, applyPreset, applyValues } from '$lib/apply-appearance';
  import {
    APPEARANCE_FIELDS,
    APPEARANCE_TABS,
    CSS_SNIPPETS,
    STYLE_SHELL_FIELD,
    fieldVisible,
    type AppearanceTab,
  } from '$lib/appearance-fields';
  import {
    APPEARANCE_KEYS,
    LOOKS,
    SHARED_EXTRA_KEYS,
    currentLook,
    exportAppearance,
    parseAppearance,
    resolveLook,
    type Look,
  } from '$lib/looks';
  import { SCHEME_OPTIONS, paletteFor, schemePolarity } from '$lib/schemes';
  import { KNOB_GROUPS, THEME_KNOBS, shareableShell } from '$lib/shell-theme';
  import { shell } from '$lib/shell-settings.svelte';
  import { presets, type SavedPreset } from '$lib/presets.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { MODULE_ORDER } from '$lib/modules';

  /** Every desktop key this dialog can change, for the scope and the reset. */
  const OWNED: readonly ConfigKey[] = [
    ...new Set<ConfigKey>([
      ...APPEARANCE_KEYS,
      ...SHARED_EXTRA_KEYS,
      'styleShell',
      ...Object.values(APPEARANCE_FIELDS).flatMap((fields) => fields.map((field) => field.key)),
    ]),
  ];

  /** What a saved preset keeps of the desktop: every look setting and the wallpaper's treatment. */
  const PRESET_KEYS: readonly ConfigKey[] = [
    ...new Set<ConfigKey>([
      ...APPEARANCE_KEYS,
      'wallpaperBlur',
      'wallpaperSaturation',
      'wallpaperBrightness',
      'wallpaperOverlayColor',
      'wallpaperOverlayOpacity',
      'motionScale',
      'staggerScale',
    ]),
  ];

  /** The ground a look's card is drawn over: a stand-in wallpaper, fixed so cards compare. */
  const WALL = 'linear-gradient(140deg, #243150 0%, #5b4a72 50%, #c47f5b 100%)';

  const CARD_SHADOW: Record<string, string> = {
    none: 'none',
    soft: '0 2px 6px rgb(0 0 0 / 0.25)',
    medium: '0 4px 10px rgb(0 0 0 / 0.32)',
    deep: '0 8px 18px rgb(0 0 0 / 0.45)',
    hard: '4px 4px 0 rgb(0 0 0 / 0.8)',
  };

  const CARD_ROUND: Record<string, number> = { square: 0, subtle: 0.5, rounded: 1, round: 1.6, pill: 2.6 };

  /** What a look's card draws, worked out from the look's own values. */
  function cardFor(look: Look) {
    const v = resolveLook(look, DEFAULT_CONFIG);
    const p = paletteFor(v.colorScheme);
    const custom = v.colorScheme === 'custom';
    const bg = p?.bg ?? (custom ? v.schemeGround : '#16161e');
    const fg = p?.fg ?? (custom ? v.schemeInk : '#e8e8ee');
    const accent = (v.schemeAccent ? p?.accent : undefined) ?? v.accentColor;
    const accent2 = (v.schemeAccent ? p?.accent2 : undefined) ?? v.accentColor2;
    const edgeInk = v.panelBorderColor === 'accent' ? accent : fg;
    const edgeShare = v.panelBorderColor === 'neutral' ? v.panelBorder * 0.45 : v.panelBorder;

    return {
      look: v,
      tone: schemePolarity(v.colorScheme, v.schemeGround) ?? 'dark',
      fg,
      accent,
      accent2,
      bg: `color-mix(in oklab, ${bg} ${Math.max(v.panelOpacity, 14)}%, transparent)`,
      edge:
        v.panelBorderColor === 'gradient'
          ? 'transparent'
          : `color-mix(in oklab, ${edgeInk} ${Math.round(edgeShare)}%, transparent)`,
      edgeWidth: `${Math.min(v.panelBorderWidth, 3)}px`,
      radius: `${Math.round(v.cornerRadius * 0.55)}px`,
      round: CARD_ROUND[v.controlShape] ?? 1,
      shadow:
        v.panelShadow === 'glow'
          ? `0 0 16px color-mix(in oklab, ${accent} 60%, transparent)`
          : v.panelShadow === 'block'
            ? `4px 4px 0 ${accent}`
            : (CARD_SHADOW[v.panelShadow] ?? 'none'),
      backdrop: v.panelBlur ? `blur(${Math.round(v.panelBlur / 3)}px)` : 'none',
      bar:
        v.barStyle === 'gradient'
          ? `linear-gradient(90deg, ${accent}, ${accent2})`
          : v.barStyle === 'striped'
            ? `repeating-linear-gradient(-45deg, ${accent} 0 4px, color-mix(in oklab, ${accent} 50%, transparent) 4px 8px)`
            : accent,
      font: v.fontFamily ? `"${v.fontFamily}", system-ui, sans-serif` : 'inherit',
      title: v.titleStyle === 'caps' ? 'CLOCK' : v.titleStyle === 'lower' ? 'clock' : 'Clock',
    };
  }

  type Card = ReturnType<typeof cardFor>;

  function asLook(preset: SavedPreset): Look {
    return { id: preset.id, label: preset.label, description: preset.description, values: preset.values as Look['values'] };
  }
</script>

<script lang="ts">
  interface Props {
    onclose: () => void;
    tab?: AppearanceTab;
  }

  let { onclose, tab: initialTab = 'looks' }: Props = $props();

  const cfg = $derived(config.current);

  /* Same rule as a module's dialog: a display that already has its own
     appearance keeps being edited on its own, one that follows the others is
     not detached by the first click. */
  let scope = $state<'monitor' | 'all'>(OWNED.some((key) => config.overrides.has(key)) ? 'monitor' : 'all');
  // The tab it opens on, read once on purpose: after that the tab list owns it.
  // svelte-ignore state_referenced_locally
  let tab = $state<AppearanceTab>(initialTab);

  const overridden = $derived(OWNED.filter((key) => config.overrides.has(key)));
  const activeLook = $derived(currentLook(cfg, DEFAULT_CONFIG));
  const sections = [...new Set(APPEARANCE_TABS.map((entry) => entry.section))];

  // The Shell tab reads Seelen's own settings; follow them while this is open.
  onMount(() => shell.start());
  onMount(() => void presets.load());

  function setKey(key: ConfigKey, value: unknown): void {
    config.set(key as never, value as never, scope);
  }

  function chooseWallpaper(): void {
    // One dialog at a time: this one gives way to the picker.
    overlay.openDialog(WallpaperPicker, { onclose: () => overlay.closeDialog() });
  }

  /* ----------------------------------------------------------------- looks */

  const builtIn = LOOKS.map((look) => ({ id: look.id, source: look, ...cardFor(look) }));
  let lookQuery = $state('');
  let lookTone = $state<'all' | 'dark' | 'light'>('all');
  let presetName = $state('');

  const matches = (label: string, description: string, tone: string) => {
    const q = lookQuery.trim().toLowerCase();
    return (lookTone === 'all' || tone === lookTone) && (!q || `${label} ${description}`.toLowerCase().includes(q));
  };

  const shownLooks = $derived(builtIn.filter((card) => matches(card.source.label, card.source.description, card.tone)));
  const savedCards = $derived(
    presets.list
      .map((preset) => ({ id: preset.id, preset, ...cardFor(asLook(preset)) }))
      .filter((card) => matches(card.preset.label, card.preset.description, card.tone)),
  );

  function saveCurrent(): void {
    const current = config.current as unknown as Record<string, unknown>;
    presets.add({
      label: presetName.trim().slice(0, 40) || `My look ${presets.list.length + 1}`,
      description: `Saved ${new Date().toLocaleDateString()}`,
      values: Object.fromEntries(PRESET_KEYS.map((key) => [key, current[key]])),
      shell: shareableShell(shell.values),
      source: 'saved',
    });
    presetName = '';
  }

  /* ------------------------------------------------------------ custom CSS */

  /*
   * The stylesheet is previewed as it is typed and written when the field is
   * left - or on Ctrl+Enter, or when the dialog closes with an edit pending.
   * Writing per keystroke would rewrite the settings file for every letter.
   */
  let draft = $state(config.current.customCss);
  let dirty = $state(false);

  function editCss(next: string): void {
    draft = next;
    dirty = true;
    applyUserCss(next);
  }

  function commitCss(): void {
    if (!dirty) return;
    dirty = false;
    if (draft !== config.current.customCss) config.set('customCss', draft, scope);
  }

  function revertCss(): void {
    draft = config.current.customCss;
    dirty = false;
    applyUserCss(draft);
  }

  function insertSnippet(css: string): void {
    const base = draft.trimEnd();
    editCss(`${base}${base ? '\n\n' : ''}${css}\n`);
  }

  function cssKeys(event: KeyboardEvent): void {
    const area = event.currentTarget as HTMLTextAreaElement;
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      editCss(area.value);
    } else if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      commitCss();
    } else if (event.key === 'Escape') {
      // The dialog closes on Escape; the stylesheet should not vanish with it.
      commitCss();
    }
  }

  onDestroy(commitCss);

  /* ----------------------------------------------------------------- share */

  const exported = $derived(exportAppearance(cfg, shareableShell(shell.values)));
  let exportArea = $state<HTMLTextAreaElement | null>(null);
  let copied = $state(false);
  let pasted = $state('');
  let importNote = $state<{ ok: boolean; text: string } | null>(null);

  async function copyExport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exported);
    } catch {
      exportArea?.select();
      document.execCommand('copy');
    }
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  function importPasted(): void {
    const result = parseAppearance(pasted, DEFAULT_CONFIG);
    if (!result.ok) {
      importNote = { ok: false, text: result.error };
      return;
    }
    applyValues(result.values, scope);
    // Only settings the theme really has, and none the desktop writes for itself.
    for (const [name, stored] of Object.entries(shareableShell(result.shell))) shell.setStored(name, stored);
    if (typeof result.values.customCss === 'string') {
      draft = result.values.customCss;
      dirty = false;
    }
    const count = Object.keys(result.values).length + Object.keys(result.shell).length;
    importNote = {
      ok: true,
      text:
        `Applied ${count} setting${count === 1 ? '' : 's'}.` +
        (result.skipped.length ? ` Left out: ${result.skipped.join(', ')}.` : ''),
    };
  }

  function resetDesktop(): void {
    applyValues(Object.fromEntries(OWNED.map((key) => [key, DEFAULT_CONFIG[key]])), scope);
    draft = '';
    dirty = false;
  }

  function resetShell(): void {
    for (const knob of THEME_KNOBS) {
      if (shell.values[knob.name] !== undefined) shell.reset(knob.name);
    }
  }
</script>

{#snippet lookCard(card: Card, label: string, description: string, active: boolean, onpick: () => void)}
  <button class="look" class:on={active} aria-pressed={active} onclick={onpick}>
    <span class="stage" style:background={WALL}>
      <span
        class="mini"
        class:ring={card.look.panelBorderColor === 'gradient'}
        style:--a={card.accent}
        style:--a2={card.accent2}
        style:--r={card.round}
        style:--bw={card.edgeWidth}
        style:background-color={card.bg}
        style:border-width={card.edgeWidth}
        style:border-style={card.look.panelBorderStyle}
        style:border-color={card.edge}
        style:border-radius={card.radius}
        style:box-shadow={card.shadow}
        style:backdrop-filter={card.backdrop}
        style:color={card.fg}
        style:font-family={card.font}
      >
        <span class="mini-title decor-{card.look.titleDecor}" style:text-align={card.look.titleAlign} style:font-weight={card.look.titleWeight}>
          {#if card.look.titleStyle !== 'hidden'}{card.title}{/if}
        </span>
        <span class="mini-stat" style:font-weight={card.look.displayWeight}>09:41</span>
        <span class="mini-bar" style:height="{Math.max(2, Math.round(card.look.barThickness * 0.6))}px">
          <span style:background={card.bar}></span>
        </span>
        <span class="mini-chips"><i></i><i></i></span>
      </span>
    </span>
    <span class="look-name">
      {label}
      {#if active}<span class="tick" aria-label="current">&#10003;</span>{/if}
    </span>
    <span class="look-desc">{description}</span>
  </button>
{/snippet}

<Modal title="Appearance" {onclose} width={920}>
  <div class="frame">
    <nav class="side" aria-label="Appearance sections">
      {#each sections as section (section)}
        <span class="section">{section}</span>
        {#each APPEARANCE_TABS.filter((entry) => entry.section === section) as entry (entry.id)}
          <button class="nav" class:on={tab === entry.id} aria-current={tab === entry.id ? 'page' : undefined} onclick={() => (tab = entry.id)}>
            {entry.label}
          </button>
        {/each}
      {/each}
    </nav>

    <div class="pane">
      {#if tab === 'shell'}
        <p class="lead">
          Seelen's dock, start button, start menu, switcher and popups, dressed by the Desktop Surface theme. These are
          the same on every display.
        </p>
      {:else}
        <div class="scope" role="group" aria-label="Where changes apply">
          <span class="scope-label">Apply to</span>
          <div class="m-tabs">
            <button class:m-on={scope === 'all'} onclick={() => (scope = 'all')}>All displays</button>
            <button class:m-on={scope === 'monitor'} onclick={() => (scope = 'monitor')}>This display</button>
          </div>
        </div>
      {/if}

      {#if tab === 'looks'}
        <div class="look-tools">
          <input
            class="search"
            type="search"
            placeholder="Search {builtIn.length + presets.list.length} looks"
            aria-label="Search looks"
            bind:value={lookQuery}
          />
          <div class="m-tabs">
            <button class:m-on={lookTone === 'all'} onclick={() => (lookTone = 'all')}>All</button>
            <button class:m-on={lookTone === 'dark'} onclick={() => (lookTone = 'dark')}>Dark</button>
            <button class:m-on={lookTone === 'light'} onclick={() => (lookTone = 'light')}>Light</button>
          </div>
        </div>

        <h3 class="first">Your presets</h3>
        <div class="save-row">
          <input
            type="text"
            placeholder="Name this look"
            aria-label="Preset name"
            maxlength="40"
            bind:value={presetName}
            onkeydown={(e) => e.key === 'Enter' && saveCurrent()}
          />
          <button class="m-btn m-primary" onclick={saveCurrent}>Save current look</button>
          <button class="m-btn" onclick={() => (tab = 'vibe')}>Design one with AI...</button>
        </div>
        {#if savedCards.length}
          <div class="looks">
            {#each savedCards as card (card.id)}
              <div class="saved">
                {@render lookCard(card, card.preset.label, card.preset.description, false, () => void applyPreset(card.preset, scope))}
                {#if card.preset.source === 'ai'}<span class="badge" title={card.preset.prompt}>AI</span>{/if}
                <button class="remove" title="Delete this preset" aria-label="Delete {card.preset.label}" onclick={() => presets.remove(card.id)}>&times;</button>
              </div>
            {/each}
          </div>
        {:else if presets.list.length}
          <p class="note">None of your presets match.</p>
        {:else}
          <p class="note">Looks you save, or keep from the AI designer, appear here and in the desktop's Look menu.</p>
        {/if}

        <h3>Built in</h3>
        <p class="lead">A look sets every desktop appearance setting at once. Tune anything afterwards - it is still just your settings.</p>
        {#if shownLooks.length}
          <div class="looks">
            {#each shownLooks as card (card.id)}
              {@render lookCard(card, card.source.label, card.source.description, activeLook === card.id, () => applyLook(card.source, scope))}
            {/each}
          </div>
        {:else}
          <p class="note">No built-in look matches.</p>
        {/if}
      {:else if tab === 'vibe'}
        <VibeDesigner {scope} />
      {:else if tab === 'colour'}
        <div class="schemes">
          {#each SCHEME_OPTIONS as option (option.value)}
            {@const p = paletteFor(option.value)}
            <button
              class="swatch"
              class:on={cfg.colorScheme === option.value}
              aria-pressed={cfg.colorScheme === option.value}
              style:background={p?.bg ?? (option.value === 'custom' ? cfg.schemeGround : '#1c1c24')}
              style:color={p?.fg ?? (option.value === 'custom' ? cfg.schemeInk : '#e6e6ea')}
              onclick={() => setKey('colorScheme', option.value)}
            >
              <span class="swatch-name">{option.label}</span>
              <span class="dots" aria-hidden="true">
                {#if p}
                  {#each [p.red, p.orange, p.yellow, p.green, p.blue, p.purple] as colour, i (i)}
                    <i style:background={colour}></i>
                  {/each}
                {:else if option.value === 'custom'}
                  <i style:background={cfg.accentColor}></i>
                  <i style:background={cfg.accentColor2}></i>
                {:else}
                  <i style:background="var(--rs-accent, {cfg.accentColor})"></i>
                {/if}
              </span>
            </button>
          {/each}
        </div>
        {#each APPEARANCE_FIELDS.colour.filter((def) => def.key !== 'colorScheme' && fieldVisible(def.key, cfg)) as def (def.key)}
          <SettingField {def} {scope} />
        {/each}
      {:else if tab === 'wallpaper'}
        <div class="bar-row top-actions">
          <button class="m-btn m-primary" onclick={chooseWallpaper}>Choose wallpaper...</button>
          <span class="note">Picks a still, a video or a slideshow folder for this display.</span>
        </div>
        {#each APPEARANCE_FIELDS.wallpaper.filter((def) => fieldVisible(def.key, cfg)) as def (def.key)}
          <SettingField {def} {scope} />
        {/each}
      {:else if tab === 'shell'}
        <h3 class="first">Theme</h3>
        <FieldRow
          label="Use the Desktop Surface theme"
          description="Off, the shell falls back to Seelen's default look and none of the settings below apply."
          type="switch"
          value={shell.themeActive === true}
          onchange={(on) => shell.setThemeActive(on === true)}
        />
        <SettingField def={STYLE_SHELL_FIELD} scope="all" />

        {#if shell.packs.length}
          <h3>Icon packs</h3>
          {#each shell.packs as pack (pack.id)}
            <FieldRow
              label={pack.name}
              description={pack.description || undefined}
              type="switch"
              value={shell.activePacks.includes(pack.id)}
              onchange={(on) => shell.setPackActive(pack.id, on === true)}
            />
          {/each}
        {/if}

        {#each KNOB_GROUPS as group (group.id)}
          {@const knobs = THEME_KNOBS.filter((knob) => knob.group === group.id)}
          {@const shown = knobs.filter((knob) => !knob.synced || !cfg.styleShell)}
          <h3>{group.label}</h3>
          {#each shown as knob (knob.name)}
            <ShellField {knob} />
          {/each}
          {#if shown.length < knobs.length}
            <p class="follow">
              {knobs.length - shown.length === knobs.length ? 'All of these follow' : `${knobs.length - shown.length} more follow`}
              the desktop's own settings.
              <button class="link" onclick={() => config.set('styleShell', false, 'all')}>Set them separately</button>
            </p>
          {/if}
        {/each}

        <div class="bar-row">
          <button class="m-btn m-danger" onclick={resetShell}>Reset the shell to the theme's defaults</button>
        </div>
      {:else if tab === 'css'}
        <p class="lead">
          Your own stylesheet, applied after everything else and previewed as you type. Written when you leave the box
          or press Ctrl+Enter.
        </p>
        <textarea
          class="code"
          spellcheck="false"
          rows="14"
          placeholder={"[data-module='clock'] {\n  --accent: gold;\n}"}
          value={draft}
          oninput={(e) => editCss(e.currentTarget.value)}
          onchange={commitCss}
          onkeydown={cssKeys}
        ></textarea>
        <div class="bar-row">
          <div class="snippets">
            {#each CSS_SNIPPETS as snippet (snippet.label)}
              <button class="m-chip" onclick={() => insertSnippet(snippet.css)}>+ {snippet.label}</button>
            {/each}
          </div>
          <button class="m-btn" disabled={!dirty} onclick={revertCss}>Revert</button>
        </div>

        <details class="reference">
          <summary>Hooks and tokens</summary>
          <dl>
            <dt><code>.panel.module[data-module='…']</code></dt>
            <dd>One module's panel; its <code>header h2</code> and <code>.body</code> inside. Kinds: {MODULE_ORDER.join(', ')}.</dd>
            <dt><code>.panel.menu</code>, <code>.panel.dialog</code>, <code>.icon</code></dt>
            <dd>Menus, dialogs and desktop icons.</dd>
            <dt><code>.m-row .m-btn .m-chip .m-tabs .m-bar .m-switch .m-stat .m-pill</code></dt>
            <dd>The shared controls every module is built from.</dd>
            <dt><code>body[data-scheme|border|shadow|fill|bar|shape|labels|motion]</code></dt>
            <dd>The current value of each setting, to style for one scheme or one look only.</dd>
            <dt><code>--accent --accent-2 --panel-ground --panel-alpha --panel-backdrop</code></dt>
            <dd>Colour and material. Per element, so a rule on one module changes only that module.</dd>
            <dt><code>--surface-radius --panel-pad --round --density --text-scale --bar-h</code></dt>
            <dd>Shape and size multipliers.</dd>
            <dt><code>--ui-font --display-font --mono-font --color-gray-50 … 900</code></dt>
            <dd>Type, and the ramp every grey is mixed from. The settings set these inline on <code>body</code> - override them there with <code>!important</code>, or on any element inside without.</dd>
          </dl>
        </details>
      {:else if tab === 'share'}
        <p class="lead">
          The whole appearance - desktop and shell - as text, for another display, another PC, or a dotfiles repo.
        </p>
        <textarea class="code" readonly rows="10" bind:this={exportArea} value={exported} onfocus={(e) => e.currentTarget.select()}></textarea>
        <div class="bar-row">
          <button class="m-btn m-primary" onclick={copyExport}>{copied ? 'Copied' : 'Copy'}</button>
        </div>

        <h3>Import</h3>
        <textarea class="code" rows="6" spellcheck="false" placeholder="Paste an appearance here" bind:value={pasted}></textarea>
        <div class="bar-row">
          <button class="m-btn m-primary" disabled={!pasted.trim()} onclick={importPasted}>Apply</button>
          {#if importNote}<span class="note" class:bad={!importNote.ok}>{importNote.text}</span>{/if}
        </div>

        <h3>Reset</h3>
        <div class="bar-row">
          <button class="m-btn m-danger" onclick={resetDesktop}>Reset the desktop's appearance</button>
          <button class="m-btn m-danger" onclick={resetShell}>Reset the shell's</button>
        </div>
      {:else}
        {#each APPEARANCE_FIELDS[tab].filter((def) => fieldVisible(def.key, cfg)) as def (def.key)}
          <SettingField {def} {scope} />
        {/each}
      {/if}

      {#if overridden.length && tab !== 'shell'}
        <footer>
          <p class="note">
            {overridden.length}
            {overridden.length === 1 ? 'setting is' : 'settings are'} set only on this display.
          </p>
          <button class="m-btn" onclick={() => config.clearOverrides(overridden)}>Use the same as other displays</button>
        </footer>
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* A list of sections down the left, the settings to its right. */
  .frame {
    display: grid;
    grid-template-columns: 172px minmax(0, 1fr);
    gap: 18px;
    min-height: 480px;
  }

  /* Stays put while the settings beside it scroll. */
  .side {
    position: sticky;
    top: 0;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .section {
    margin: 10px 8px 4px;
    font-size: calc(9.5px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  .section:first-child {
    margin-top: 0;
  }

  .nav {
    padding: 6px 10px;
    font-size: calc(12px * var(--text-scale, 1));
    text-align: left;
    color: var(--panel-fg-muted);
    border-radius: calc(7px * var(--round, 1));
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }

  .nav:hover {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
  }

  .nav.on {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 24%, transparent);
  }

  .pane {
    min-width: 0;
  }

  .scope {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-bottom: 10px;
  }

  .scope-label,
  .lead,
  .note,
  .follow {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .lead {
    margin: 0 0 10px;
  }

  .note {
    margin: 0;
  }

  .note.bad {
    color: var(--color-red-700, #f77);
  }

  .follow {
    margin: 6px 0 0;
    padding: 7px 0;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .link {
    padding: 0;
    font-size: inherit;
    color: var(--accent, #7aa2f7);
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  h3 {
    margin: 20px 0 8px;
    font-size: calc(10px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  h3.first {
    margin-top: 6px;
  }

  .top-actions {
    margin: 0 0 10px;
    justify-content: flex-start;
  }

  /* ------------------------------------------------------------- looks */

  .look-tools,
  .save-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .look-tools {
    margin-bottom: 4px;
  }

  .save-row {
    margin-bottom: 10px;
  }

  .search,
  .save-row input {
    flex: 1 1 200px;
    min-width: 0;
    padding: 6px 9px;
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg);
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 55%, transparent);
  }

  .looks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
  }

  .saved {
    position: relative;
    display: grid;
  }

  .badge,
  .remove {
    position: absolute;
    top: 10px;
    z-index: 1;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(10px * var(--text-scale, 1));
  }

  .badge {
    left: 10px;
    padding: 1px 7px;
    font-weight: 700;
    color: #111;
    background: var(--accent, #7aa2f7);
    pointer-events: auto;
  }

  .remove {
    right: 10px;
    width: 20px;
    height: 20px;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    color: #fff;
    background: rgb(0 0 0 / 0.45);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }

  .saved:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    background: var(--color-red-700, #d33);
  }

  .look {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 6px 9px;
    text-align: left;
    color: var(--panel-fg);
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 12%, transparent);
    outline: 1.5px solid transparent;
    outline-offset: -1.5px;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease),
      outline-color var(--dur) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .look:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .look:active {
    scale: 0.97;
  }

  .look.on {
    outline-color: var(--accent, #7aa2f7);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 14%, transparent);
  }

  .stage {
    display: grid;
    place-items: center;
    height: 104px;
    border-radius: calc(7px * var(--round, 1));
    overflow: hidden;
  }

  .mini {
    position: relative;
    width: 128px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 7px 9px 9px;
    text-shadow: none;
    letter-spacing: normal;
  }

  /* The same gradient ring `base.css` draws round a real panel. */
  .mini.ring::before {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--bw));
    padding: max(1px, var(--bw));
    border-radius: inherit;
    background: linear-gradient(135deg, var(--a), var(--a2), var(--a));
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
  }

  .mini-title {
    display: block;
    min-height: 10px;
    font-size: 8px;
    letter-spacing: 0.06em;
    opacity: 0.8;
  }

  .mini-title.decor-bracket::before {
    content: '[ ';
    color: var(--a);
  }

  .mini-title.decor-bracket::after {
    content: ' ]';
    color: var(--a);
  }

  .mini-title.decor-dot::before {
    content: '';
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: 4px;
    vertical-align: 1px;
    border-radius: calc(99px * var(--r));
    background: var(--a);
  }

  .mini-title.decor-underline {
    padding-bottom: 3px;
    border-bottom: 1px solid color-mix(in oklab, currentColor 35%, transparent);
  }

  .mini-title.decor-tab {
    align-self: flex-start;
    padding: 1px 5px;
    border-radius: calc(99px * var(--r));
    background: color-mix(in oklab, var(--a) 30%, transparent);
    opacity: 1;
  }

  .mini-title.decor-bar {
    margin: -7px -9px 0;
    padding: 3px 9px;
    color: #111;
    background: linear-gradient(90deg, var(--a), var(--a2));
    opacity: 1;
  }

  .mini-stat {
    font-size: 22px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .mini-bar {
    display: block;
    border-radius: calc(99px * var(--r));
    overflow: hidden;
    background: color-mix(in oklab, currentColor 18%, transparent);
  }

  .mini-bar > span {
    display: block;
    width: 64%;
    height: 100%;
  }

  .mini-chips {
    display: flex;
    gap: 4px;
  }

  .mini-chips i {
    width: 24px;
    height: 9px;
    border-radius: calc(4px * var(--r));
    background: color-mix(in oklab, currentColor 20%, transparent);
  }

  .mini-chips i:first-child {
    background: color-mix(in oklab, var(--a) 60%, transparent);
  }

  .look-name {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px 0;
    font-size: calc(12px * var(--text-scale, 1));
    font-weight: 600;
  }

  .tick {
    color: var(--accent, #7aa2f7);
  }

  .look-desc {
    padding: 0 4px;
    font-size: calc(10.5px * var(--text-scale, 1));
    line-height: 1.35;
    color: var(--panel-fg-muted);
  }

  /* ------------------------------------------------------------ schemes */

  .schemes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 6px;
    margin-bottom: 12px;
  }

  .swatch {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 9px;
    text-align: left;
    border-radius: calc(8px * var(--round, 1));
    outline: 2px solid transparent;
    outline-offset: 1px;
    box-shadow: inset 0 0 0 1px rgb(127 127 127 / 0.25);
    text-shadow: none;
    cursor: pointer;
    transition:
      outline-color var(--dur) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .swatch:hover {
    scale: 1.03;
  }

  .swatch.on {
    outline-color: var(--accent, #7aa2f7);
  }

  .swatch-name {
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dots {
    display: flex;
    gap: 3px;
  }

  .dots i {
    width: 10px;
    height: 10px;
    border-radius: calc(99px * var(--round, 1));
  }

  /* ---------------------------------------------------------- css, share */

  .code {
    display: block;
    width: 100%;
    resize: vertical;
    padding: 9px 10px;
    font-family: var(--mono-font);
    font-size: calc(12px * var(--text-scale, 1));
    line-height: 1.5;
    tab-size: 2;
    white-space: pre;
    color: var(--panel-fg);
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-50, #111) 70%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .code:focus {
    outline: none;
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent),
      0 0 0 3px color-mix(in oklab, var(--accent, #7aa2f7) 16%, transparent);
  }

  .bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .snippets {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .reference {
    margin-top: 14px;
    font-size: calc(11px * var(--text-scale, 1));
  }

  .reference summary {
    cursor: pointer;
    color: var(--panel-fg-muted);
  }

  .reference dl {
    margin: 8px 0 0;
  }

  .reference dt {
    margin-top: 8px;
  }

  .reference dd {
    margin: 2px 0 0 12px;
    color: var(--panel-fg-muted);
    line-height: 1.4;
  }

  code {
    font-family: var(--mono-font);
    font-size: 0.95em;
    user-select: text;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }
</style>
