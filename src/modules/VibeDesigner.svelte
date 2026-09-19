<script lang="ts">
  import { onMount, tick } from 'svelte';
  import FieldRow from './FieldRow.svelte';
  import { DEFAULT_CONFIG, config } from '$lib/config.svelte';
  import { chat } from '$lib/chat.svelte';
  import { PROVIDERS, providerFor, type ProviderId } from '$lib/providers';
  import { designer, FREE_PROVIDERS } from '$lib/vibe.svelte';
  import { VIBE_EXAMPLES, VIBE_FIELDS, vibeKnobs, type VibeDesign } from '$lib/vibe';
  import { fonts } from '$lib/fonts.svelte';
  import { shell } from '$lib/shell-settings.svelte';
  import { presets } from '$lib/presets.svelte';
  import {
    applyShell,
    applyValues,
    restoreAppearance,
    snapshotAppearance,
    type AppearanceSnapshot,
  } from '$lib/apply-appearance';
  import { THEME_KNOBS, decodeKnob, shareableShell } from '$lib/shell-theme';

  /**
   * The Appearance dialog's AI designer: a vibe in words, a design back.
   *
   * The design is applied the moment it arrives, because the desktop itself is
   * the only preview worth having - and everything it changed is snapshotted
   * first, so Undo puts back exactly what was there, shell included.
   */
  interface Props {
    scope: 'monitor' | 'all';
  }

  let { scope }: Props = $props();

  const cfg = $derived(config.current);
  const setup = $derived(designer.state());
  const provider = $derived(providerFor(designer.provider));

  let prompt = $state('');
  let adjust = $state(false);
  let includeShell = $state(true);
  let keyDraft = $state('');
  let composer = $state<HTMLTextAreaElement | null>(null);
  let startedAt = $state(0);
  let now = $state(Date.now());

  interface Change {
    label: string;
    value: string;
  }

  let result = $state<{
    design: VibeDesign;
    before: AppearanceSnapshot;
    prompt: string;
    changes: Change[];
    saved: boolean;
    undone: boolean;
  } | null>(null);

  onMount(() => {
    void designer.load().then(() => designer.suggest(config.current.chatProvider));
    void fonts.load();
    void presets.load();
    const timer = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(timer);
  });

  const providerOptions = PROVIDERS.map((p) => ({
    value: p.id,
    label: `${p.label}${FREE_PROVIDERS.includes(p.id) ? ' - free' : ''}${p.local ? ', on this PC' : ''}`,
  }));

  /** Where to get a key, said plainly: the dialog cannot open a browser for you. */
  const KEY_HELP: Partial<Record<ProviderId, string>> = {
    gemini: 'Free: go to aistudio.google.com/apikey, sign in with a Google account, choose "Create API key", and paste it here.',
    groq: 'Free: create a key at console.groq.com/keys and paste it here.',
    openrouter: 'Create a key at openrouter.ai/keys. For free use, type a model whose name ends in ":free".',
    openai: 'Paid: create a key at platform.openai.com/api-keys.',
    anthropic: 'Paid: create a key at console.anthropic.com/settings/keys.',
  };

  const elapsed = $derived(Math.max(0, Math.round((now - startedAt) / 1000)));

  function describe(value: unknown): string {
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    if (value === '') return 'default';
    return String(value);
  }

  function changesOf(design: VibeDesign): Change[] {
    const labels = new Map<string, string>(VIBE_FIELDS.map((def) => [def.key, def.label]));
    const desktop = Object.entries(design.desktop).map(([key, value]) => ({
      label: labels.get(key) ?? key,
      value: describe(value),
    }));
    const shellChanges = Object.entries(design.shell).map(([name, stored]) => {
      const knob = THEME_KNOBS.find((k) => k.name === name);
      return { label: `Shell · ${knob?.label ?? name}`, value: knob ? describe(decodeKnob(knob, stored)) : stored };
    });
    return [...desktop, ...shellChanges];
  }

  async function run(): Promise<void> {
    const text = prompt.trim();
    if (!text || designer.busy || setup.kind !== 'ready') return;

    // Everything a design may change, captured before it does.
    const before = snapshotAppearance(VIBE_FIELDS.map((def) => def.key));
    startedAt = Date.now();
    now = startedAt;

    try {
      await Promise.all([fonts.load(), shell.ensureLoaded()]);
      const design = await designer.design({
        prompt: text,
        adjust,
        current: config.current as unknown as Record<string, unknown>,
        currentShell: shell.values,
        fonts: fonts.fromHost ? fonts.families : [],
        styleShell: cfg.styleShell,
        includeShell,
      });

      if (adjust) {
        applyValues(design.desktop, scope);
        for (const [name, stored] of Object.entries(design.shell)) shell.setStored(name, stored);
      } else {
        // A fresh design is whole: what it does not mention goes back to its default.
        const defaults = Object.fromEntries(VIBE_FIELDS.map((def) => [def.key, DEFAULT_CONFIG[def.key]]));
        applyValues({ ...defaults, ...design.desktop }, scope);
        if (includeShell) applyShell(design.shell, vibeKnobs(cfg.styleShell).map((knob) => knob.name));
      }

      result = { design, before, prompt: text, changes: changesOf(design), saved: false, undone: false };
    } catch {
      // `designer.error` already says why, where the dialog shows it.
    }
  }

  function undo(): void {
    if (!result || result.undone) return;
    restoreAppearance(result.before, scope);
    result = { ...result, undone: true };
  }

  function redo(): void {
    if (!result || !result.undone) return;
    // Re-applying the snapshot's opposite is the design itself, over what was there.
    const design = result.design;
    const defaults = Object.fromEntries(VIBE_FIELDS.map((def) => [def.key, DEFAULT_CONFIG[def.key]]));
    applyValues(adjust ? design.desktop : { ...defaults, ...design.desktop }, scope);
    for (const [name, stored] of Object.entries(design.shell)) shell.setStored(name, stored);
    result = { ...result, undone: false };
  }

  async function refine(): Promise<void> {
    adjust = true;
    prompt = '';
    await tick();
    composer?.focus();
  }

  function save(): void {
    if (!result) return;
    const current = config.current as unknown as Record<string, unknown>;
    presets.add({
      label: result.design.name,
      description: result.design.summary || result.prompt,
      values: Object.fromEntries(VIBE_FIELDS.map((def) => [def.key, current[def.key]])),
      shell: shareableShell(shell.values),
      source: 'ai',
      prompt: result.prompt,
    });
    result = { ...result, saved: true };
  }

  function saveKey(): void {
    const key = keyDraft.trim();
    if (!key) return;
    chat.setKey(designer.provider, key);
    keyDraft = '';
  }

  function keys(event: KeyboardEvent): void {
    // Enter sends and Shift+Enter breaks the line, as in the assistant. Read on
    // keydown: a desktop-preset window never delivers a form's implicit submit.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void run();
    }
  }
