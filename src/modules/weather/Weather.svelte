<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { areaPath, linePath, scale } from '$lib/charts';
  import {
    compass,
    describeWeather,
    forecastKey,
    searchPlaces,
    weather,
    type Place,
  } from '$lib/weather.svelte';

  const cfg = $derived(config.current);

  const place = $derived(cfg.weatherPlace.trim());
  const units = $derived(cfg.weatherUnits);
  const days = $derived(Math.max(3, Math.min(14, Math.round(cfg.weatherDays))));

  $effect(() => weather.watch(place, units, days));

  const key = $derived(forecastKey(place, units, days));
  const forecast = $derived(weather.forecasts[key] ?? null);
  const loading = $derived(weather.loading[key] === true);
  const error = $derived(weather.errors[key] ?? null);

  // --- choosing a place -----------------------------------------------------
  let choosing = $state(false);
  let query = $state('');
  let results = $state<Place[]>([]);
  let searchError = $state<string | null>(null);
  let searchingNow = $state(false);

  const showChooser = $derived(choosing || !place);

  async function search(event: SubmitEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    searchingNow = true;
    searchError = null;
    try {
      results = await searchPlaces(text);
      if (!results.length) searchError = `Nothing found for “${text}”.`;
    } catch {
      searchError = 'Could not reach the place search.';
    } finally {
      searchingNow = false;
    }
  }

  function choose(chosen: Place) {
    void weather.remember(chosen);
    config.set('weatherPlace', chosen.label);
    choosing = false;
    query = '';
    results = [];
  }

  function onSearchKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && place) {
      event.preventDefault();
      choosing = false;
    }
  }

  // --- reading the forecast ---------------------------------------------------
  /** Only so "updated 12 min ago" stays true; the data refreshes on its own. */
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const age = $derived.by(() => {
    if (!forecast) return '';
    const minutes = Math.round((now - forecast.fetchedAt) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : 'over a day ago';
  });
  const stale = $derived(!!forecast && now - forecast.fetchedAt > 3 * 3600_000);

  const deg = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? '–' : `${Math.round(value)}°`);
  const windUnit = $derived(units === 'imperial' ? 'mph' : 'km/h');
  const rainUnit = $derived(units === 'imperial' ? 'in' : 'mm');

  const conditions = $derived(forecast ? describeWeather(forecast.current.code, forecast.current.isDay) : null);

  /** The next 24 hours, starting at the place's current hour. */
  const hours = $derived.by(() => {
    if (!forecast) return [];
    const { hourly, current } = forecast;
    const nowHour = current.time.slice(0, 13);
    let start = hourly.time.findIndex((time) => time.slice(0, 13) === nowHour);
    if (start < 0) start = 0;
    return hourly.time.slice(start, start + 25).map((time, i) => ({
      time,
      temperature: hourly.temperature[start + i] ?? 0,
      rain: hourly.rainChance[start + i] ?? 0,
      icon: describeWeather(hourly.code[start + i] ?? 0, (hourly.isDay[start + i] ?? 1) === 1).icon,
    }));
  });

  let chartWidth = $state(0);
  const CHART_H = 44;

  const chart = $derived.by(() => {
    if (hours.length < 2 || chartWidth <= 0) return null;
    const temps = hours.map((h) => h.temperature);
    const lo = Math.min(...temps);
    const hi = Math.max(...temps);
    const pad = Math.max(1, (hi - lo) * 0.3);
    const points = scale(temps, chartWidth, CHART_H - 12, hi + pad, temps.length, lo - pad).map(
      ([x, y]) => [x, y + 10] as const,
    );
    const step = chartWidth / (hours.length - 1);
    return {
      line: linePath(points),
      area: areaPath(points, CHART_H),
      step,
      marks: hours
        .map((h, i) => ({ ...h, i, x: points[i]?.[0] ?? 0, y: points[i]?.[1] ?? 0 }))
        .filter((h) => h.i % 4 === 0 && h.i < hours.length - 1),
    };
  });

  function hourLabel(time: string): string {
    const date = new Date(`${time}:00`);
    return date.toLocaleTimeString(undefined, { hour: 'numeric', hour12: !cfg.clock24h });
  }

  /** Days, each with its low-to-high span placed on the week's own scale. */
  const week = $derived.by(() => {
    if (!forecast) return [];
    const { daily } = forecast;
    const count = Math.min(days, daily.time.length);
    const lows = daily.min.slice(0, count);
    const highs = daily.max.slice(0, count);
    const floor = Math.min(...lows);
    const ceiling = Math.max(...highs);
    const range = ceiling - floor || 1;
    return daily.time.slice(0, count).map((date, i) => {
      const min = daily.min[i] ?? 0;
      const max = daily.max[i] ?? 0;
      const weekday = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
      return {
        date,
        label: i === 0 ? 'Today' : weekday,
        icon: describeWeather(daily.code[i] ?? 0).icon,
        rain: daily.rainChance[i] ?? 0,
        min,
        max,
        from: ((min - floor) / range) * 100,
        to: ((max - floor) / range) * 100,
      };
    });
  });

  const today = $derived(
    forecast
      ? {
          sunrise: forecast.daily.sunrise[0]?.slice(11, 16) ?? '–',
          sunset: forecast.daily.sunset[0]?.slice(11, 16) ?? '–',
          uv: forecast.daily.uvMax[0] ?? 0,
          rainSum: forecast.daily.rainSum[0] ?? 0,
          high: forecast.daily.max[0],
          low: forecast.daily.min[0],
        }
      : null,
  );
