<script lang="ts">
  import { config } from '$lib/config.svelte';

  const cfg = $derived(config.current);

  let now = $state(new Date());

  // Aligned to the start of the minute: every zone shares the same tick, and
  // no zone needs seconds to be useful.
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      now = new Date();
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  });

  interface Zone {
    id: string;
    label: string;
    time: string;
    /** Whole hours ahead (+) or behind (-) this machine. */
    offset: number;
    /** Calendar days ahead or behind, for the "tomorrow already" case. */
    dayDiff: number;
    valid: boolean;
  }

  /** Numeric parts of an instant as they read in one time zone. */
  function partsIn(zone: string, at: Date): Record<string, number> {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);

    const out: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== 'literal') out[part.type] = Number(part.value);
    }
    // Some engines render midnight as hour 24 with hour12 off.
    out.hour = (out.hour ?? 0) % 24;
    return out;
  }

  const zones = $derived.by((): Zone[] => {
    // Deduplicated: the setting is free text, and the same zone typed twice
    // would collide as a keyed-each key.
    const names = [
      ...new Set(
        cfg.worldClockZones
          .split(/[,\n]/)
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ];

    return names.map((id) => {
      const label = (id.split('/').pop() ?? id).replace(/_/g, ' ');
      try {
        const time = now.toLocaleTimeString(undefined, {
          timeZone: id,
          hour: '2-digit',
          minute: '2-digit',
          hour12: !cfg.worldClock24h,
        });

        const there = partsIn(id, now);
        const here = partsIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now);
        const thereUtc = Date.UTC(there.year ?? 0, (there.month ?? 1) - 1, there.day ?? 1, there.hour ?? 0, there.minute ?? 0);
        const hereUtc = Date.UTC(here.year ?? 0, (here.month ?? 1) - 1, here.day ?? 1, here.hour ?? 0, here.minute ?? 0);
        const minutes = Math.round((thereUtc - hereUtc) / 60_000);

        const thereDay = Date.UTC(there.year ?? 0, (there.month ?? 1) - 1, there.day ?? 1);
        const hereDay = Date.UTC(here.year ?? 0, (here.month ?? 1) - 1, here.day ?? 1);

        return {
          id,
          label,
          time,
          offset: minutes / 60,
          dayDiff: Math.round((thereDay - hereDay) / 86_400_000),
          valid: true,
        };
      } catch {
        // An unknown zone is a typo in the setting, not a failure to report.
        return { id, label, time: 'unknown zone', offset: 0, dayDiff: 0, valid: false };
      }
    });
  });

  function offsetLabel(zone: Zone): string {
    if (!zone.valid) return zone.id;
    const parts: string[] = [];
    if (zone.dayDiff > 0) parts.push('tomorrow');
    else if (zone.dayDiff < 0) parts.push('yesterday');
    if (cfg.worldClockOffsets && zone.offset !== 0) {
      const rounded = Number(zone.offset.toFixed(1));
      parts.push(`${rounded > 0 ? '+' : ''}${rounded} h`);
    }
    return parts.join(' \u00B7 ');
  }
</script>

<div class="m-body">
  <ul class="m-list">
    {#each zones as zone (zone.id)}
      <li class="m-row">
        <span class="m-text">
          <span class="m-title">{zone.label}</span>
          {#if offsetLabel(zone)}<span class="m-sub">{offsetLabel(zone)}</span>{/if}
        </span>
        <span class="m-value" class:m-muted={!zone.valid}>{zone.time}</span>
      </li>
    {:else}
      <li class="m-empty">No time zones set. Add some in this module's settings.</li>
    {/each}
  </ul>
</div>
