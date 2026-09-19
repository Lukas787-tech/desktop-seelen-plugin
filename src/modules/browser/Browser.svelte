<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { addressLabel, nextMode, type PageMode } from '$lib/browser';
  import { browser } from '$lib/browser.svelte';
  import { SNAPSHOT_SANDBOX } from '$lib/snapshot';
  import Markdown from '../chat/Markdown.svelte';

  const cfg = $derived(config.current);

  $effect(() => browser.acquire());

  const entry = $derived(browser.current);
  const view = $derived(browser.view);
  const zoom = $derived(Math.min(1.5, Math.max(0.5, cfg.browserZoom / 100)));

  /** What the view button offers, by the mode it switches to. */
  const VIEW_LABEL: Record<PageMode, string> = {
    live: 'Show the live page',
    page: 'Show a copy of the page',
    reader: 'Read as text',
    window: 'Open in a window',
  };

  let field = $state<HTMLInputElement | null>(null);
  let editing = $state(false);
  let draft = $state('');

  /** At rest the bar names the site, or the search; editing it shows the whole address. */
  const label = $derived(!entry ? '' : entry.kind === 'search' ? entry.query : addressLabel(entry.url));

  $effect(() => {
    if (!editing) draft = label;
  });

  /** Set on focus: the click that focused the field would otherwise collapse the selection on mouse-up. */
  let selectOnClick = false;

  /*
   * Selected here and now, not a frame later: `select()` also focuses, so a
   * deferred one could pull the field back after Enter had already let it go.
   */
  function begin() {
    editing = true;
    selectOnClick = true;
    if (!field) return;
    // Straight into the field as well as `draft`, so the selection covers the
    // whole address rather than the label it replaces.
    if (entry?.kind === 'page') field.value = draft = entry.url;
    field.select();
  }

  function click() {
    if (!selectOnClick) return;
    selectOnClick = false;
    if (field && field.selectionStart === field.selectionEnd) field.select();
  }

  function go() {
    browser.go(draft);
    field?.blur();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    go();
  }

  /** Enter is taken here rather than left to the form's implicit submission, which not every key path triggers. */
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      go();
    } else if (event.key === 'Escape') {
      field?.blur();
    }
  }
</script>