</script>

<div class="m-body weather" data-no-drag>
  {#if showChooser}
    <form class="search" onsubmit={search}>
      <input
        type="search"
        bind:value={query}
        placeholder="Find a city or town..."
        aria-label="Place"
        onkeydown={onSearchKey}
      />
      <button class="m-btn m-primary" type="submit" disabled={searchingNow || !query.trim()}>
        {searchingNow ? '...' : 'Find'}
      </button>
      {#if place}
        <button class="m-btn" type="button" onclick={() => (choosing = false)}>Cancel</button>
      {/if}
    </form>
    <ul class="m-list">
      {#each results as result (result.label)}
        <li>
          <button class="m-row" onclick={() => choose(result)}>
            <span class="m-glyph">&#128205;</span>
            <span class="m-text"><span class="m-title">{result.label}</span></span>
          </button>
        </li>
      {:else}
        <li class="m-empty">
          {searchError ?? (place ? `Showing ${place}. Search to change it.` : 'Choose where to show the weather for.')}
        </li>
      {/each}
    </ul>
  {:else if !forecast}
    <p class="m-empty status">
      {#if error}{error} <button class="link" onclick={() => weather.refresh(place, units, days)}>Try again</button>
      {:else}Fetching the forecast for {place}...{/if}
    </p>
  {:else}
    <header class="now">
      <span class="icon" aria-hidden="true">{conditions?.icon}</span>
      <div class="reading">
        <span class="m-stat temp">{deg(forecast.current.temperature)}</span>
        <span class="m-sub">{conditions?.label} · feels {deg(forecast.current.apparent)}</span>
      </div>
      <div class="range">
        <span class="m-value">{deg(today?.high)}</span>
        <span class="m-sub">{deg(today?.low)}</span>
      </div>
    </header>

    <div class="where">
      <button class="place" title="Change the place" onclick={() => (choosing = true)}>
        {forecast.place.label}
      </button>
      <button
        class="m-quiet refresh"
        class:spin={loading}
        title={error ? `${error} Updated ${age}.` : `Updated ${age}. Refresh`}
        aria-label="Refresh the forecast"
        onclick={() => weather.refresh(place, units, days)}
      >
        &#8635;
      </button>
      <span class="m-sub" class:warn={stale || !!error}>{error && stale ? 'offline' : age}</span>
    </div>

    <div class="m-scroll">
      {#if cfg.weatherShowHourly && hours.length > 1}
        <div class="hourly" bind:clientWidth={chartWidth}>
          {#if chart}
            <svg width={chartWidth} height={CHART_H} aria-hidden="true">
              <defs>
                <linearGradient id="weather-temp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="currentColor" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path class="area" d={chart.area} fill="url(#weather-temp)" />
              <path class="line" d={chart.line} />
              {#each chart.marks as mark (mark.time)}
                <circle cx={mark.x} cy={mark.y} r="2" />
                <text x={Math.max(10, Math.min(chartWidth - 10, mark.x))} y={Math.max(8, mark.y - 4)}>
                  {deg(mark.temperature)}
                </text>
              {/each}
            </svg>
            <div class="rain" style:grid-template-columns="repeat({hours.length}, 1fr)">
              {#each hours as hour (hour.time)}
                <span title="{hour.rain}% chance of rain" style:--rain={hour.rain}></span>
              {/each}
            </div>
            <div class="hours">
              {#each chart.marks as mark (mark.time)}
                <span style:left="{(mark.x / chartWidth) * 100}%">{mark.i === 0 ? 'Now' : hourLabel(mark.time)}</span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <ul class="days">
        {#each week as day (day.date)}
          <li class="m-row day">
            <span class="dayname">{day.label}</span>
            <span class="dayicon" aria-hidden="true">{day.icon}</span>
            <span class="chance" class:dry={day.rain < 20}>{day.rain}%</span>
            <span class="lo">{deg(day.min)}</span>
            <span class="span" aria-hidden="true">
              <span style:left="{day.from}%" style:right="{100 - day.to}%"></span>
            </span>
            <span class="hi">{deg(day.max)}</span>
          </li>
        {/each}
      </ul>

      {#if cfg.weatherShowDetails && today}
        <div class="m-facts details">
          <div>
            <span class="m-sub">Humidity</span>
            <span class="m-value">{Math.round(forecast.current.humidity)}%</span>
          </div>
          <div>
            <span class="m-sub">Wind</span>
            <span class="m-value">
              <span class="arrow" style:rotate="{forecast.current.windDirection + 180}deg">&#8593;</span>
              {Math.round(forecast.current.windSpeed)} {windUnit} {compass(forecast.current.windDirection)}
            </span>
          </div>
          <div>
            <span class="m-sub">UV index</span>
            <span class="m-value">{today.uv.toFixed(0)}</span>
          </div>
          <div>
            <span class="m-sub">Rain today</span>
            <span class="m-value">{today.rainSum.toFixed(1)} {rainUnit}</span>
          </div>
          <div>
            <span class="m-sub">Sunrise</span>
            <span class="m-value">{today.sunrise}</span>
          </div>
          <div>
            <span class="m-sub">Sunset</span>
            <span class="m-value">{today.sunset}</span>
          </div>
          <div>
            <span class="m-sub">Pressure</span>
            <span class="m-value">{Math.round(forecast.current.pressure)} hPa</span>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search {
    display: flex;
    gap: 6px;
    flex: none;
  }

  .search input {
    flex: 1;
    min-width: 0;
  }

  .status {
    margin: auto 0;
    text-align: center;
  }

  .link {
    padding: 0;
    font: inherit;
    color: var(--accent, #7aa2f7);
    background: none;
    cursor: pointer;
  }

  .now {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .icon {
    font-size: calc(var(--ui-size) * 2.5);
    line-height: 1;
    filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.3));
  }

  .reading {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .temp {
    font-size: calc(var(--ui-size) * 2.6);
  }

  .range {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .where {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin-top: -2px;
  }

  .place {
    min-width: 0;
    padding: 0;
    font: inherit;
    font-size: calc(11px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    background: none;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .place:hover {
    color: var(--panel-fg);
  }

  .refresh {
    opacity: 0.7;
    font-size: calc(12px * var(--text-scale, 1));
  }

  .refresh.spin {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }

  .where .m-sub {
    margin-left: auto;
    flex: none;
  }

  .warn {
    color: var(--color-orange-700, #f2a65a);
  }

  .m-scroll {
    display: flex;
    flex-direction: column;
    gap: calc(8px * var(--density));
  }

  .hourly {
    position: relative;
    flex: none;
    color: var(--accent, #7aa2f7);
  }

  .hourly svg {
    display: block;
    overflow: visible;
  }

  .line {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  circle {
    fill: currentColor;
  }

  text {
    font-size: calc(9px * var(--text-scale, 1));
    fill: var(--panel-fg);
    text-anchor: middle;
    font-variant-numeric: tabular-nums;
  }

  .rain {
    display: grid;
    align-items: end;
    gap: 1px;
    height: 10px;
    margin-top: 2px;
  }

  .rain span {
    height: calc(var(--rain) * 0.1px);
    min-height: 1px;
    border-radius: calc(1px * var(--round, 1));
    background: color-mix(in oklab, #5aa9f2 calc(35% + var(--rain) * 0.6%), transparent);
  }

  .hours {
    position: relative;
    height: 12px;
    margin-top: 2px;
  }

  .hours span {
    position: absolute;
    translate: -50% 0;
    font-size: calc(9px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    white-space: nowrap;
  }

  .hours span:first-child {
    translate: 0 0;
  }

  .days {
    list-style: none;
    margin: 0 -6px;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .day {
    gap: 6px;
  }

  .dayname {
    width: 3.4em;
    flex: none;
    font-size: calc(11px * var(--text-scale, 1));
  }

  .dayicon {
    width: 1.4em;
    flex: none;
    text-align: center;
  }

  .chance {
    width: 2.6em;
    flex: none;
    font-size: calc(10px * var(--text-scale, 1));
    text-align: right;
    color: #5aa9f2;
    font-variant-numeric: tabular-nums;
  }

  .chance.dry {
    visibility: hidden;
  }

  .lo,
  .hi {
    width: 2.4em;
    flex: none;
    font-size: calc(11px * var(--text-scale, 1));
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .lo {
    color: var(--panel-fg-muted);
  }

  .span {
    position: relative;
    flex: 1;
    height: 4px;
    border-radius: calc(999px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-300, #666) 24%, transparent);
  }

  .span span {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: calc(999px * var(--round, 1));
    background: linear-gradient(90deg, #5aa9f2, var(--accent, #7aa2f7), #f2a65a);
  }

  .details {
    padding: 2px 0 4px;
  }

  .arrow {
    display: inline-block;
    font-size: calc(10px * var(--text-scale, 1));
  }
</style>
