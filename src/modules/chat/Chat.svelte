<script lang="ts">
  import { untrack } from 'svelte';
  import { config } from '$lib/config.svelte';
  import { chat, type SendOptions } from '$lib/chat.svelte';
  import type { ChatMessage, Part } from '$lib/assistant-state';
  import { local } from '$lib/local.svelte';
  import { PROVIDERS, providerFor, type ProviderId } from '$lib/providers';
  import { menuSeparator, type MenuItem } from '$lib/menu';
  import { overlay } from '$lib/overlay.svelte';
  import { relativeTime } from '$lib/notifications.svelte';
  import Markdown from './Markdown.svelte';
  import AssistantSettings from './AssistantSettings.svelte';
  import { voice } from '$lib/voice.svelte';

  const cfg = $derived(config.current);
  const options: SendOptions = $derived({
    provider: cfg.chatProvider,
    model: cfg.chatModel,
    system: cfg.chatSystemPrompt,
    stream: cfg.chatStream,
    routing: cfg.chatRouting,
    tools: cfg.chatTools,
    context: cfg.chatContext,
  });
  const setup = $derived(chat.setup(options));
  const prefs = $derived(chat.prefs);
  const messages = $derived(chat.messages);
  const lastVia = $derived([...messages].reverse().find((m) => m.role === 'assistant' && m.via));
  const lastAssistant = $derived([...messages].reverse().find((m) => m.role === 'assistant' && !m.notice));
  const phaseLabel = $derived(
    voice.muted
      ? 'Muted'
      : { idle: '', listening: 'Listening', hearing: 'Hearing you', transcribing: 'Transcribing', thinking: chat.activity ?? 'Thinking', speaking: 'Speaking' }[voice.phase],
  );

  let view = $state<'chat' | 'history'>('chat');
  let draft = $state('');
  let keyDraft = $state('');
  let images = $state<string[]>([]);
  let filter = $state('');
  let listEl: HTMLDivElement | undefined = $state();
  let inputEl: HTMLTextAreaElement | undefined = $state();
  /** Follow the reply only while the user has not scrolled up to read. */
  let stick = true;

  // A local server can be started after the panel is, so ask again on mount.
  $effect(() =>
    untrack(() => {
      void local.refresh();
      void chat.refreshServers();
    }),
  );

  // Hiding the panel must not leave a microphone open behind it.
  $effect(() => () => untrack(() => voice.stop()));

  /**
   * Follows the reply as it streams. Reading the last part's text is what makes
   * this run per chunk rather than only when a message is added.
   */
  $effect(() => {
    const last = messages.at(-1);
    const part = last?.parts?.at(-1);
    void messages.length;
    void last?.text;
    void last?.parts?.length;
    void (part && part.kind !== 'tool' ? part.text : part?.status);
    void chat.activity;
    void chat.pending;
    void view;
    if (listEl && stick) listEl.scrollTop = listEl.scrollHeight;
  });

  function onScroll(): void {
    if (!listEl) return;
    stick = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
  }

  function openSettings(tab?: 'model' | 'local' | 'agent' | 'voice' | 'tools' | 'memory'): void {
    overlay.openDialog(AssistantSettings, { tab, onclose: () => overlay.closeDialog() });
  }

  function resize(): void {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 110)}px`;
  }

  function send(text = draft): void {
    const outgoing = $state.snapshot(images);
    if (!text.trim() && !outgoing.length) return;
    draft = '';
    images = [];
    queueMicrotask(resize);
    view = 'chat';
    stick = true;
    if (prefs.voice.readReplies && voice.mode === 'off') voice.readNextReply();
    void chat.send(text, options, outgoing);
  }

  /** The microphone in the message box: speech goes into the draft, or straight out. */
  function dictate(): void {
    if (voice.mode === 'dictate') {
      voice.finishDictation();
      return;
    }
    void voice.start('dictate', options, (text) => {
      const joined = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
      if (prefs.voice.autoSend && !chat.streaming) {
        send(joined);
        return;
      }
      draft = joined;
      queueMicrotask(resize);
    });
  }

  function talk(): void {
    view = 'chat';
    stick = true;
    void voice.start('talk', options);
  }

  /** Enter sends; Shift+Enter is a newline, as every other chat box works. */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!chat.streaming) send();
  }

  /**
   * Pasted screenshots and pictures, scaled down first: a 4K screenshot as a
   * data URL would bloat the stored conversation and a small model's context
   * far more than it helps.
   */
  async function onPaste(event: ClipboardEvent): Promise<void> {
    const files = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!files.length) return;
    event.preventDefault();
    for (const file of files.slice(0, 4)) {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        images = [...images, canvas.toDataURL('image/jpeg', 0.85)].slice(-4);
      } catch {
        /* not an image the webview can decode */
      }
    }
  }

  function saveKey(event: SubmitEvent, provider: ProviderId): void {
    event.preventDefault();
    if (!keyDraft.trim()) return;
    chat.setKey(provider, keyDraft);
    keyDraft = '';
  }

  function modelsFor(id: ProviderId): string[] {
    if (id === 'ollama') return local.names;
    if (id === 'lmstudio' || id === 'custom') return local.servers[id].models;
    return [...providerFor(id).models];
  }

  /** Every model that could answer right now, one click away. */
  function modelMenu(event: MouseEvent): void {
    const items: MenuItem[] = [];
    const effective = cfg.chatModel.trim() || chat.localModel(cfg.chatProvider) || providerFor(cfg.chatProvider).defaultModel;
    for (const provider of PROVIDERS) {
      if (!chat.usable(provider.id)) continue;
      if (prefs.privacy === 'local-only' && !chat.isLocal(provider.id)) continue;
      const models = modelsFor(provider.id).slice(0, 12);
      if (!models.length) continue;
      items.push({ label: provider.label, header: true });
      for (const model of models) {
        items.push({
          label: model,
          checked: cfg.chatProvider === provider.id && effective === model,
          hint: provider.id === 'ollama' && local.supports(model, 'tools') === false ? 'no tools' : undefined,
          action: () => {
            config.set('chatProvider', provider.id);
            config.set('chatModel', model);
          },
        });
      }
    }
    if (!items.length) items.push({ label: 'No model is available yet', disabled: true });
    items.push(
      menuSeparator,
      { label: 'Choose the model per question', checked: cfg.chatRouting, action: () => config.toggle('chatRouting') },
      { label: 'Local models only', checked: prefs.privacy === 'local-only', action: () => chat.setPrefs({ privacy: prefs.privacy === 'local-only' ? 'normal' : 'local-only' }) },
      menuSeparator,
      { label: 'Assistant settings...', action: () => openSettings('model') },
    );
    overlay.openMenu(event, items);
  }

  function stepGlyph(status: string): string {
    return status === 'done' ? '✓' : status === 'failed' ? '✕' : status === 'declined' ? '⊘' : '';
  }

  function detail(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    return text && text.length > 1500 ? `${text.slice(0, 1500)}…` : (text ?? '');
  }

  function seconds(ms: number | undefined): string {
    return ms ? `${Math.max(1, Math.round(ms / 1000))}s` : '';
  }

  async function copyMessage(message: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      /* see Markdown.svelte */
    }
  }

  const SUGGESTIONS_PC = ['How is my PC doing?', 'What’s playing, and turn it down a bit', 'Find my latest invoice in Downloads', 'Remind me in 20 minutes to stretch'];
  const SUGGESTIONS_PLAIN = ['Explain something simply', 'Help me write a message', 'Plan my afternoon', 'Brainstorm ideas'];
  const suggestions = $derived(cfg.chatTools ? SUGGESTIONS_PC : SUGGESTIONS_PLAIN);

  const history = $derived(
    chat.conversations.filter((c) => !filter.trim() || c.title.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  function isLastThinking(message: ChatMessage, part: Part): boolean {
    return chat.streaming && message === messages.at(-1) && message.parts?.at(-1) === part;
  }

  /** The setup card, as one line for above a conversation that already exists. */
  function setupLine(): string {
    switch (setup.kind) {
      case 'ollama-refused':
        return 'Ollama is refusing this widget.';
      case 'ollama-offline':
        return 'Ollama is not running.';
      case 'ollama-empty':
        return 'Ollama has no models yet.';
      case 'server-offline':
        return `${providerFor(setup.provider).label} is not reachable.`;
      case 'custom-missing':
        return 'The custom endpoint has no address.';
      case 'key':
        return `No ${providerFor(setup.provider).label} API key.`;
      case 'local-only':
        return 'No local model is running.';
      default:
        return '';
    }
  }
</script>

<div class="m-body chat" data-no-drag>
  {#if view === 'history'}
    <div class="history-head">
      <input type="search" bind:value={filter} placeholder="Search chats" aria-label="Search chats" />
      <button class="m-btn" onclick={() => (view = 'chat')}>Back</button>
    </div>
    <div class="log history">
      {#each history as conversation (conversation.id)}
        <div class="m-row m-click conv" class:m-active={conversation.id === chat.file.activeId}>
          <button
            class="conv-open"
            onclick={() => {
              chat.open(conversation.id);
              view = 'chat';
              stick = true;
            }}
          >
            <span class="m-title">{conversation.title}</span>
            <span class="m-sub">{relativeTime(conversation.updatedAt)} · {conversation.messages.length} messages</span>
          </button>
          <button class="m-quiet" title="Delete this chat" aria-label="Delete {conversation.title}" onclick={() => chat.remove(conversation.id)}>×</button>
        </div>
      {:else}
        <p class="m-empty">{filter ? 'No chat matches.' : 'No saved chats yet.'}</p>
      {/each}
    </div>
  {:else}
    <div class="log" bind:this={listEl} onscroll={onScroll}>
      {#if !messages.length}
        {#if setup.kind !== 'ready'}
          {@render setupCard()}
        {:else}
          <div class="welcome">
            <p class="m-empty">Ask anything, or tell it to do something on this PC.</p>
            <div class="chips">
              {#each suggestions as suggestion (suggestion)}
                <button class="chip" onclick={() => send(suggestion)}>{suggestion}</button>
              {/each}
            </div>
          </div>
        {/if}
      {/if}

      {#each messages as message (message.id)}
        {#if message.role === 'user'}
          <div class="turn user">
            {#if message.images?.length}
              <div class="thumbs">
                {#each message.images as src, i (i)}<img {src} alt="Attached" />{/each}
              </div>
            {/if}
            {#if message.text}{message.text}{/if}
          </div>
        {:else}
          <div class="turn assistant" class:failed={message.failed} class:notice={message.notice}>
            {#each message.parts ?? [] as part, i (i)}
              {#if part.kind === 'thinking'}
                {#if prefs.showThinking && part.text.trim()}
                  <details class="thinking">
                    <summary>{isLastThinking(message, part) ? 'Thinking…' : part.ms ? `Thought ${seconds(part.ms)}` : 'Working notes'}</summary>
                    <p>{part.text.trim()}</p>
                  </details>
                {/if}
              {:else if part.kind === 'tool'}
                {#if prefs.showSteps}
                  <details class="step {part.status}">
                    <summary>
                      {#if part.status === 'running'}<span class="spin"></span>{:else}<span class="glyph">{stepGlyph(part.status)}</span>{/if}
                      <span class="step-label">{part.label}</span>
                    </summary>
                    <pre>{detail(part.call.args)}{#if part.result !== undefined}{'\n→ '}{detail(part.result)}{/if}</pre>
                  </details>
                {/if}
              {:else if part.text}
                <Markdown source={part.text} />
              {/if}
            {/each}
            {#if message.via && !chat.streaming}
              <div class="meta">
                <span title={message.reason ?? ''}>{message.via}</span>
                {#if message.usage?.tokensPerSecond}<span>{message.usage.tokensPerSecond} tok/s</span>{/if}
                <button onclick={() => voice.speakMessage(message)} title="Read the reply aloud">{voice.readingId === message.id ? 'Stop' : 'Listen'}</button>
                <button onclick={() => copyMessage(message)} title="Copy the reply">Copy</button>
                {#if message === lastAssistant}
                  <button onclick={() => void chat.retry(options)} title="Ask again">Retry</button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}

      {#if chat.activity}
        <p class="activity">{chat.activity}<span class="caret"></span></p>
      {/if}
    </div>

    {#if chat.pending}
      {@const ask = chat.pending}
      <!-- Reading happens silently; anything the rules say to confirm stops here. -->
      <div class="ask" class:danger={ask.risk === 'danger'}>
        <div class="ask-text">
          <strong>{ask.label}?</strong>
          {#if ask.reason}<span class="ask-reason">{ask.reason}</span>{/if}
        </div>
        <div class="ask-actions">
          <button class="m-btn" onclick={() => chat.deny()}>Deny</button>
          <button class="m-btn" title="Allow {ask.tool} from now on" onclick={() => chat.approve(true)}>Always</button>
          <button class="m-btn m-primary" onclick={() => chat.approve()}>Allow</button>
        </div>
      </div>
    {/if}

    {#if chat.notice}
      <div class="banner">
        <span>⏰ {chat.notice}</span>
        <button class="link" onclick={() => (chat.notice = null)}>Dismiss</button>
      </div>
    {/if}

    {#if messages.length && setup.kind !== 'ready'}
      <div class="banner">
        <span>{setupLine()}</span>
        <button class="link" onclick={() => openSettings(setup.kind.startsWith('ollama') ? 'local' : 'model')}>Fix</button>
      </div>
    {/if}

    {#if chat.error}
      <div class="error">
        <span>{chat.error}</span>
        {#if lastAssistant || messages.length}<button class="link" onclick={() => void chat.retry(options)}>Retry</button>{/if}
      </div>
    {/if}

    {#if voice.error && voice.mode !== 'talk'}
      <div class="error">
        <span>{voice.error}</span>
        <button class="link" onclick={() => (voice.error = null)}>Dismiss</button>
      </div>
    {/if}

    {#if voice.mode === 'talk'}
      {@const busy = voice.phase === 'speaking' || voice.phase === 'thinking'}
      <div class="voicebar" class:muted={voice.muted} data-phase={voice.phase}>
        <button
          class="orb"
          style:--level={voice.level}
          title={busy ? 'Stop it and listen' : voice.muted ? 'Unmute the microphone' : 'Mute the microphone'}
          aria-label={busy ? 'Stop it and listen' : voice.muted ? 'Unmute the microphone' : 'Mute the microphone'}
          onclick={() => (busy ? voice.interrupt() : voice.toggleMute())}
        ></button>
        <div class="voice-text" aria-live="polite">
          <span class="phase">{phaseLabel}{voice.startingServer ? ' · starting the voice' : ''}</span>
          {#if voice.error}
            <span class="heard failed" title={voice.error}>{voice.error}</span>
          {:else if voice.heard}
            <span class="heard" title={voice.heard}>“{voice.heard}”</span>
          {/if}
        </div>
        <button
          class="icon"
          title={voice.muted ? 'Unmute the microphone' : 'Mute the microphone'}
          aria-label={voice.muted ? 'Unmute the microphone' : 'Mute the microphone'}
          aria-pressed={voice.muted}
          onclick={() => voice.toggleMute()}>{@render micIcon(voice.muted)}</button
        >
        <button class="m-btn" onclick={() => voice.stop()}>End</button>
      </div>
    {/if}

    <!-- Hidden while a decision is pending: nothing can be sent until it is
         answered, and at the default 150px the card and the composer together
         push the foot out of the panel. -->
    <form
      class="composer"
      hidden={!!chat.pending || voice.mode === 'talk'}
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {#if images.length}
        <div class="thumbs pending-images">
          {#each images as src, i (i)}
            <button type="button" title="Remove" onclick={() => (images = images.filter((_, j) => j !== i))}><img {src} alt="Attached" /></button>
          {/each}
        </div>
      {/if}
      <div class="composer-row">
        <textarea
          bind:this={inputEl}
          bind:value={draft}
          onkeydown={onKeydown}
          oninput={resize}
          onpaste={onPaste}
          onfocus={() => chat.warmUp(options)}
          placeholder={voice.mode === 'dictate' ? 'Listening…' : 'Ask, or tell it what to do…'}
          aria-label="Message"
          rows="1"
        ></textarea>
        <button
          type="button"
          class="mic"
          class:on={voice.mode === 'dictate'}
          style:--level={voice.mode === 'dictate' ? voice.level : 0}
          title={voice.mode === 'dictate' ? 'Stop dictating' : 'Dictate'}
          aria-label={voice.mode === 'dictate' ? 'Stop dictating' : 'Dictate'}
          aria-pressed={voice.mode === 'dictate'}
          disabled={voice.opening}
          onclick={dictate}>{@render micIcon(false)}</button
        >
        {#if chat.streaming}
          <button class="m-btn" type="button" onclick={() => chat.stop()}>Stop</button>
        {:else if !draft.trim() && !images.length}
          <!-- An empty box has nothing to send, so its button starts a spoken conversation instead. -->
          <button class="m-btn m-primary talk" type="button" title="Talk with the assistant" aria-label="Talk with the assistant" disabled={voice.opening} onclick={talk}>{@render waveIcon()}</button>
        {:else}
          <button class="m-btn m-primary" type="submit">Send</button>
        {/if}
      </div>
    </form>
  {/if}

  <div class="foot">
    <button class="model" title={lastVia?.reason ? `Last answer: ${lastVia.reason}` : 'Choose a model'} onclick={modelMenu}>
      {chat.modelLabel(options)} ▾
    </button>
    <div class="foot-actions">
      <button class="icon" title="Chats" aria-label="Chats" class:on={view === 'history'} onclick={() => (view = view === 'history' ? 'chat' : 'history')}>☰</button>
      <button class="icon" title="New chat" aria-label="New chat" onclick={() => { chat.newChat(); view = 'chat'; inputEl?.focus(); }}>+</button>
      <button class="icon" title="Assistant settings" aria-label="Assistant settings" onclick={() => openSettings()}>⚙</button>
    </div>
  </div>
</div>

{#snippet setupCard()}
  <div class="setup">
    {#if setup.kind === 'ollama-refused'}
      <p class="m-empty">Ollama is running, but refusing this widget.</p>
      <p class="hint">
        Ollama only answers pages it knows. This adds the widget to OLLAMA_ORIGINS for your Windows user and
        restarts Ollama.
      </p>
      <div class="setup-actions">
        <button class="m-btn m-primary" disabled={local.fixing} onclick={() => void local.allowThisWidget()}>
          {local.fixing ? 'Restarting Ollama…' : 'Allow this widget'}
        </button>
        <button class="m-btn" onclick={() => void local.refresh()}>Look again</button>
      </div>
    {:else if setup.kind === 'ollama-offline'}
      <p class="m-empty">Ollama is not running.</p>
      <div class="setup-actions">
        <button class="m-btn m-primary" disabled={local.fixing} onclick={() => void local.startOllama()}>
          {local.fixing ? 'Starting…' : 'Start Ollama'}
        </button>
        <button class="m-btn" onclick={() => void local.refresh()}>Look again</button>
        <button class="m-btn" onclick={() => openSettings('model')}>Other service</button>
      </div>
    {:else if setup.kind === 'ollama-empty'}
      <p class="m-empty">Ollama has no models yet.</p>
      <button class="m-btn m-primary" onclick={() => openSettings('local')}>Get a model…</button>
    {:else if setup.kind === 'server-offline'}
      <p class="m-empty">{providerFor(setup.provider).label} is not reachable.</p>
      <p class="hint">Start its local server, and allow CORS in its server settings.</p>
      <div class="setup-actions">
        <button class="m-btn" onclick={() => void chat.refreshServers()}>Look again</button>
        <button class="m-btn" onclick={() => openSettings('local')}>Settings</button>
      </div>
    {:else if setup.kind === 'custom-missing'}
      <p class="m-empty">Set the custom endpoint’s address first.</p>
      <button class="m-btn m-primary" onclick={() => openSettings('local')}>Settings</button>
    {:else if setup.kind === 'local-only'}
      <p class="m-empty">Privacy is set to local models only, and none is running.</p>
      <button class="m-btn m-primary" onclick={() => openSettings('model')}>Settings</button>
    {:else if setup.kind === 'key'}
      {@const provider = providerFor(setup.provider)}
      <!-- A secret, so it is kept beside the conversation rather than in the
           settings file the host syncs. -->
      <form class="setup" onsubmit={(e) => saveKey(e, provider.id)}>
        <p class="m-empty">Paste a {provider.label} API key to start.</p>
        <input type="password" bind:value={keyDraft} placeholder="API key" aria-label="{provider.label} API key" autocomplete="off" spellcheck="false" />
        <div class="setup-actions">
          <button class="m-btn m-primary" type="submit" disabled={!keyDraft.trim()}>Save key</button>
          <button class="m-btn" type="button" onclick={() => openSettings('model')}>Other service</button>
        </div>
        {#if provider.keyHint}<p class="hint">Keys are issued at {provider.keyHint}</p>{/if}
      </form>
    {/if}
  </div>
{/snippet}

{#snippet micIcon(off: boolean)}
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="5.5" y="1.75" width="5" height="8.5" rx="2.5" />
    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    {#if off}<path d="M2.5 2.5l11 11" />{/if}
  </svg>
{/snippet}

{#snippet waveIcon()}
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <path d="M2.5 6.5v3M5.25 4v8M8 2.5v11M10.75 4.5v7M13.5 6.5v3" />
  </svg>
{/snippet}

<style>
  /* Size containment, so the composer can be capped at a share of whatever
     height the panel has been given (see `.composer textarea`). */
  .chat {
    cursor: default;
    gap: 5px;
    container-type: size;
  }

  .log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 0 -6px;
    padding: 0 6px;
  }

  /*
   * A short conversation sits on the composer and grows upward. An auto margin
   * rather than `justify-content: flex-end`, which would put the oldest turns
   * above the top edge with no way to scroll back to them once it overflows.
   */
  .log > :first-child {
    margin-top: auto;
  }

  .history > :first-child {
    margin-top: 0;
  }

  .turn {
    font-size: calc(12px * var(--text-scale, 1));
    line-height: 1.5;
    overflow-wrap: anywhere;
    border-radius: calc(10px * var(--round, 1));
    max-width: 100%;
  }

  .turn.user {
    align-self: flex-end;
    max-width: 88%;
    padding: 5px 9px;
    white-space: pre-wrap;
    user-select: text;
    background: color-mix(in oklab, var(--accent, #7aa2f7) 30%, transparent);
  }

  .turn.assistant {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .turn.failed {
    color: var(--panel-fg-muted);
    font-style: italic;
  }

  .turn.notice {
    padding: 4px 8px;
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--accent, #7aa2f7) 14%, transparent);
  }

  .thumbs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-bottom: 3px;
  }

  .thumbs img {
    width: 52px;
    height: 52px;
    object-fit: cover;
    border-radius: calc(6px * var(--round, 1));
    display: block;
  }

  .thinking,
  .step {
    font-size: calc(10.5px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .thinking summary,
  .step summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .thinking summary::-webkit-details-marker,
  .step summary::-webkit-details-marker {
    display: none;
  }

  .thinking summary::before {
    content: '›';
    display: inline-block;
    transition: transform 0.12s ease;
  }

  .thinking[open] summary::before {
    transform: rotate(90deg);
  }

  .thinking p {
    margin: 3px 0 0;
    padding-left: 8px;
    border-left: 2px solid color-mix(in oklab, var(--color-gray-300, #666) 35%, transparent);
    white-space: pre-wrap;
    user-select: text;
    max-height: 140px;
    overflow-y: auto;
  }

  .step-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glyph {
    flex: none;
    width: 10px;
    text-align: center;
  }

  .step.done .glyph {
    color: var(--color-green-700, #6c6);
  }

  .step.failed .glyph,
  .step.declined .glyph {
    color: var(--color-red-700, #f77);
  }

  .step pre {
    margin: 3px 0 0;
    padding: 4px 6px;
    border-radius: calc(6px * var(--round, 1));
    font-size: calc(10px * var(--text-scale, 1));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 160px;
    overflow-y: auto;
    user-select: text;
    background: color-mix(in oklab, var(--color-gray-100, #222) 55%, transparent);
  }

  .spin {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--panel-fg-muted);
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .meta {
    display: flex;
    gap: 8px;
    font-size: calc(9.5px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    opacity: 0;
    transition: opacity 0.12s ease;
    min-width: 0;
  }

  .meta span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .turn.assistant:hover .meta,
  .turn.assistant:focus-within .meta {
    opacity: 1;
  }

  .meta button {
    flex: none;
    font-size: calc(9.5px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    cursor: pointer;
    padding: 0;
  }

  .meta button:hover {
    color: var(--panel-fg);
  }

  .activity {
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    align-self: flex-start;
  }

  .caret {
    display: inline-block;
    width: 5px;
    height: 10px;
    margin-left: 3px;
    border-radius: calc(2px * var(--round, 1));
    background: var(--panel-fg-muted);
    animation: blink 1s steps(2, start) infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .caret,
    .spin {
      animation: none;
    }
  }

  .welcome {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    padding: 3px 8px;
    border-radius: calc(999px * var(--round, 1));
    font-size: calc(10.5px * var(--text-scale, 1));
    cursor: pointer;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
  }

  .chip:hover {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 30%, transparent);
  }

  .ask {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px 8px;
    border-radius: calc(8px * var(--round, 1));
    background: color-mix(in oklab, var(--accent, #7aa2f7) 18%, transparent);
    border: 1px solid color-mix(in oklab, var(--accent, #7aa2f7) 40%, transparent);
  }

  .ask.danger {
    background: color-mix(in oklab, var(--color-red-700, #f77) 14%, transparent);
    border-color: color-mix(in oklab, var(--color-red-700, #f77) 45%, transparent);
  }

  .ask-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .ask-text strong {
    font-weight: 600;
  }

  .ask-reason {
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .ask-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }

  .banner,
  .error {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: calc(11px * var(--text-scale, 1));
  }

  .error {
    color: var(--color-red-700, #f77);
  }

  .composer {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .composer[hidden] {
    display: none;
  }

  .composer-row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }

  /* A fixed cap let a three-line message fill the whole default 150px panel,
     crushing the conversation and clipping the foot; a third of the panel
     leaves both in view at any size. */
  .composer textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    max-height: clamp(28px, 34cqh, 110px);
    line-height: 1.45;
  }

  .composer .m-btn {
    flex: none;
  }

  .pending-images button {
    padding: 0;
    cursor: pointer;
    border-radius: calc(6px * var(--round, 1));
    overflow: hidden;
  }

  .pending-images img {
    width: 36px;
    height: 36px;
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .model {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .model:hover,
  .icon:hover,
  .icon.on {
    color: var(--panel-fg);
  }

  .foot-actions {
    flex: none;
    display: flex;
    gap: 2px;
  }

  .icon {
    width: 20px;
    height: 18px;
    border-radius: calc(5px * var(--round, 1));
    font-size: calc(12px * var(--text-scale, 1));
    line-height: 1;
    color: var(--panel-fg-muted);
    cursor: pointer;
  }

  .icon:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .link {
    flex: none;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }

  .link:hover {
    color: var(--panel-fg);
  }

  .setup {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .setup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .hint {
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    overflow-wrap: anywhere;
  }

  .history-head {
    flex: none;
    display: flex;
    gap: 6px;
  }

  .history-head input {
    flex: 1;
    min-width: 0;
  }

  .conv {
    padding: 0 4px 0 0;
  }

  .conv-open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 4px 6px;
    text-align: left;
    cursor: pointer;
    font-size: calc(12px * var(--text-scale, 1));
  }

  .conv-open .m-title {
    max-width: 100%;
  }

  .mic,
  .talk,
  .voicebar .icon {
    display: grid;
    place-items: center;
  }

  .mic {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: calc(8px * var(--round, 1));
    cursor: pointer;
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 18%, transparent);
  }

  .mic:hover:not(:disabled) {
    color: var(--panel-fg);
  }

  /* Rings out with the voice it is hearing, so it is plain that it is listening. */
  .mic.on {
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-red-700, #f77) 38%, transparent);
    box-shadow: 0 0 0 calc(var(--level, 0) * 4px) color-mix(in oklab, var(--color-red-700, #f77) 30%, transparent);
    transition: box-shadow 60ms linear;
  }

  .voicebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px 5px 5px;
    border-radius: calc(12px * var(--round, 1));
    background: color-mix(in oklab, var(--accent, #7aa2f7) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--accent, #7aa2f7) 28%, transparent);
  }

  .orb {
    flex: none;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    cursor: pointer;
    background: radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--accent, #7aa2f7) 55%, white), var(--accent, #7aa2f7) 70%);
    transform: scale(calc(0.8 + var(--level, 0) * 0.4));
    box-shadow: 0 0 calc(3px + var(--level, 0) * 14px) color-mix(in oklab, var(--accent, #7aa2f7) 65%, transparent);
    transition:
      transform 70ms linear,
      box-shadow 70ms linear;
  }

  .voicebar[data-phase='thinking'] .orb,
  .voicebar[data-phase='transcribing'] .orb {
    animation: breathe 1.3s ease-in-out infinite;
  }

  .voicebar[data-phase='speaking'] .orb {
    background: radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--color-green-700, #6c6) 45%, white), var(--color-green-700, #6c6) 75%);
    box-shadow: 0 0 calc(3px + var(--level, 0) * 16px) color-mix(in oklab, var(--color-green-700, #6c6) 60%, transparent);
  }

  .voicebar.muted .orb {
    filter: grayscale(1);
    opacity: 0.55;
    transform: none;
  }

  @keyframes breathe {
    50% {
      transform: scale(0.9);
      opacity: 0.7;
    }
  }

  .voice-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }

  .phase {
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heard {
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .heard.failed {
    color: var(--color-red-700, #f77);
  }

  @media (prefers-reduced-motion: reduce) {
    .orb,
    .mic.on {
      animation: none !important;
      transition: none;
    }
  }
</style>
