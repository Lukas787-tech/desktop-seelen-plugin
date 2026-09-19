<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { linger, settle } from '$lib/motion';
  import { wallpapers, type WallpaperEntry } from '$lib/wallpapers.svelte';
  import { fileUrl, isVideoFile } from '$lib/assets';
  import type { WallpaperChoice } from '$lib/store.svelte';

  interface Props {
    choice: WallpaperChoice;
    /** True while application windows hide this display. */
    covered: boolean;
    /**
     * A still of whatever is showing now - the image itself, or a video's
     * thumbnail. The surface samples it for the shell's glass colour. A video
     * is deliberately sampled from its thumbnail rather than from a live
     * frame: every change in that colour is a write to the settings file, and
     * a colour that followed the video would never stop writing.
     */
    onstill?: (url: string | null) => void;
  }

  let { choice, covered, onstill }: Props = $props();

  const cfg = $derived(config.current);

  let slideIndex = $state(0);
  let videoEl = $state<HTMLVideoElement | null>(null);

  /** Library entries usable for a slideshow, in a stable order. */
  const slideshowPool = $derived(wallpapers.entries.filter((e) => e.url));

  /** The wallpaper to show right now, honouring slideshow rotation. */
  const active = $derived.by(():
    | { url: string; isVideo: boolean; still: string | null }
    | null => {
    if (!cfg.wallpaperEnabled) return null;

    if (cfg.slideshowEnabled && slideshowPool.length > 0) {
      const entry = slideshowPool[slideIndex % slideshowPool.length] as WallpaperEntry;
      return entry.url
        ? {
            url: entry.url,
            isVideo: entry.isVideo,
            still: entry.isVideo ? entry.thumbnailUrl : entry.url,
          }
        : null;
    }

    if (choice.source === 'file' && choice.path) {
      const url = fileUrl(choice.path);
      const video = isVideoFile(choice.path);
      // A file chosen from disk has no thumbnail beside it, so a video picked
      // that way simply has no still to sample.
      return url ? { url, isVideo: video, still: video ? null : url } : null;
    }

    if (choice.source === 'library') {
      const entry = wallpapers.byId(choice.id);
      if (entry?.url) {
        return {
          url: entry.url,
          isVideo: entry.isVideo,
          still: entry.isVideo ? entry.thumbnailUrl : entry.url,
        };
      }
    }

    return null;
  });

  $effect(() => onstill?.(active?.still ?? null));

  /** Colour filters are cheap on the GPU and apply equally to video and stills. */
  const filterCss = $derived(
    [
      cfg.wallpaperBlur > 0 ? `blur(${cfg.wallpaperBlur}px)` : '',
      cfg.wallpaperSaturation !== 100 ? `saturate(${cfg.wallpaperSaturation}%)` : '',
      cfg.wallpaperBrightness !== 100 ? `brightness(${cfg.wallpaperBrightness}%)` : '',
    ]
      .filter(Boolean)
      .join(' ') || 'none',
  );

  // Stop decoding while the display is hidden. This is the single biggest cost
  // the surface can impose, so it is driven by real window geometry rather than
  // a timer.
  $effect(() => {
    const el = videoEl;
    if (!el) return;
    const shouldPause = covered && cfg.wallpaperPauseWhenCovered;
    if (shouldPause) {
      el.pause();
    } else {
      // A rejected play() is normal when the element is being torn down.
      void el.play().catch(() => {});
    }
  });

  // Advance the slideshow. Paused while covered so a hidden display does not
  // churn through decodes nobody sees.
  $effect(() => {
    if (!cfg.wallpaperEnabled || !cfg.slideshowEnabled) return;
    if (covered && cfg.wallpaperPauseWhenCovered) return;
    const poolSize = slideshowPool.length;
    if (poolSize < 2) return;

    const seconds = Math.max(5, cfg.slideshowInterval);
    const timer = setInterval(() => {
      slideIndex = cfg.slideshowRandomize
        ? Math.floor(Math.random() * poolSize)
        : (slideIndex + 1) % poolSize;
    }, seconds * 1000);

    return () => clearInterval(timer);
  });
</script>

<div class="wallpaper" aria-hidden="true">
  {#if active}
    <!-- A new wallpaper settles in from slightly too close while the old one
         stays until it is covered, so a change never dips through to black. -->
    {#key active.url}
      <div class="layer" in:settle={{ duration: 1400 }} out:linger={{ duration: 1400 }}>
        {#if active.isVideo}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            bind:this={videoEl}
            src={active.url}
            style:object-fit={cfg.wallpaperFit}
            style:filter={filterCss}
            autoplay
            loop
            playsinline
            muted={cfg.wallpaperMuted}
          ></video>
        {:else}
          <img
            src={active.url}
            alt=""
            style:object-fit={cfg.wallpaperFit}
            style:filter={filterCss}
          />
        {/if}
      </div>
    {/key}
  {/if}

  {#if cfg.wallpaperEnabled && cfg.wallpaperOverlayOpacity > 0}
    <div
      class="tint"
      style:background-color={cfg.wallpaperOverlayColor}
      style:opacity={cfg.wallpaperOverlayOpacity / 100}
    ></div>
  {/if}
</div>

<style>
  .wallpaper,
  .layer,
  .tint {
    position: absolute;
    inset: 0;
  }

  .wallpaper {
    overflow: hidden;
    /* No background of its own: with the engine off, Windows' wallpaper shows. */
    background: transparent;
  }

  video,
  img {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* The overlay colour eases to a new setting instead of snapping. */
  .tint {
    pointer-events: none;
    transition:
      background-color var(--dur-slow) var(--ease),
      opacity var(--dur-slow) var(--ease);
  }
</style>
