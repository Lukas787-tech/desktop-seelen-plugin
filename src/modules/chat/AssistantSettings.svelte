<script lang="ts">
  import Modal from '../Modal.svelte';
  import ModuleSettings from '../ModuleSettings.svelte';
  import { config } from '$lib/config.svelte';
  import { chat } from '$lib/chat.svelte';
  import { local } from '$lib/local.svelte';
  import { overlay } from '$lib/overlay.svelte';
  import { PROVIDERS, isProviderId, providerFor, type ProviderId } from '$lib/providers';
  import { TOOL_GROUPS, type Autonomy, type KeyId, type ThinkMode } from '$lib/assistant-state';
  import { formatBytes } from '$lib/system.svelte';
  import { untrack } from 'svelte';
  import type { SendOptions } from '$lib/chat.svelte';
  import { voice } from '$lib/voice.svelte';
  import { LANGUAGES, languageName } from '$lib/speech';
  import { STT_ENGINES, TTS_ENGINES, sttEngine, ttsEngine, voiceLabel, voiceLanguage, type SttEngineId, type TtsEngineId } from '$lib/voice-engines';
  import type { Sensitivity } from '$lib/vad';

  type Tab = 'model' | 'local' | 'agent' | 'voice' | 'tools' | 'memory';

  interface Props {
    onclose: () => void;
    tab?: Tab;
  }

  let { onclose, tab }: Props = $props();

  const TABS: readonly { id: Tab; label: string }[] = [
    { id: 'model', label: 'Model' },
    { id: 'local', label: 'Local models' },
    { id: 'agent', label: 'Agent' },
    { id: 'voice', label: 'Voice' },
    { id: 'tools', label: 'Tools' },
    { id: 'memory', label: 'Memory' },
  ];

  function initialTab(): Tab {
    return tab ?? 'model';
  }

  let current = $state<Tab>(initialTab());

  const cfg = $derived(config.current);
  const prefs = $derived(chat.prefs);
  const provider = $derived(providerFor(cfg.chatProvider));
  const isLocal = $derived(chat.isLocal(provider.id));

  let keyDrafts = $state<Partial<Record<KeyId, string>>>({});
  let pullName = $state('');
  let factDraft = $state('');
  let confirming = $state<string | null>(null);

  /** Anything destructive takes a second click within three seconds. */
  function confirmThen(id: string, action: () => void): void {
    if (confirming === id) {
      confirming = null;
      action();
      return;
    }
    confirming = id;
    setTimeout(() => {
      if (confirming === id) confirming = null;
    }, 3000);
  }

  function status(id: ProviderId): { text: string; ok: boolean } {
    if (id === 'ollama') {
      if (local.state === 'ready') return { text: `Running${local.version ? ` v${local.version}` : ''} · ${local.models.length} models`, ok: local.models.length > 0 };
      if (local.state === 'refused') return { text: 'Running, but refusing this widget', ok: false };
      if (local.state === 'offline') return { text: 'Not running', ok: false };
      return { text: 'Checking…', ok: false };
    }
    if (id === 'lmstudio' || id === 'custom') {
      const server = local.servers[id];
      if (id === 'custom' && !prefs.customUrl.trim()) return { text: 'No address set', ok: false };
      if (server.state === 'ready') return { text: `Reachable · ${server.models.length} models`, ok: true };
      if (server.state === 'refused') return { text: 'Running, but refusing this widget (enable CORS)', ok: false };
      if (server.state === 'offline') return { text: 'Not reachable', ok: false };
      return { text: 'Checking…', ok: false };
    }
    return chat.keyFor(id) ? { text: 'Key saved', ok: true } : { text: 'Needs an API key', ok: false };
  }

  function modelsFor(id: ProviderId): string[] {
    if (id === 'ollama') return local.names;
    if (id === 'lmstudio' || id === 'custom') return local.servers[id].models;
    return [...providerFor(id).models];
  }

  function setProvider(value: string): void {
    if (!isProviderId(value) || value === cfg.chatProvider) return;
    config.set('chatProvider', value);
    // A model id from one service means nothing to another.
    config.set('chatModel', '');
  }

  function saveKey(id: KeyId): void {
    const value = keyDrafts[id]?.trim();
    if (!value) return;
    chat.setKey(id, value);
    keyDrafts = { ...keyDrafts, [id]: '' };
  }

  const KEYED = PROVIDERS.filter((p) => !p.keyless);

  const CONTEXTS = [4096, 8192, 16384, 32768, 65536, 131072];
  const KEEP_ALIVE = [
    { value: '0', label: 'Unload after each reply' },
    { value: '5m', label: '5 minutes' },
    { value: '30m', label: '30 minutes' },
    { value: '2h', label: '2 hours' },
    { value: '24h', label: 'A day' },
    { value: '-1', label: 'Always' },
  ];
  const TEMPERATURES = [
    { value: '', label: 'Model default' },
    { value: '0.2', label: 'Precise (0.2)' },
    { value: '0.7', label: 'Balanced (0.7)' },
    { value: '1.1', label: 'Creative (1.1)' },
  ];
  const MAX_TOKENS = [1024, 2048, 4096, 8192, 16384, 32768];

  const PERSONAS = [
    { label: 'Concise', text: 'Be concise and direct. Use Markdown only where it helps.' },
    { label: 'Friendly', text: 'Be warm and friendly, but get to the point. Use plain, everyday language.' },
    { label: 'Expert', text: 'Answer like a senior engineer: precise and technical, with the reasoning that matters and no filler.' },
    { label: 'Teacher', text: 'Explain things step by step with short examples, and check the explanation makes sense.' },
  ];

  const AUTONOMY: readonly { value: Autonomy; label: string; description: string }[] = [
    { value: 'ask-all', label: 'Ask first', description: 'Every action waits for Allow. Looking things up never does.' },
    { value: 'ask-risky', label: 'Ask if risky', description: 'Acts on its own, and asks before anything that cannot be undone.' },
    { value: 'auto', label: 'Never ask', description: 'Does everything itself. Still asks before a dangerous action once a web page has been read in that turn.' },
  ];

  const toolsByGroup = $derived(
    chat.allTools().reduce<Record<string, string[]>>((acc, t) => {
      (acc[t.group] ??= []).push(t.name);
      return acc;
    }, {}),
  );

  function kb(tokens: number): string {
    return tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);
  }

  function openPanelSettings(): void {
    overlay.openDialog(ModuleSettings, { kind: 'chat' as const, onclose: () => overlay.closeDialog() });
  }

  const pendingReminders = $derived(chat.file.reminders.filter((r) => !r.fired).sort((a, b) => a.dueAt - b.dueAt));

  // --- voice ---------------------------------------------------------------

  const vp = $derived(prefs.voice);
  const listenerId = $derived(voice.listener());
  const speakerId = $derived(voice.speaker());
  const audioModels = $derived(local.models.filter((m) => local.supports(m.name, 'audio')).map((m) => m.name));
  const serverLanguages = $derived([...new Set(voice.ttsServer.voices.map(voiceLanguage).filter((l): l is string => !!l))]);
  let heardInTest = $state('');

  $effect(() => {
    if (current === 'voice') untrack(() => void voice.refreshServers());
  });

  const SAMPLES: Record<string, string> = {
    en: 'Hi, I’m the assistant on your desktop. This is how I sound.',
    de: 'Hallo, ich bin der Assistent auf deinem Desktop. So klinge ich.',
  };

  function sendOptions(): SendOptions {
    return {
      provider: cfg.chatProvider,
      model: cfg.chatModel,
      system: cfg.chatSystemPrompt,
      stream: cfg.chatStream,
      routing: cfg.chatRouting,
      tools: cfg.chatTools,
      context: cfg.chatContext,
    };
  }

  /** Why a cloud engine cannot be picked, or null. */
  function engineBlock(engine: { local: boolean; key?: KeyId }): string | null {
    if (!engine.local && prefs.privacy === 'local-only') return 'off: local models only';
    if (engine.key && !chat.keyFor(engine.key)) return 'needs a key';
    return null;
  }

  function listenerText(): { text: string; ok: boolean } {
    if (!listenerId) {
      return {
        text:
          prefs.privacy === 'local-only'
            ? 'Nothing local can listen. Pull an Ollama model that lists “audio”, such as gemma4, or set up a speech server below.'
            : 'Nothing can listen yet: an Ollama model that can hear, a speech server, or a Groq, OpenAI or Gemini key.',
        ok: false,
      };
    }
    const engine = sttEngine(listenerId);
    const chosen = vp.stt === listenerId ? vp.sttModel.trim() : '';
    if (listenerId === 'ollama') return { text: `${engine.label} · ${chosen || voice.context().ollamaAudioModel}`, ok: true };
    if (listenerId === 'server') return { text: `Speech server at ${vp.sttUrl}`, ok: true };
    return { text: `${engine.label} · ${chosen || engine.defaultModel} (cloud)`, ok: true };
  }

  function speakerText(): { text: string; ok: boolean } {
    if (speakerId === 'server') return { text: `Voice server · ${voice.ttsServer.voices.length} voices`, ok: true };
    if (speakerId === 'system') {
      const why = voice.startingServer
        ? ' - starting the voice server…'
        : ['auto', 'server'].includes(vp.tts) && vp.ttsUrl.trim()
          ? voice.ttsServer.state === 'refused'
            ? ' - the voice server is refusing this widget'
            : ' - the voice server is not running'
          : '';
      return { text: `Windows voices${why}`, ok: !why };
    }
    return { text: `${ttsEngine(speakerId).label} (cloud)`, ok: true };
  }

  function serverStatus(state: string, running: string): string {
    return state === 'ready' ? running : state === 'refused' ? 'Running, but refusing this widget (CORS)' : state === 'offline' ? 'Not running' : 'No address set';
  }

  function testMicrophone(): void {
    if (voice.mode === 'dictate') {
      voice.finishDictation();
      return;
    }
    heardInTest = '';
    void voice.start('dictate', sendOptions(), (text) => (heardInTest = text));
  }