</script>

<p class="lead">
  Describe a vibe and a model designs the desktop{includeShell ? ', the dock and the start menu' : ''} to match. Every
  choice is an ordinary setting you can tune afterwards, and Undo puts it all back.
</p>

{#if setup.kind === 'key'}
  <div class="setup">
    <strong>{provider.label} needs an API key</strong>
    <p class="note">{KEY_HELP[designer.provider] ?? `Paste a ${provider.label} API key.`}</p>
    <div class="key-row">
      <input
        type="password"
        spellcheck="false"
        autocomplete="off"
        placeholder="Paste the API key"
        aria-label="{provider.label} API key"
        bind:value={keyDraft}
        onkeydown={(e) => e.key === 'Enter' && saveKey()}
      />
      <button class="m-btn m-primary" disabled={!keyDraft.trim()} onclick={saveKey}>Save key</button>
    </div>
    <p class="note">Kept on this PC with the assistant's keys, so the assistant can use it too.</p>
  </div>
{:else if setup.kind === 'offline'}
  <div class="setup">
    <strong>{provider.label} is not running</strong>
    <p class="note">
      {#if designer.provider === 'ollama'}
        Free and private: install Ollama from ollama.com, run <code>ollama pull gemma3</code> once, and it appears here.
      {:else}
        Start the server, or set its address in the assistant's settings.
      {/if}
    </p>
  </div>
{:else if setup.kind === 'local-only'}
  <div class="setup">
    <strong>Local services only</strong>
    <p class="note">The assistant is set to keep everything on this PC. Choose Ollama or LM Studio below, or change its privacy setting.</p>
  </div>
{/if}

<div class="composer">
  <textarea
    bind:this={composer}
    bind:value={prompt}
    rows="3"
    spellcheck="true"
    placeholder={adjust ? 'What should change? e.g. warmer, less glow, bigger corners' : 'e.g. a rainy café in Tokyo at night'}
    aria-label="Describe the vibe"
    disabled={designer.busy}
    onkeydown={keys}
  ></textarea>

  {#if !adjust}
    <div class="examples">
      {#each VIBE_EXAMPLES as example (example)}
        <button class="m-chip" disabled={designer.busy} onclick={() => (prompt = example)}>{example}</button>
      {/each}
    </div>
  {/if}

  <div class="bar-row">
    <div class="options">
      <label><input type="checkbox" bind:checked={adjust} disabled={designer.busy} /> Adjust what I have</label>
      <label><input type="checkbox" bind:checked={includeShell} disabled={designer.busy} /> Dock and start menu too</label>
    </div>
    {#if designer.busy}
      <button class="m-btn" onclick={() => designer.cancel()}>Stop</button>
    {:else}
      <button class="m-btn m-primary" disabled={!prompt.trim() || setup.kind !== 'ready'} onclick={run}>
        {adjust ? 'Adjust it' : 'Design it'}
      </button>
    {/if}
  </div>
</div>

{#if designer.busy}
  <p class="status" role="status">
    <span class="spinner" aria-hidden="true"></span>
    Designing with {provider.label} · {designer.modelFor() || 'default model'} · {elapsed}s
  </p>
{:else if designer.error}
  <p class="status bad" role="alert">{designer.error}</p>
{/if}

{#if result}
  <div class="result" class:undone={result.undone}>
    <div class="result-head">
      <strong>{result.design.name}</strong>
      <span class="note">{result.changes.length} settings{result.undone ? ' · undone' : ''}</span>
    </div>
    {#if result.design.summary}<p class="summary">{result.design.summary}</p>{/if}
    <div class="bar-row">
      <div class="options">
        {#if result.undone}
          <button class="m-btn" onclick={redo}>Apply again</button>
        {:else}
          <button class="m-btn" onclick={undo}>Undo</button>
        {/if}
        <button class="m-btn" disabled={result.undone} onclick={refine}>Adjust this</button>
      </div>
      <button class="m-btn m-primary" disabled={result.saved || result.undone} onclick={save}>
        {result.saved ? 'Saved to your presets' : 'Save as preset'}
      </button>
    </div>
    <details>
      <summary>What it set</summary>
      <ul class="changes">
        {#each result.changes as change, i (i)}
          <li><span>{change.label}</span><code>{change.value}</code></li>
        {/each}
      </ul>
    </details>
    {#if result.design.dropped.length}
      <p class="note">Ignored because this desktop does not accept them: {result.design.dropped.join(', ')}.</p>
    {/if}
  </div>
{/if}

<h3>Model</h3>
<FieldRow
  label="Service"
  description="Gemini, Groq and OpenRouter have free tiers; Ollama and LM Studio run on this PC for free."
  type="select"
  value={designer.provider}
  options={providerOptions}
  onchange={(value) => designer.choose(value as ProviderId)}
/>
<FieldRow
  label="Model"
  description={provider.defaultModel ? `Blank uses ${provider.defaultModel}.` : 'Blank uses the first installed model.'}
  type="text"
  value={designer.model}
  placeholder={provider.defaultModel || chat.localModel(designer.provider) || 'model name'}
  onchange={(value) => designer.setModel(String(value))}
/>
{#if setup.kind === 'ready' && !provider.keyless && !provider.local}
  <p class="note key-note">
    Using the {provider.label} key saved with the assistant.
    <button class="link" onclick={() => chat.setKey(designer.provider, '')}>Remove it</button>
  </p>
{/if}
<p class="note">
  Sent to the service: your words, the list of settings and their allowed values, your installed font names, and for an
  adjustment the current values. Nothing else about this PC.
</p>

<style>
  .lead,
  .note,
  .summary {
    margin: 0 0 10px;
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    line-height: 1.45;
  }

  .summary {
    color: var(--panel-fg);
    font-size: calc(12px * var(--text-scale, 1));
  }

  h3 {
    margin: 22px 0 4px;
    font-size: calc(10px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  .setup,
  .result {
    margin-bottom: 12px;
    padding: 12px 14px;
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .setup strong,
  .result strong {
    display: block;
    margin-bottom: 4px;
    font-size: calc(13px * var(--text-scale, 1));
  }

  .key-row {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
  }

  .key-row input {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    font-size: calc(12px * var(--text-scale, 1));
    font-family: var(--mono-font);
    color: var(--panel-fg);
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 60%, transparent);
  }

  .composer textarea {
    display: block;
    width: 100%;
    resize: vertical;
    padding: 10px 12px;
    font-size: calc(14px * var(--text-scale, 1));
    line-height: 1.4;
    color: var(--panel-fg);
    border-radius: calc(10px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-50, #111) 70%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .composer textarea:focus {
    outline: none;
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent),
      0 0 0 3px color-mix(in oklab, var(--accent, #7aa2f7) 16%, transparent);
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }

  .bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    font-size: calc(12px * var(--text-scale, 1));
  }

  .options label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .options input {
    accent-color: var(--accent, #7aa2f7);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .status.bad {
    color: var(--color-red-700, #f77);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid color-mix(in oklab, var(--accent, #7aa2f7) 30%, transparent);
    border-top-color: var(--accent, #7aa2f7);
    animation: fx-spin 900ms linear infinite;
  }

  .result {
    margin-top: 12px;
    transition: opacity var(--dur) var(--ease);
  }

  .result.undone {
    opacity: 0.65;
  }

  .result-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  details {
    margin-top: 10px;
    font-size: calc(11px * var(--text-scale, 1));
  }

  summary {
    cursor: pointer;
    color: var(--panel-fg-muted);
  }

  .changes {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 2px 16px;
  }

  .changes li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
  }

  .changes code,
  code {
    font-family: var(--mono-font);
    font-size: 0.95em;
    user-select: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .key-note {
    margin-top: 6px;
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
</style>