<div class="m-body browser" class:blank={!entry} data-no-drag>
  <form class="bar" onsubmit={submit}>
    {#if entry && cfg.browserShowNav}
      <button type="button" class="nav" aria-label="Back" title="Back" disabled={!browser.canBack} onclick={() => browser.back()}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
      </button>
      <button
        type="button"
        class="nav"
        aria-label="Forward"
        title="Forward"
        disabled={!browser.canForward}
        onclick={() => browser.forward()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </button>
    {/if}

    <div class="pill" class:editing>
      <input
        bind:this={field}
        bind:value={draft}
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="Search or type an address"
        aria-label="Search or address"
        onfocus={begin}
        onclick={click}
        onblur={() => (editing = false)}
        onkeydown={keydown}
      />
      {#if entry && !editing}
        {#if entry.kind === 'page'}
          {@const next = nextMode(entry.url, entry.mode)}
          <button type="button" class="tool" aria-label={VIEW_LABEL[next]} title={VIEW_LABEL[next]} onclick={() => browser.toggleView()}>
            {#if next === 'reader'}
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" /></svg>
            {:else}
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5h9v9h-9zM3.5 6.5h9" /></svg>
            {/if}
          </button>
        {/if}
        <button type="button" class="tool" aria-label="Open in a window" title="Open in a window" onclick={() => void browser.openWindow()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 3h3.5v3.5M13 3 8 8M11.5 9.5V13H3V4.5h3.5" /></svg>
        </button>
      {/if}
      <span class="progress" class:on={view.status === 'loading'} aria-hidden="true"></span>
    </div>
  </form>

  {#if entry}
    <div class="view" style:--zoom={zoom}>
      {#if entry.kind === 'page' && entry.mode === 'live'}
        {#key entry.id}
          <!--
            Sandboxed without `allow-top-navigation` and `allow-popups`: a page
            that tries to break out of its frame would otherwise navigate the
            whole surface away, and a popup would be a bare window with nothing
            to close it by.
          -->
          <iframe
            src={entry.load}
            title={addressLabel(entry.url)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock allow-presentation"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
            referrerpolicy="strict-origin-when-cross-origin"
            onload={() => browser.frameLoaded()}
          ></iframe>
        {/key}
      {:else if entry.kind === 'page' && entry.mode === 'window'}
        <div class="note">
          <p class="host">{addressLabel(entry.url)}</p>
          <p class="m-sub">Needs a window of its own.</p>
          <div class="choices">
            <button class="m-btn m-primary" onclick={() => void browser.openWindow()}>Open</button>
            <button class="m-btn" onclick={() => browser.toggleView()}>Show a copy</button>
          </div>
        </div>
      {:else if view.status === 'page'}
        {#key view}
          <!-- A copy: the page as it rendered, with no scripts (see `snapshot.ts`). -->
          <iframe
            srcdoc={view.srcdoc}
            title={view.title}
            sandbox={SNAPSHOT_SANDBOX}
            referrerpolicy="no-referrer"
            onload={(event) => browser.copyLoaded(event.currentTarget as HTMLIFrameElement)}
          ></iframe>
        {/key}
      {:else if view.status === 'reader' && entry.kind === 'page'}
        <article class="reader" style:zoom>
          <h1>{view.title}</h1>
          <p class="m-sub source">{addressLabel(entry.url)}</p>
          <Markdown source={view.text} onlink={(href) => browser.open(href)} />
          {#if view.truncated}
            <button class="m-btn more" onclick={() => void browser.openWindow()}>Continue in a window</button>
          {/if}
        </article>
      {:else if view.status === 'error'}
        <div class="note">
          <p class="m-sub">{view.message}</p>
          <button class="m-btn" onclick={() => void browser.openWindow()}>Open in a window</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .browser {
    gap: calc(6px * var(--density));
  }

  /* Nothing open: the panel is the bar and nothing else. */
  .browser.blank {
    justify-content: center;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .nav,
  .tool {
    flex: none;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    cursor: pointer;
    background: transparent;
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease),
      opacity var(--dur-fast) var(--ease),
      scale var(--dur) var(--ease-spring);
  }

  .nav {
    width: 24px;
    height: 28px;
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
  }

  .nav:disabled {
    opacity: 0.28;
    cursor: default;
  }

  .nav:hover:not(:disabled),
  .tool:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .nav:active:not(:disabled),
  .tool:active {
    scale: 0.88;
    transition-duration: var(--dur-fast);
  }

  .pill {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 28px;
    margin-left: 2px;
    padding-right: 3px;
    display: flex;
    align-items: center;
    gap: 1px;
    border-radius: calc(999px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-100, #333) 45%, transparent);
    transition:
      background-color var(--dur-fast) var(--ease),
      box-shadow var(--dur) var(--ease);
  }

  .pill:focus-within {
    background: color-mix(in oklab, var(--color-gray-100, #333) 62%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--accent, #7aa2f7) 55%, transparent),
      0 0 0 4px color-mix(in oklab, var(--accent, #7aa2f7) 16%, transparent);
  }

  /* The pill draws the field; the input inside it is only the text. */
  .pill input,
  .pill input:focus {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 12px;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    text-align: center;
    text-overflow: ellipsis;
  }

  .pill.editing input {
    text-align: left;
  }

  .pill input::placeholder {
    color: var(--panel-fg-muted);
  }

  .tool {
    width: 22px;
    height: 22px;
    border-radius: calc(999px * var(--round, 1));
    color: var(--panel-fg-muted);
  }

  .tool:hover {
    color: var(--panel-fg);
  }

  .tool svg {
    width: 13px;
    height: 13px;
  }

  .progress {
    position: absolute;
    inset: auto 0 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent, #7aa2f7), transparent) no-repeat;
    background-size: 40% 100%;
    opacity: 0;
    transition: opacity var(--dur) var(--ease);
    pointer-events: none;
  }

  .progress.on {
    opacity: 1;
    animation: sweep 1.1s var(--ease) infinite;
  }

  @keyframes sweep {
    from {
      background-position: -70% 0;
    }
    to {
      background-position: 170% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress.on {
      animation: none;
      background-size: 100% 100%;
    }
  }

  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: calc(10px * var(--round, 1));
    overflow: hidden;
  }

  /* Drawn at 1/zoom and scaled back, so a page lays out as if the panel were wider. */
  iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100% / var(--zoom));
    height: calc(100% / var(--zoom));
    border: 0;
    transform: scale(var(--zoom));
    transform-origin: 0 0;
    background: #fff;
    animation: fade var(--dur-slow) var(--ease) both;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .reader {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px 4px 14px;
    font-size: calc(12.5px * var(--text-scale, 1));
    line-height: 1.55;
  }

  .reader h1 {
    margin: 0;
    font-size: calc(16px * var(--text-scale, 1));
    font-weight: 600;
    line-height: 1.3;
    user-select: text;
  }

  .source {
    margin: 2px 0 10px;
  }

  .more {
    margin-top: 12px;
  }

  .note {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px;
    text-align: center;
  }

  .note p {
    margin: 0;
    white-space: normal;
  }

  .host {
    font-size: calc(14px * var(--text-scale, 1));
    font-weight: 600;
  }

  .choices {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
</style>