</script>

<Modal title="Assistant settings" {onclose} width={580}>
  <div class="tabs" role="tablist">
    {#each TABS as t (t.id)}
      <button role="tab" aria-selected={current === t.id} class:active={current === t.id} onclick={() => (current = t.id)}>{t.label}</button>
    {/each}
  </div>

  {#if current === 'model'}
    <section>
      <h3>Who answers</h3>
      <div class="row">
        <div class="text">
          <span class="label">Service</span>
          <span class="description" class:ok={status(provider.id).ok}>{status(provider.id).text}</span>
        </div>
        <select aria-label="Service" value={cfg.chatProvider} onchange={(e) => setProvider(e.currentTarget.value)}>
          {#each PROVIDERS as p (p.id)}
            <option value={p.id}>{p.label}{p.local ? ' (local)' : ''}</option>
          {/each}
        </select>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Model</span>
          <span class="description">
            {#if isLocal}Automatic uses the first installed model that can use tools.{:else}Blank uses {provider.defaultModel || 'the service default'}.{/if}
          </span>
        </div>
        {#if isLocal}
          <select aria-label="Model" value={cfg.chatModel} onchange={(e) => config.set('chatModel', e.currentTarget.value)}>
            <option value="">Automatic{chat.localModel(provider.id) ? ` (${chat.localModel(provider.id)})` : ''}</option>
            {#each modelsFor(provider.id) as model (model)}
              <option value={model}>{model}</option>
            {/each}
            {#if cfg.chatModel && !modelsFor(provider.id).includes(cfg.chatModel)}
              <option value={cfg.chatModel}>{cfg.chatModel} (not installed)</option>
            {/if}
          </select>
        {:else}
          <input
            class="wide"
            list="assistant-models"
            aria-label="Model"
            placeholder={provider.defaultModel}
            value={cfg.chatModel}
            onchange={(e) => config.set('chatModel', e.currentTarget.value.trim())}
          />
          <datalist id="assistant-models">
            {#each modelsFor(provider.id) as model (model)}<option value={model}></option>{/each}
          </datalist>
        {/if}
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Choose the model per question</span>
          <span class="description">Questions about this PC and small talk go to a local model, harder ones to the strongest service, and it moves on when one is down.</span>
        </div>
        <input type="checkbox" class="switch" role="switch" aria-label="Choose the model per question" checked={cfg.chatRouting} onchange={(e) => config.set('chatRouting', e.currentTarget.checked)} />
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Local models only</span>
          <span class="description">Nothing you say, and nothing about this PC, is ever sent to a cloud service.</span>
        </div>
        <input type="checkbox" class="switch" role="switch" aria-label="Local models only" checked={prefs.privacy === 'local-only'} onchange={(e) => chat.setPrefs({ privacy: e.currentTarget.checked ? 'local-only' : 'normal' })} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Stream replies</span><span class="description">Show the answer, the reasoning and each step as they happen.</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Stream replies" checked={cfg.chatStream} onchange={(e) => config.set('chatStream', e.currentTarget.checked)} />
      </div>
    </section>

    <section>
      <h3>API keys <span class="note">kept in the widget’s data folder, never in synced settings</span></h3>
      {#each KEYED as p (p.id)}
        {@const saved = !!chat.keyFor(p.id)}
        <div class="row">
          <div class="text">
            <span class="label">{p.label}{p.keyOptional ? ' (optional)' : ''}</span>
            {#if p.keyHint}<span class="description">{p.keyHint}</span>{/if}
          </div>
          <input
            type="password"
            class="key"
            autocomplete="off"
            spellcheck="false"
            aria-label="{p.label} API key"
            placeholder={saved ? '•••••••• saved' : 'Paste a key'}
            value={keyDrafts[p.id] ?? ''}
            oninput={(e) => (keyDrafts = { ...keyDrafts, [p.id]: e.currentTarget.value })}
            onkeydown={(e) => e.key === 'Enter' && saveKey(p.id)}
          />
          <button class="small" disabled={!keyDrafts[p.id]?.trim()} onclick={() => saveKey(p.id)}>Save</button>
          <button class="small" disabled={!saved} onclick={() => confirmThen(`key-${p.id}`, () => chat.setKey(p.id, ''))}>
            {confirming === `key-${p.id}` ? 'Sure?' : 'Clear'}
          </button>
        </div>
      {/each}
    </section>
  {:else if current === 'local'}
    <section>
      <h3>Ollama</h3>
      <div class="row">
        <div class="text">
          <span class="label">Address</span>
          <span class="description" class:ok={local.state === 'ready'}>{status('ollama').text}</span>
        </div>
        <input class="wide" aria-label="Ollama address" value={prefs.ollamaHost} onchange={(e) => chat.setPrefs({ ollamaHost: e.currentTarget.value })} />
        <button class="small" onclick={() => void local.refresh()}>Refresh</button>
      </div>
      {#if local.state === 'refused'}
        <div class="callout">
          <p>Ollama answers only pages it knows, and this widget is served from <code>{location.origin}</code>. Allowing it adds that address to <code>OLLAMA_ORIGINS</code> for your Windows user and restarts Ollama.</p>
          <button class="primary" disabled={local.fixing} onclick={() => void local.allowThisWidget()}>{local.fixing ? 'Restarting Ollama…' : 'Allow this widget'}</button>
        </div>
      {:else if local.state === 'offline'}
        <div class="callout">
          <p>Nothing answers at this address. Install Ollama from ollama.com, or start it.</p>
          <button class="primary" disabled={local.fixing} onclick={() => void local.startOllama()}>{local.fixing ? 'Starting…' : 'Start Ollama'}</button>
        </div>
      {/if}

      {#each local.models as model (model.name)}
        {@const info = local.info[model.name]}
        {@const loaded = local.running.find((r) => r.name === model.name)}
        <div class="row model-row">
          <div class="text">
            <span class="label">
              {model.name}
              {#if cfg.chatProvider === 'ollama' && (cfg.chatModel || chat.localModel('ollama')) === model.name}<span class="pill on">in use</span>{/if}
            </span>
            <span class="description">
              {[model.parameters, model.quantization, formatBytes(model.size)].filter(Boolean).join(' · ')}
              {#if info?.contextLength} · up to {kb(info.contextLength)} context{/if}
            </span>
            <span class="pills">
              {#each info?.capabilities.filter((c) => c !== 'completion') ?? [] as capability (capability)}<span class="pill">{capability}</span>{/each}
              {#if loaded}<span class="pill on">loaded · {formatBytes(loaded.sizeVram)} VRAM</span>{/if}
            </span>
          </div>
          <button class="small" onclick={() => { config.set('chatProvider', 'ollama'); config.set('chatModel', model.name); }}>Use</button>
          {#if loaded}
            <button class="small" onclick={() => void local.unload(model.name)}>Unload</button>
          {:else}
            <button class="small" onclick={() => void local.load(model.name, prefs.keepAlive, prefs.numCtx)}>Load</button>
          {/if}
          <button class="small danger" onclick={() => confirmThen(`del-${model.name}`, () => void local.remove(model.name))}>
            {confirming === `del-${model.name}` ? 'Sure?' : 'Delete'}
          </button>
        </div>
      {/each}

      <div class="row">
        <div class="text">
          <span class="label">Download a model</span>
          <span class="description">Any name from ollama.com/library, e.g. <code>qwen3:8b</code> or <code>llama3.2:3b</code>. Pick one that lists “tools” to use it as an agent.</span>
        </div>
        <input class="wide" aria-label="Model to download" placeholder="name:tag" bind:value={pullName} onkeydown={(e) => e.key === 'Enter' && pullName.trim() && void local.pull(pullName)} />
        <button class="small" disabled={!pullName.trim() || local.state !== 'ready'} onclick={() => void local.pull(pullName)}>Pull</button>
      </div>
      {#each Object.entries(local.pulls) as [name, pull] (name)}
        <div class="pull">
          <div class="pull-line">
            <span>{name} — {pull.error ?? pull.status}{pull.total ? ` · ${formatBytes(pull.completed)} of ${formatBytes(pull.total)}` : ''}</span>
            {#if pull.done}
              <button class="small" onclick={() => local.clearPull(name)}>OK</button>
            {:else}
              <button class="small" onclick={() => local.cancelPull(name)}>Cancel</button>
            {/if}
          </div>
          <div class="bar"><span style:width="{pull.total ? (pull.completed / pull.total) * 100 : pull.done ? 100 : 0}%"></span></div>
        </div>
      {/each}
    </section>

    <section>
      <h3>How local models run</h3>
      <div class="row">
        <div class="text">
          <span class="label">Context length</span>
          <span class="description">How much conversation and tool output the model can see. Ollama’s own default is too small for an agent; more uses more VRAM.</span>
        </div>
        <select aria-label="Context length" value={String(prefs.numCtx)} onchange={(e) => chat.setPrefs({ numCtx: Number(e.currentTarget.value) })}>
          {#each CONTEXTS as size (size)}<option value={String(size)}>{kb(size)} tokens</option>{/each}
        </select>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Keep the model loaded</span>
          <span class="description">Loading takes seconds; a loaded model answers at once. It also starts loading when you click into the message box.</span>
        </div>
        <select aria-label="Keep the model loaded" value={prefs.keepAlive} onchange={(e) => chat.setPrefs({ keepAlive: e.currentTarget.value })}>
          {#each KEEP_ALIVE as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
        </select>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Reasoning</span>
          <span class="description">For models that can think before answering. Slower, and better at multi-step tasks.</span>
        </div>
        <select aria-label="Reasoning" value={prefs.think} onchange={(e) => chat.setPrefs({ think: e.currentTarget.value as ThinkMode })}>
          <option value="auto">Model default</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
      <div class="row">
        <div class="text"><span class="label">Temperature</span><span class="description">Applies to every service.</span></div>
        <select aria-label="Temperature" value={prefs.temperature === null ? '' : String(prefs.temperature)} onchange={(e) => chat.setPrefs({ temperature: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}>
          {#each TEMPERATURES as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
          {#if prefs.temperature !== null && !TEMPERATURES.some((t) => t.value === String(prefs.temperature))}<option value={String(prefs.temperature)}>{prefs.temperature}</option>{/if}
        </select>
      </div>
      <div class="row">
        <div class="text"><span class="label">Longest reply</span><span class="description">Tokens per model call.</span></div>
        <select aria-label="Longest reply" value={String(prefs.maxTokens)} onchange={(e) => chat.setPrefs({ maxTokens: Number(e.currentTarget.value) })}>
          {#each MAX_TOKENS as size (size)}<option value={String(size)}>{kb(size)} tokens</option>{/each}
        </select>
      </div>
    </section>

    <section>
      <h3>Other local servers</h3>
      <div class="row">
        <div class="text">
          <span class="label">LM Studio</span>
          <span class="description" class:ok={local.servers.lmstudio.state === 'ready'}>{status('lmstudio').text}. Start the server in LM Studio’s Developer tab with CORS on.</span>
        </div>
        <input class="wide" aria-label="LM Studio address" value={prefs.lmstudioUrl} onchange={(e) => chat.setPrefs({ lmstudioUrl: e.currentTarget.value })} />
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Custom endpoint</span>
          <span class="description" class:ok={local.servers.custom.state === 'ready'}>{status('custom').text}. Any OpenAI-compatible <code>/v1</code> address: llama.cpp, vLLM, Jan, LocalAI.</span>
        </div>
        <input class="wide" aria-label="Custom endpoint address" placeholder="http://127.0.0.1:8080/v1" value={prefs.customUrl} onchange={(e) => chat.setPrefs({ customUrl: e.currentTarget.value })} />
      </div>
      <div class="buttons"><button onclick={() => void chat.refreshServers()}>Check again</button></div>
    </section>
  {:else if current === 'agent'}
    <section>
      <h3>How much it does on its own</h3>
      <div class="segmented wide-seg" role="radiogroup" aria-label="Autonomy">
        {#each AUTONOMY as option (option.value)}
          <button role="radio" aria-checked={prefs.autonomy === option.value} class:active={prefs.autonomy === option.value} onclick={() => chat.setPrefs({ autonomy: option.value })}>{option.label}</button>
        {/each}
      </div>
      <p class="description block">{AUTONOMY.find((a) => a.value === prefs.autonomy)?.description}</p>
      <div class="row">
        <div class="text"><span class="label">Use tools</span><span class="description">Off makes it a plain chat.</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Use tools" checked={cfg.chatTools} onchange={(e) => config.set('chatTools', e.currentTarget.checked)} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Steps per message</span><span class="description">Model calls one request may take before it must answer.</span></div>
        <div class="range">
          <input type="range" min="1" max="40" step="1" aria-label="Steps per message" value={prefs.maxSteps} oninput={(e) => chat.setPrefs({ maxSteps: e.currentTarget.valueAsNumber })} />
          <span class="value">{prefs.maxSteps}</span>
        </div>
      </div>
      <div class="row">
        <div class="text"><span class="label">Conversation memory</span><span class="description">Past messages sent with each question.</span></div>
        <div class="range">
          <input type="range" min="4" max="120" step="2" aria-label="Conversation memory" value={prefs.historyTurns} oninput={(e) => chat.setPrefs({ historyTurns: e.currentTarget.valueAsNumber })} />
          <span class="value">{prefs.historyTurns}</span>
        </div>
      </div>
      <div class="row">
        <div class="text"><span class="label">Send a status summary</span><span class="description">Time, load, battery, focused app and open windows with every question, so simple ones need no tool.</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Send a status summary" checked={cfg.chatContext} onchange={(e) => config.set('chatContext', e.currentTarget.checked)} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Show reasoning</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Show reasoning" checked={prefs.showThinking} onchange={(e) => chat.setPrefs({ showThinking: e.currentTarget.checked })} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Show each step</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Show each step" checked={prefs.showSteps} onchange={(e) => chat.setPrefs({ showSteps: e.currentTarget.checked })} />
      </div>
    </section>

    <section>
      <h3>Personality</h3>
      <div class="presets">
        {#each PERSONAS as persona (persona.label)}
          <button class:active={cfg.chatSystemPrompt === persona.text} onclick={() => config.set('chatSystemPrompt', persona.text)}>{persona.label}</button>
        {/each}
      </div>
      <!-- Committed on change: a write per keystroke would rewrite the settings file mid-sentence. -->
      <textarea rows="3" aria-label="Instructions" value={cfg.chatSystemPrompt} onchange={(e) => config.set('chatSystemPrompt', e.currentTarget.value)}></textarea>
      <p class="description block">Your own instructions, added to the rules it works by.</p>
    </section>

    <section>
      <h3>Reminders</h3>
      {#each pendingReminders as reminder (reminder.id)}
        <div class="row">
          <div class="text"><span class="label">{reminder.text}</span><span class="description">{new Date(reminder.dueAt).toLocaleString()}</span></div>
          <button class="small" onclick={() => chat.cancelReminder(reminder.id)}>Cancel</button>
        </div>
      {:else}
        <p class="description block">None pending. Ask it to remind you of something.</p>
      {/each}
    </section>
  {:else if current === 'voice'}
    <section>
      <h3>Listening <span class="note">speech to text</span></h3>
      <div class="row">
        <div class="text">
          <span class="label">Listens with</span>
          <span class="description" class:ok={listenerText().ok}>{listenerText().text}</span>
        </div>
        <select aria-label="Speech to text engine" value={vp.stt} onchange={(e) => voice.setPrefs({ stt: e.currentTarget.value as SttEngineId | 'auto', sttModel: '' })}>
          <option value="auto">Automatic</option>
          {#each STT_ENGINES as engine (engine.id)}
            {@const blocked = engineBlock(engine)}
            <option value={engine.id} disabled={!!blocked}>{engine.label}{blocked ? ` (${blocked})` : ''}</option>
          {/each}
        </select>
      </div>
      {#if vp.stt !== 'auto'}
        <div class="row">
          <div class="text">
            <span class="label">Model</span>
            <span class="description">{sttEngine(vp.stt).hint}</span>
          </div>
          {#if vp.stt === 'ollama'}
            <select aria-label="Speech to text model" value={vp.sttModel} onchange={(e) => voice.setPrefs({ sttModel: e.currentTarget.value })}>
              <option value="">Automatic{voice.context().ollamaAudioModel ? ` (${voice.context().ollamaAudioModel})` : ''}</option>
              {#each audioModels as model (model)}<option value={model}>{model}</option>{/each}
            </select>
          {:else}
            <input class="wide" list="voice-stt-models" aria-label="Speech to text model" placeholder={sttEngine(vp.stt).defaultModel} value={vp.sttModel} onchange={(e) => voice.setPrefs({ sttModel: e.currentTarget.value.trim() })} />
            <datalist id="voice-stt-models">{#each sttEngine(vp.stt).models as model (model)}<option value={model}></option>{/each}</datalist>
          {/if}
        </div>
      {/if}
      <div class="row">
        <div class="text">
          <span class="label">Language you speak</span>
          <span class="description">Automatic works for a mix; naming it helps with short phrases.</span>
        </div>
        <select aria-label="Language you speak" value={vp.language} onchange={(e) => voice.setPrefs({ language: e.currentTarget.value })}>
          {#each LANGUAGES as language (language.code)}<option value={language.code}>{language.label}</option>{/each}
        </select>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Try the microphone</span>
          <span class="description">
            {#if voice.mode === 'dictate'}{voice.recording ? 'Hearing you…' : voice.transcribing ? 'Transcribing…' : 'Say something.'}
            {:else if voice.error}<span class="bad">{voice.error}</span>
            {:else if heardInTest}Heard: “{heardInTest}”
            {:else}Say a sentence and see what it heard.{/if}
          </span>
          {#if voice.mode === 'dictate'}<div class="bar meter"><span style:width="{Math.round(voice.level * 100)}%"></span></div>{/if}
        </div>
        <button class="small" disabled={voice.opening || voice.mode === 'talk'} onclick={testMicrophone}>{voice.mode === 'dictate' ? 'Stop' : 'Try it'}</button>
      </div>
    </section>

    <section>
      <h3>Speaking <span class="note">text to speech</span></h3>
      <div class="row">
        <div class="text">
          <span class="label">Speaks with</span>
          <span class="description" class:ok={speakerText().ok}>{speakerText().text}</span>
        </div>
        <select aria-label="Text to speech engine" value={vp.tts} onchange={(e) => voice.setPrefs({ tts: e.currentTarget.value as TtsEngineId | 'auto', ttsModel: '' })}>
          <option value="auto">Automatic</option>
          {#each TTS_ENGINES as engine (engine.id)}
            {@const blocked = engineBlock(engine)}
            <option value={engine.id} disabled={!!blocked}>{engine.label}{blocked ? ` (${blocked})` : ''}</option>
          {/each}
        </select>
      </div>

      {#if speakerId === 'server' || vp.tts === 'server' || vp.tts === 'auto'}
        <div class="row">
          <div class="text">
            <span class="label">Voice server</span>
            <span class="description" class:ok={voice.ttsServer.state === 'ready'}>
              {serverStatus(voice.ttsServer.state, `Running · ${voice.ttsServer.voices.length} voices`)}. Kokoro and its German voice, installed with <code>npm run voice:install</code>; any OpenAI-compatible <code>/audio/speech</code> works too.
            </span>
          </div>
          <input class="wide" aria-label="Voice server address" placeholder="http://127.0.0.1:8880/v1" value={vp.ttsUrl} onchange={(e) => voice.setPrefs({ ttsUrl: e.currentTarget.value.trim() })} />
          {#if voice.ttsServer.state === 'ready'}
            <button class="small" onclick={() => void voice.refreshServers()}>Refresh</button>
          {:else}
            <button class="small" disabled={voice.startingServer} onclick={() => void voice.startServer(true)}>{voice.startingServer ? 'Starting…' : 'Start'}</button>
          {/if}
        </div>
      {/if}

      {#if speakerId === 'server'}
        {#each serverLanguages as language (language)}
          <div class="row">
            <div class="text"><span class="label">{languageName(language) || language} voice</span></div>
            <select aria-label="{languageName(language)} voice" value={vp.voices[language] ?? ''} onchange={(e) => voice.setPrefs({ voices: { ...vp.voices, [language]: e.currentTarget.value } })}>
              <option value="">Automatic</option>
              {#each voice.ttsServer.voices.filter((v) => voiceLanguage(v) === language) as id (id)}<option value={id}>{voiceLabel(id)}</option>{/each}
            </select>
            <button class="small" disabled={!!voice.speaking} onclick={() => void voice.sample(SAMPLES[language] ?? SAMPLES.en ?? '')}>Play</button>
          </div>
        {/each}
      {:else if speakerId !== 'system'}
        {@const engine = ttsEngine(speakerId)}
        <div class="row">
          <div class="text"><span class="label">Voice</span><span class="description">It speaks the language of the reply.</span></div>
          <select aria-label="Voice" value={engine.voices?.includes(vp.voices[''] ?? '') ? vp.voices[''] : engine.defaultVoice} onchange={(e) => voice.setPrefs({ voices: { ...vp.voices, '': e.currentTarget.value } })}>
            {#each engine.voices ?? [] as id (id)}<option value={id}>{id}</option>{/each}
          </select>
          <button class="small" disabled={!!voice.speaking} onclick={() => void voice.sample(SAMPLES.en ?? '')}>Play</button>
        </div>
      {:else}
        <div class="row">
          <div class="text"><span class="label">Sample</span><span class="description">The voice Windows has for each language.</span></div>
          <button class="small" disabled={!!voice.speaking} onclick={() => void voice.sample(SAMPLES.en ?? '')}>English</button>
          <button class="small" disabled={!!voice.speaking} onclick={() => void voice.sample(SAMPLES.de ?? '')}>Deutsch</button>
        </div>
      {/if}

      <div class="row">
        <div class="text"><span class="label">Speed</span></div>
        <div class="range">
          <input type="range" min="0.7" max="1.5" step="0.05" aria-label="Speed" value={vp.speed} oninput={(e) => voice.setPrefs({ speed: e.currentTarget.valueAsNumber })} />
          <span class="value">{vp.speed.toFixed(2)}×</span>
        </div>
      </div>
    </section>

    <section>
      <h3>Conversation</h3>
      <div class="row">
        <div class="text">
          <span class="label">Pause that ends your turn</span>
          <span class="description">Longer lets you think mid-sentence; shorter answers sooner.</span>
        </div>
        <div class="range">
          <input type="range" min="400" max="2000" step="100" aria-label="Pause that ends your turn" value={vp.pauseMs} oninput={(e) => voice.setPrefs({ pauseMs: e.currentTarget.valueAsNumber })} />
          <span class="value">{(vp.pauseMs / 1000).toFixed(1)}s</span>
        </div>
      </div>
      <div class="row">
        <div class="text">
          <span class="label">Microphone sensitivity</span>
          <span class="description">Lower it if background noise sets it off; raise it for a quiet voice or a distant microphone.</span>
        </div>
        <div class="segmented" role="radiogroup" aria-label="Microphone sensitivity">
          {#each [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']] as [value, label] (value)}
            <button role="radio" aria-checked={vp.sensitivity === value} class:active={vp.sensitivity === value} onclick={() => voice.setPrefs({ sensitivity: value as Sensitivity })}>{label}</button>
          {/each}
        </div>
      </div>
      <div class="row">
        <div class="text"><span class="label">Talk over it to interrupt</span><span class="description">Not while a Windows voice speaks, which the microphone would hear as you.</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Talk over it to interrupt" checked={vp.bargeIn} onchange={(e) => voice.setPrefs({ bargeIn: e.currentTarget.checked })} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Read typed replies aloud</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Read typed replies aloud" checked={vp.readReplies} onchange={(e) => voice.setPrefs({ readReplies: e.currentTarget.checked })} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Send dictation right away</span><span class="description">Off puts it in the message box to check first.</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Send dictation right away" checked={vp.autoSend} onchange={(e) => voice.setPrefs({ autoSend: e.currentTarget.checked })} />
      </div>
      <div class="row">
        <div class="text"><span class="label">Sounds when it starts and stops listening</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Sounds when it starts and stops listening" checked={vp.cues} onchange={(e) => voice.setPrefs({ cues: e.currentTarget.checked })} />
      </div>
    </section>

    <section>
      <h3>Speech-to-text server <span class="note">optional</span></h3>
      <div class="row">
        <div class="text">
          <span class="label">Address</span>
          <span class="description" class:ok={voice.sttServer === 'ready'}>
            {vp.sttUrl.trim() ? serverStatus(voice.sttServer, 'Running') : 'None'}. For Whisper instead of the Ollama model: Speaches, whisper.cpp or LocalAI, at their <code>/v1</code> address.
          </span>
        </div>
        <input class="wide" aria-label="Speech-to-text server address" placeholder="http://127.0.0.1:8000/v1" value={vp.sttUrl} onchange={(e) => voice.setPrefs({ sttUrl: e.currentTarget.value.trim() })} />
      </div>
    </section>
  {:else if current === 'tools'}
    <section>
      <h3>What it may use</h3>
      {#each TOOL_GROUPS as group (group.id)}
        <div class="row">
          <div class="text">
            <span class="label">{group.label}</span>
            <span class="description">{group.description}</span>
            <span class="tool-names">{(toolsByGroup[group.id] ?? []).join(', ').replace(/_/g, ' ')}</span>
          </div>
          <input
            type="checkbox"
            class="switch"
            role="switch"
            aria-label={group.label}
            checked={prefs.toolGroups[group.id]}
            onchange={(e) => chat.setPrefs({ toolGroups: { ...prefs.toolGroups, [group.id]: e.currentTarget.checked } })}
          />
        </div>
      {/each}
    </section>

    <section>
      <h3>Always allowed</h3>
      {#if prefs.allowedTools.length}
        <div class="pills">
          {#each prefs.allowedTools as name (name)}
            <button class="pill removable" title="Ask again for this" onclick={() => chat.setPrefs({ allowedTools: prefs.allowedTools.filter((t) => t !== name) })}>{name.replace(/_/g, ' ')} ×</button>
          {/each}
        </div>
      {:else}
        <p class="description block">Nothing yet. Pick “Always” on an approval card to add a tool here.</p>
      {/if}
    </section>

    <section>
      <h3>Web</h3>
      <div class="row">
        <div class="text">
          <span class="label">Jina reader key (optional)</span>
          <span class="description">Search and page reading work without one; a free key from jina.ai raises the rate limit.</span>
        </div>
        <input type="password" class="key" autocomplete="off" aria-label="Jina key" placeholder={chat.keyFor('jina') ? '•••••••• saved' : 'Paste a key'} value={keyDrafts.jina ?? ''} oninput={(e) => (keyDrafts = { ...keyDrafts, jina: e.currentTarget.value })} />
        <button class="small" disabled={!keyDrafts.jina?.trim()} onclick={() => saveKey('jina')}>Save</button>
      </div>
    </section>
  {:else if current === 'memory'}
    <section>
      <h3>What it remembers about you</h3>
      <div class="row">
        <div class="text"><span class="label">Remember things across chats</span><span class="description">Facts are sent with every question, to whichever service answers.</span></div>
        <input type="checkbox" class="switch" role="switch" aria-label="Remember things across chats" checked={prefs.memoryEnabled} onchange={(e) => chat.setPrefs({ memoryEnabled: e.currentTarget.checked })} />
      </div>
      {#each chat.file.memory as fact (fact.id)}
        <div class="row">
          <div class="text"><span class="label fact">{fact.text}</span></div>
          <button class="small" onclick={() => chat.forget(fact.id)}>Forget</button>
        </div>
      {:else}
        <p class="description block">Nothing yet. Tell it “remember that…”, or add something here.</p>
      {/each}
      <div class="row">
        <input class="grow" aria-label="Add a fact" placeholder="e.g. I live in Berlin" bind:value={factDraft} onkeydown={(e) => { if (e.key === 'Enter' && factDraft.trim()) { chat.remember(factDraft); factDraft = ''; } }} />
        <button class="small" disabled={!factDraft.trim()} onclick={() => { chat.remember(factDraft); factDraft = ''; }}>Add</button>
      </div>
      {#if chat.file.memory.length}
        <div class="buttons"><button onclick={() => confirmThen('forget-all', () => chat.forgetAll())}>{confirming === 'forget-all' ? 'Click again to forget everything' : 'Forget everything'}</button></div>
      {/if}
    </section>

    <section>
      <h3>Chats</h3>
      <div class="row">
        <div class="text"><span class="label">{chat.conversations.length} saved {chat.conversations.length === 1 ? 'chat' : 'chats'}</span><span class="description">Stored in chat.json in the widget’s data folder.</span></div>
        <button class="small danger" disabled={!chat.conversations.length} onclick={() => confirmThen('chats', () => chat.removeAll())}>{confirming === 'chats' ? 'Sure?' : 'Delete all'}</button>
      </div>
    </section>
  {/if}

  <footer>
    <button class="link" onclick={openPanelSettings}>Panel size, position and look…</button>
  </footer>
</Modal>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    margin-bottom: 14px;
    border-radius: calc(9px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .tabs button,
  .segmented button,
  .presets button {
    flex: 1;
    padding: 5px 8px;
    font-size: calc(11px * var(--text-scale, 1));
    border-radius: calc(7px * var(--round, 1));
    color: var(--panel-fg-muted);
    cursor: pointer;
  }

  .tabs button.active,
  .segmented button.active,
  .presets button.active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 45%, transparent);
    color: var(--panel-fg);
  }

  .segmented,
  .presets {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: calc(9px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 14%, transparent);
  }

  .presets {
    margin-bottom: 6px;
  }

  section {
    margin-bottom: 18px;
  }

  h3 {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 6px;
    font-size: calc(10px * var(--text-scale, 1));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--panel-fg-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 0;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: calc(12px * var(--text-scale, 1));
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    overflow-wrap: anywhere;
  }

  .fact {
    user-select: text;
  }

  .description,
  .note {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }

  .description.ok {
    color: var(--color-green-700, #6c6);
  }

  .bad {
    color: var(--color-red-700, #f77);
  }

  .meter {
    margin-top: 4px;
    max-width: 180px;
  }

  .meter > span {
    transition: width 50ms linear;
  }

  .description.block {
    display: block;
    margin: 6px 0 0;
  }

  .tool-names {
    font-size: calc(10px * var(--text-scale, 1));
    color: color-mix(in oklab, var(--panel-fg-muted) 80%, transparent);
    overflow-wrap: anywhere;
  }

  code {
    font-family: var(--mono-font, 'Cascadia Code', Consolas, ui-monospace, monospace);
    font-size: 0.95em;
  }

  .switch {
    flex: none;
    appearance: none;
    width: 34px;
    height: 19px;
    border-radius: calc(999px * var(--round, 1));
    position: relative;
    cursor: pointer;
    background: color-mix(in oklab, var(--color-gray-300, #666) 35%, transparent);
    transition: background 0.15s ease;
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s ease;
  }

  .switch:checked {
    background: color-mix(in oklab, var(--color-blue-600, #37f) 85%, transparent);
  }

  .switch:checked::after {
    transform: translateX(15px);
  }

  input:not([type='checkbox']):not([type='range']),
  select,
  textarea {
    padding: 5px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  select {
    width: 170px;
    cursor: pointer;
  }

  .wide {
    width: 200px;
  }

  .key {
    width: 150px;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  textarea {
    width: 100%;
    resize: vertical;
    line-height: 1.45;
  }

  .range {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .range input {
    width: 140px;
    accent-color: var(--accent);
  }

  .value {
    width: 28px;
    font-size: calc(11px * var(--text-scale, 1));
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--panel-fg-muted);
  }

  .small,
  .buttons button,
  .link,
  .primary {
    flex: none;
    padding: 5px 10px;
    font-size: calc(11px * var(--text-scale, 1));
    border-radius: calc(7px * var(--round, 1));
    cursor: pointer;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .small:hover:not(:disabled),
  .buttons button:hover,
  .link:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 36%, transparent);
  }

  .small:disabled,
  .primary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .small.danger {
    color: var(--color-red-700, #f77);
  }

  .primary {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 45%, transparent);
  }

  .buttons {
    display: flex;
    gap: 6px;
    padding-top: 8px;
  }

  .callout {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 4px 0 8px;
    padding: 8px 10px;
    border-radius: calc(9px * var(--round, 1));
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1.4;
    background: color-mix(in oklab, var(--accent, #7aa2f7) 14%, transparent);
  }

  .callout p {
    flex: 1;
    margin: 0;
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .pill {
    padding: 1px 7px;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .pill.on {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--accent, #7aa2f7) 40%, transparent);
  }

  .pill.removable {
    cursor: pointer;
  }

  .pull {
    padding: 4px 0 8px;
  }

  .pull-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: calc(11px * var(--text-scale, 1));
    margin-bottom: 4px;
  }

  .bar {
    height: 4px;
    border-radius: calc(999px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }

  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent, #7aa2f7);
    transition: width 0.2s ease;
  }

  footer {
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }
</style>
