<script lang="ts">
  import { fileUrl } from '$lib/assets';
  import { config } from '$lib/config.svelte';
  import { icons } from '$lib/icons.svelte';
  import {
    formatDuration,
    media,
    nanosToSeconds,
    sessionLabel,
    subscribeWaveform,
  } from '$lib/media.svelte';
  import { Disposables } from '$lib/seelen';
  import type { AudioWaveform, MediaDeviceSession } from '@seelen-ui/lib/types';

  interface Props {
    /** True while windows hide this display; pauses the visualiser. */
    covered: boolean;
  }

  let { covered }: Props = $props();

  const cfg = $derived(config.current);

  $effect(() => media.acquire());

  let tab = $state<'now' | 'mixer'>('now');
  let canvas = $state<HTMLCanvasElement | null>(null);

  /** Hiding the mixer takes its tab with it, so fall back to now playing. */
  const view = $derived(cfg.mediaShowMixer ? tab : 'now');

  const player = $derived(media.activePlayer);
  const output = $derived(media.defaultOutput);
  const art = $derived(cfg.mediaShowArt ? fileUrl(player?.thumbnail) : null);

  /**
   * The artwork's own shape, read from the loaded image.
   *
   * CSS cannot ask an image for its aspect ratio, and the frame has to match
   * it exactly: a fixed square frame cropped anything that was not square, and
   * a frame that only constrains one axis overflows the panel on the other.
   */
  let artRatio = $state(1);

  function measureArt(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    artRatio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
  }

  // --- progress ------------------------------------------------------------
  // The host reports a position plus the moment it was measured. Interpolating
  // locally keeps the bar smooth without asking the host for more updates.
  let basePositionNs = $state(0);
  let baseAtMs = $state(0);
  let nowMs = $state(performance.now());

  $effect(() => {
    const timeline = player?.timeline;
    if (!timeline) return;
    basePositionNs = timeline.position;
    baseAtMs = performance.now();
  });

  $effect(() => {
    if (!player?.playing || covered) return;
    const timer = setInterval(() => {
      nowMs = performance.now();
    }, 500);
    return () => clearInterval(timer);
  });

  const durationSec = $derived(
    player ? nanosToSeconds(player.timeline.end - player.timeline.start) : 0,
  );

  const elapsedSec = $derived.by(() => {
    if (!player) return 0;
    const drift = player.playing ? Math.max(0, nowMs - baseAtMs) / 1000 : 0;
    const raw = nanosToSeconds(basePositionNs - player.timeline.start) + drift;
    return durationSec > 0 ? Math.min(raw, durationSec) : raw;
  });

  const progressPct = $derived(durationSec > 0 ? (elapsedSec / durationSec) * 100 : 0);
  const remainingSec = $derived(Math.max(0, durationSec - elapsedSec));

  // --- visualiser ----------------------------------------------------------
  // The host's waveform stream reports pure silence on some setups, so the
  // canvas only claims space once real signal has actually arrived.
  let hasSignal = $state(false);

  $effect(() => {
    if (view !== 'now' || covered || !canvas || !cfg.animations || !cfg.mediaShowVisualiser) return;

    const disposables = new Disposables();
    const el = canvas;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    /*
     * The backing store is sized when the element's size changes, not per
     * event. The old draw assigned `width` and `height` from `clientWidth` on
     * every waveform message: the read forced a layout and the write threw the
     * bitmap away and allocated a new one, several times a second, for as long
     * as anything played. It also ignored the display's scale, so the bars
     * were drawn at 1x and stretched on a 150% screen.
     */
    let width = 0;
    let height = 0;
    let colour = '#7aa2f7';
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = Math.max(1, Math.round(width * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The resolved `--accent`, so the bars follow the theme like the rest.
      colour = getComputedStyle(el).color || colour;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    /*
     * Drawn once per frame from the newest message. Messages can arrive faster
     * than the display refreshes, and every frame drawn in between was thrown
     * away unseen.
     */
    let latest: number[] | null = null;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const bins = latest;
      if (!bins || width <= 0 || height <= 0) return;
      ctx.clearRect(0, 0, width, height);

      const bars = Math.min(56, bins.length);
      const step = Math.floor(bins.length / bars);
      const gap = 2;
      const barWidth = Math.max(1, width / bars - gap);

      ctx.fillStyle = colour;
      ctx.beginPath();
      for (let i = 0; i < bars; i++) {
        const db = bins[i * step] ?? -120;
        // dBFS in [-120, 0] mapped to [0, 1], with the quiet tail trimmed.
        const level = Math.max(0, Math.min(1, (db + 70) / 70));
        const barHeight = Math.max(1, level * height);
        ctx.roundRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight, barWidth / 2);
      }
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    disposables.add(
      subscribeWaveform((wave: AudioWaveform) => {
        const bins = wave.frequencies;
        if (!bins.length) return;

        // Every bin at the noise floor means no audio reaches this device.
        // A loop rather than `Math.max(...bins)`, which spread 128 arguments
        // onto the stack for every message.
        let loudest = -Infinity;
        for (const bin of bins) if (bin > loudest) loudest = bin;
        if (loudest <= -119) {
          if (hasSignal) hasSignal = false;
          return;
        }
        if (!hasSignal) hasSignal = true;

        latest = bins;
        if (!frame) frame = requestAnimationFrame(draw);
      }),
    );

    return () => {
      disposables.dispose();
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      hasSignal = false;
    };
  });

  function adjust(session: MediaDeviceSession | null, event: WheelEvent) {
    if (!output) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.02 : -0.02;
    const current = session ? session.volume : output.volume;
    media.setVolume(output.id, current + delta, session?.id ?? null);
  }

  /** Mixer rows: system sounds first, then applications by name. */
  const rows = $derived(
    [...(output?.sessions ?? [])].sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      return sessionLabel(a).localeCompare(sessionLabel(b));
    }),
  );
