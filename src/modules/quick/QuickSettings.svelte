<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { brightness, radios, setBrightness, setRadio, shortMonitorName } from '$lib/quick.svelte';
  import { focusAssist, setFocusAssist } from '$lib/notifications.svelte';
  import { SeelenCommand, invoke } from '$lib/seelen';
  import { tell } from '$lib/live.svelte';
  import { showDesktop } from '$lib/windows.svelte';

  const cfg = $derived(config.current);

  $effect(() => (cfg.quickBrightness ? brightness.acquire() : undefined));
  $effect(() => (cfg.quickRadios ? radios.acquire() : undefined));
  $effect(() => (cfg.quickFocusAssist ? focusAssist.acquire() : undefined));

  const panels = $derived(brightness.current.filter((m) => m.active));
</script>

<div class="m-body" data-no-drag>
  <div class="m-list">
    {#if cfg.quickBrightness}
      {#each panels as monitor (monitor.instanceName)}
        <div class="slider">
          <span class="m-sub">{shortMonitorName(monitor.instanceName)}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="Brightness"
            value={monitor.currentBrightness}
            oninput={(e) => setBrightness(monitor, e.currentTarget.valueAsNumber)}
          />
          <span class="m-value">{monitor.currentBrightness}%</span>
        </div>
      {:else}
        <p class="m-empty">No monitor reported a controllable backlight.</p>
      {/each}
    {/if}

    {#if cfg.quickRadios}
      {#each radios.current as radio (radio.id)}
        <label class="m-row m-click">
          <span class="m-text"><span class="m-title">{radio.name || radio.kind}</span></span>
          <input
            type="checkbox"
            class="m-switch"
            role="switch"
            checked={radio.is_enabled}
            onchange={(e) => setRadio(radio, e.currentTarget.checked)}
          />
        </label>
      {/each}
    {/if}

    {#if cfg.quickFocusAssist}
      <label class="m-row m-click">
        <span class="m-text"><span class="m-title">Focus assist</span></span>
        <input
          type="checkbox"
          class="m-switch"
          role="switch"
          checked={focusAssist.current}
          onchange={(e) => setFocusAssist(e.currentTarget.checked)}
        />
      </label>
    {/if}
  </div>

  <div class="m-actions">
    <!--
      Our own reveal, not the host's `show_desktop`: that one raises Explorer's
      desktop over this surface and buries the panel the button is on. Same
      action as the surface menu and the palette. See `showDesktop`.
    -->
    <button class="m-btn" onclick={() => void showDesktop()}>Show desktop</button>
    <button class="m-btn" onclick={() => tell('quick', invoke(SeelenCommand.ShowStartMenu))}>
      Start menu
    </button>
  </div>
</div>

<style>
  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 2px 8px;
    padding: 4px 6px;
  }

  .slider .m-sub {
    grid-column: 1 / -1;
  }

  .slider input {
    width: 100%;
  }

  .m-actions {
    margin-top: auto;
  }
</style>
