<script lang="ts">
  import { areaPath, linePath, scale, type GraphSeries } from '$lib/charts';

  interface Props {
    series: GraphSeries[];
    /** Horizontal positions the series will eventually fill. */
    slots?: number;
    height?: number;
    /** Horizontal guide lines, evenly spaced; 0 for none. */
    grid?: number;
    smooth?: boolean;
    /** A small caption in the top-right corner, e.g. the axis maximum. */
    caption?: string;
  }

  let { series, slots, height = 64, grid = 3, smooth = true, caption }: Props = $props();

  /*
   * Drawn in real pixels of the measured width rather than a stretched
   * viewBox: a `preserveAspectRatio="none"` graph squashes its stroke along
   * with the geometry, so the line thickens and thins as the panel resizes.
   */
  let width = $state(0);

  /** Unique per instance, because gradient ids are document-wide. */
  const uid = `graph-${Math.random().toString(36).slice(2, 9)}`;

  const drawn = $derived.by(() => {
    if (width <= 0) return [];
    // One pixel of headroom top and bottom, so a line at 0 or at the maximum
    // is not half clipped by the edge.
    const inner = height - 2;
    return series.map((s, i) => {
      const points = scale(s.values, width, inner, s.max, slots ?? s.values.length, s.min ?? 0).map(
        ([x, y]) => [x, y + 1] as const,
      );
      return {
        id: `${uid}-${i}`,
        tone: s.tone ?? 'accent',
        line: linePath(points, smooth),
        area: s.fill ? areaPath(points, height, smooth) : '',
      };
    });
  });
</script>

<div class="graph" bind:clientWidth={width} style:height="{height}px">
  {#if width > 0}
    <svg {width} {height} viewBox="0 0 {width} {height}" aria-hidden="true">
      {#each Array.from({ length: grid }, (_, i) => ((i + 1) * height) / (grid + 1)) as y (y)}
        <line class="guide" x1="0" x2={width} y1={y} y2={y} />
      {/each}
      {#each drawn as path (path.id)}
        <g class="tone {path.tone}">
          {#if path.area}
            <defs>
              <linearGradient id={path.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="currentColor" stop-opacity="0.38" />
                <stop offset="100%" stop-color="currentColor" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <path class="area" d={path.area} fill="url(#{path.id})" />
          {/if}
          <!-- `pathLength` makes the whole line one unit long, whatever its
               data, so it can draw itself in with a dash of exactly 1. -->
          <path class="line" d={path.line} pathLength="1" />
        </g>
      {/each}
    </svg>
  {/if}
  {#if caption}<span class="caption">{caption}</span>{/if}
</div>

<style>
  .graph {
    position: relative;
    flex: none;
    width: 100%;
    border-radius: calc(8px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-300, #666) 10%, transparent);
  }

  svg {
    display: block;
  }

  .guide {
    stroke: color-mix(in oklab, var(--color-gray-400, #888) 22%, transparent);
    stroke-width: 1;
    stroke-dasharray: 2 3;
    animation: fx-fade var(--dur-enter) var(--ease) backwards;
    animation-delay: var(--lag, 0ms);
  }

  .tone.accent {
    color: var(--accent, #7aa2f7);
  }

  .tone.warm {
    color: color-mix(in oklab, var(--accent, #7aa2f7) 20%, #f2a65a);
  }

  .tone.muted {
    color: var(--panel-fg-muted);
  }

  /*
   * The line draws itself from left to right when the graph appears, and the
   * fill beneath it rises in once it is most of the way across. Both play on
   * insertion only: new samples reshape the path without replaying either.
   */
  .line {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
    stroke-dasharray: 1 1;
    animation: fx-draw calc(var(--dur-enter) * 1.6) var(--ease-smooth) backwards;
    animation-delay: var(--lag, 0ms);
  }

  .area {
    animation: fx-fade var(--dur-enter) var(--ease) backwards;
    animation-delay: calc(var(--lag, 0ms) + var(--dur-slow));
  }

  .caption {
    position: absolute;
    top: 3px;
    right: 6px;
    font-size: calc(9px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