</script>

<div class="media">
  {#if cfg.mediaShowMixer}
    <nav class="tabs" data-no-drag>
      <button class:active={view === 'now'} onclick={() => (tab = 'now')}>Now playing</button>
      <button class:active={view === 'mixer'} onclick={() => (tab = 'mixer')}>
        Mixer
        {#if rows.length}<span class="count">{rows.length}</span>{/if}
      </button>
    </nav>
  {/if}

  {#if view === 'now'}
    {#if player}
      <!-- The artwork doubles as the panel's colour source. -->
      {#if art}
        <div class="ambience" style:background-image="url({art})"></div>
      {/if}

      <!-- The artwork takes all the space the panel has spare, so the layout
           stays balanced whatever height the user drags the panel to. -->
      {#if cfg.mediaShowArt}
        <div class="stage">
          <div class="art" style:--art-ratio={artRatio}>
            {#if art}
              <img src={art} alt="" onload={measureArt} onerror={() => (artRatio = 1)} />
            {:else}
              <div class="art-placeholder">&#9834;</div>
            {/if}
            {#if player.playing}
              <span class="pulse" style:background={cfg.accentColor}></span>
            {/if}
          </div>
        </div>
      {/if}

      <div class="meta">
        <span class="title" title={player.title}>{player.title || 'Unknown title'}</span>
        <span class="author" title={player.author}>
          {player.author || 'Unknown artist'}<span class="source"> &middot; {player.owner.name}</span>
        </span>
      </div>

      {#if cfg.mediaShowVisualiser}
        <canvas bind:this={canvas} class="viz" class:live={hasSignal}></canvas>
      {/if}

      <div class="scrubber">
        <!-- Display only: the host exposes no seek command. -->
        <div class="progress" role="presentation">
          <div class="bar" style:width="{progressPct}%" style:background={cfg.accentColor}></div>
        </div>
        <div class="times">
          <span>{formatDuration(elapsedSec)}</span>
          <span>-{formatDuration(remainingSec)}</span>
        </div>
      </div>

      <div class="transport" data-no-drag>
        <button onclick={() => media.previous()} aria-label="Previous">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M19 7v10L10 12z" /></svg>
        </button>
        <button
          class="primary"
          onclick={() => media.togglePlayPause()}
          aria-label={player.playing ? 'Pause' : 'Play'}
          style:background={cfg.accentColor}
        >
          {#if player.playing}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13L19 12z" /></svg>
          {/if}
        </button>
        <button onclick={() => media.next()} aria-label="Next">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M5 7v10l9-5z" /></svg>
        </button>
      </div>
    {:else}
      <p class="empty">Nothing is playing.</p>
    {/if}
  {:else}
    <div class="mixer" data-no-drag>
      {#if output}
        <div class="row master">
          <button
            class="face"
            class:muted={output.muted}
            onclick={() => media.toggleMute(output.id)}
            aria-label={output.muted ? 'Unmute' : 'Mute'}
          >
            {output.muted ? '🔇' : '🔊'}
          </button>
          <div class="row-body">
            <span class="name" title={output.name}>{output.name}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={output.volume}
              oninput={(e) => media.setVolume(output.id, Number(e.currentTarget.value))}
              onwheel={(e) => adjust(null, e)}
              aria-label="Master volume"
            />
          </div>
          <span class="pct">{Math.round(output.volume * 100)}</span>
        </div>

        <!-- Keyed on instanceId: session.id repeats when one executable has
             two sessions, which collides as an each-key. Commands still take id. -->
        {#each rows as session (session.instanceId)}
          {@const label = sessionLabel(session)}
          {@const iconSrc = session.iconPath ? icons.resolve({ path: session.iconPath }) : null}
          <div class="row">
            <button
              class="face"
              class:muted={session.muted}
              onclick={() => media.toggleMute(output.id, session.id)}
              aria-label={session.muted ? `Unmute ${label}` : `Mute ${label}`}
              title={session.muted ? 'Unmute' : 'Mute'}
            >
              {#if iconSrc}
                <img src={iconSrc} alt="" />
              {:else if session.isSystem}
                <span class="glyph">🖥</span>
              {:else}
                <span class="initial">{label.slice(0, 1).toUpperCase()}</span>
              {/if}
            </button>
            <div class="row-body">
              <span class="name" title={label}>{label}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={session.volume}
                oninput={(e) =>
                  media.setVolume(output.id, Number(e.currentTarget.value), session.id)}
                onwheel={(e) => adjust(session, e)}
                aria-label={`Volume for ${label}`}
              />
            </div>
            <span class="pct">{Math.round(session.volume * 100)}</span>
          </div>
        {:else}
          <p class="empty small">No application is playing audio.</p>
        {/each}

        {#if media.outputs.length > 1}
          <label class="device">
            <span>Output device</span>
            <select value={output.id} onchange={(e) => media.setDefaultOutput(e.currentTarget.value)}>
              {#each media.outputs as device (device.id)}
                <option value={device.id}>{device.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      {:else}
        <p class="empty">No audio device.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .media {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  /* Artwork bloom across the whole panel, for colour without a hard edge. */
  .ambience {
    position: absolute;
    inset: -20px -16px -16px;
    background-size: cover;
    background-position: center;
    filter: blur(30px) saturate(150%);
    opacity: 0.28;
    z-index: 0;
    pointer-events: none;
    mask-image: radial-gradient(circle at 50% 35%, #000 0%, transparent 78%);
  }

  .media > *:not(.ambience) {
    position: relative;
    z-index: 1;
  }

  .tabs {
    display: flex;
    gap: 4px;
    flex: none;
  }

  .tabs button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 6px;
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 500;
    border-radius: calc(7px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg-muted);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }

  .tabs button:hover {
    color: var(--panel-fg);
  }

  .tabs button.active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
    color: var(--panel-fg);
  }

  .count {
    font-size: calc(9px * var(--text-scale, 1));
    padding: 0 5px;
    border-radius: calc(999px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-500, #888) 34%, transparent);
  }

  /* --- now playing ------------------------------------------------------ */

  /*
   * Absorbs the panel's spare height so nothing floats in a void.
   *
   * A size container, which is what lets the frame below be measured in `cq`
   * units: those are real lengths, where a percentage height inside a flex
   * column resolves to `auto` and let the artwork overflow the panel.
   */
  .stage {
    position: relative;
    flex: 1;
    min-height: 44px;
    container-type: size;
    overflow: hidden;
  }

  /*
   * The frame follows the artwork, not the other way round: cover art is not
   * always square (singles, podcasts, video sources), and a fixed square frame
   * cropped everything else. `--art-ratio` comes from the loaded image, so the
   * frame is exactly the picture's shape - whole picture, and the shadow and
   * the playing dot still sit on its edge. Constraining both axes is what keeps
   * a wide cover from overflowing the panel.
   */
  .art {
    position: absolute;
    inset: 0;
    /* Centres whatever size the two constraints below settle on. */
    margin: auto;
    /* The larger of the two axes decides: exactly "contain", but as the box's
       own size, so the shadow and the playing dot stay on the picture's edge. */
    width: min(100cqw, calc(100cqh * var(--art-ratio, 1)));
    aspect-ratio: var(--art-ratio, 1);
  }

  .art img,
  .art-placeholder {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: calc(12px * var(--round, 1));
    object-fit: contain;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.45);
  }

  .art-placeholder {
    display: grid;
    place-items: center;
    font-size: calc(28px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .pulse {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 9px;
    height: 9px;
    border-radius: calc(999px * var(--round, 1));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-gray-50, #16161e) 80%, transparent);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    min-width: 0;
    gap: 1px;
    flex: none;
  }

  .title,
  .author,
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: calc(14px * var(--text-scale, 1));
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .author {
    font-size: calc(11.5px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .source {
    opacity: 0.7;
  }

  /* Collapsed until the host actually delivers signal. `color` is only read
     back by the draw, to paint the bars in the resolved accent. */
  .viz {
    color: var(--accent, #7aa2f7);
    width: 100%;
    height: 0;
    flex: none;
    opacity: 0;
    transition: height 200ms ease, opacity 200ms ease;
  }

  .viz.live {
    height: 30px;
    opacity: 1;
  }

  .scrubber {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: none;
  }

  .progress {
    height: 4px;
    border-radius: calc(999px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 32%, transparent);
  }

  .bar {
    height: 100%;
    border-radius: calc(999px * var(--round, 1));
    transition: width 480ms linear;
  }

  .times {
    display: flex;
    justify-content: space-between;
    font-size: calc(10px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    flex: none;
  }

  .transport button {
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--panel-fg);
    cursor: pointer;
    border-radius: calc(999px * var(--round, 1));
    width: 28px;
    height: 28px;
    opacity: 0.85;
    transition:
      opacity var(--dur-fast) var(--ease),
      background-color var(--dur-fast) var(--ease),
      scale var(--dur-slow) var(--ease-spring);
  }

  .transport button:hover {
    opacity: 1;
    scale: 1.14;
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  /* Pressed in, then sprung back: play and skip should feel like buttons. */
  .transport button:active {
    scale: 0.84;
    transition-duration: var(--dur-fast);
  }

  .transport svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .transport .primary {
    width: 36px;
    height: 36px;
    color: #fff;
    box-shadow: 0 3px 12px rgb(0 0 0 / 0.35);
  }

  .transport .primary svg {
    width: 15px;
    height: 15px;
  }

  /* --- mixer ------------------------------------------------------------ */

  .mixer {
    display: flex;
    flex-direction: column;
    gap: 9px;
    overflow-y: auto;
    height: 100%;
    padding-right: 2px;
  }

  .row {
    display: grid;
    grid-template-columns: 26px 1fr 26px;
    align-items: center;
    gap: 9px;
  }

  .row.master {
    padding-bottom: 8px;
    margin-bottom: 1px;
    border-bottom: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .face {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    background: color-mix(in oklab, var(--color-gray-300, #666) 20%, transparent);
    border-radius: calc(7px * var(--round, 1));
    cursor: pointer;
    font-size: calc(12px * var(--text-scale, 1));
    transition: opacity 120ms ease;
  }

  .face img {
    width: 17px;
    height: 17px;
    object-fit: contain;
  }

  .face .initial {
    font-size: calc(11px * var(--text-scale, 1));
    font-weight: 600;
    color: var(--panel-fg-muted);
  }

  .face.muted {
    opacity: 0.35;
  }

  .row-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .name {
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .row.master .name {
    color: var(--panel-fg);
    font-weight: 500;
  }

  input[type='range'] {
    width: 100%;
    height: 4px;
    appearance: none;
    border-radius: calc(999px * var(--round, 1));
    cursor: pointer;
    background: color-mix(in oklab, var(--color-gray-300, #666) 32%, transparent);
  }

  input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 11px;
    height: 11px;
    border-radius: calc(999px * var(--round, 1));
    background: var(--accent, #7aa2f7);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    transition: transform 120ms ease;
  }

  input[type='range']:hover::-webkit-slider-thumb {
    transform: scale(1.2);
  }

  .pct {
    font-size: calc(10px * var(--text-scale, 1));
    text-align: right;
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .device {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 2px;
    font-size: calc(10px * var(--text-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--panel-fg-muted);
  }

  .device select {
    background: color-mix(in oklab, var(--color-gray-100, #333) 60%, transparent);
    color: var(--panel-fg);
    border-radius: calc(7px * var(--round, 1));
    padding: 5px;
    font-size: calc(11px * var(--text-scale, 1));
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }

  .empty {
    color: var(--panel-fg-muted);
    font-size: calc(12px * var(--text-scale, 1));
    margin: auto;
  }

  .empty.small {
    font-size: calc(11px * var(--text-scale, 1));
    margin: 8px auto;
  }
</style>
