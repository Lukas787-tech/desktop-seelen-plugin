import { noteError } from './diagnostics';
import { readJson, writeJson } from './persist';
import type { UnSubscriber } from './seelen';

/**
 * Forecasts for the Weather module, from Open-Meteo.
 *
 * Open-Meteo answers `Access-Control-Allow-Origin: *` and needs no key, which
 * is why the assistant's `get_weather` tool already uses it from this webview
 * (see `web.ts`). This is the fuller request a panel wants: the current
 * conditions, the next day hour by hour, and a week of days.
 *
 * ## Cost
 *
 * One forecast request every thirty minutes per place, and only while a
 * Weather panel is shown. The last answer is kept in `weather.json`, so a
 * restart paints the previous forecast immediately - marked with its age -
 * instead of an empty panel waiting on the network, and a second display
 * showing the same place reads that file rather than asking again.
 */

export type WeatherUnits = 'metric' | 'imperial';

export interface Place {
  /** What the setting holds and the panel shows, e.g. `Berlin, Germany`. */
  label: string;
  latitude: number;
  longitude: number;
}

export interface Forecast {
  place: Place;
  units: WeatherUnits;
  fetchedAt: number;
  current: {
    /** Local to the place, `YYYY-MM-DDTHH:MM`. */
    time: string;
    temperature: number;
    apparent: number;
    humidity: number;
    precipitation: number;
    pressure: number;
    windSpeed: number;
    windDirection: number;
    code: number;
    isDay: boolean;
  };
  hourly: {
    time: string[];
    temperature: number[];
    rainChance: number[];
    code: number[];
    isDay: number[];
  };
  daily: {
    time: string[];
    code: number[];
    max: number[];
    min: number[];
    rainChance: number[];
    rainSum: number[];
    sunrise: string[];
    sunset: string[];
    uvMax: number[];
    windMax: number[];
  };
}

interface WeatherFile {
  version: 1;
  places: Record<string, Place>;
  forecasts: Record<string, Forecast>;
}

const FILE = 'weather.json';
/** A forecast younger than this is not asked for again. */
const FRESH_MS = 30 * 60_000;
/** How often a shown panel checks whether its forecast has gone stale. */
const CHECK_MS = 5 * 60_000;
const KEPT_FORECASTS = 4;

export function forecastKey(label: string, units: WeatherUnits, days: number): string {
  return `${label.trim().toLowerCase()}|${units}|${days}`;
}

const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map((v) => Number(v ?? 0)) : []);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v ?? '')) : []);

function timeout(ms: number): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: timeout(12_000) });
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

/** Places matching a name, best first. */
export async function searchPlaces(name: string): Promise<Place[]> {
  const query = name.trim();
  if (!query) return [];
  const data = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(query)}`,
  );
  const results = Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  return results
    .map((hit) => {
      const place = String(hit.name ?? '');
      const region = hit.admin1 && hit.admin1 !== hit.name ? String(hit.admin1) : null;
      return {
        label: [place, region, hit.country ? String(hit.country) : null].filter(Boolean).join(', '),
        latitude: Number(hit.latitude),
        longitude: Number(hit.longitude),
      };
    })
    .filter((p) => p.label && Number.isFinite(p.latitude) && !seen.has(p.label) && (seen.add(p.label), true));
}

async function fetchForecast(place: Place, units: WeatherUnits, days: number): Promise<Forecast> {
  const imperial = units === 'imperial';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m' +
    '&hourly=temperature_2m,precipitation_probability,weather_code,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max' +
    `&timezone=auto&forecast_days=${Math.max(2, days)}` +
    (imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : '');
  const data = await getJson(url);
  const c = (data.current ?? {}) as Record<string, unknown>;
  const h = (data.hourly ?? {}) as Record<string, unknown>;
  const d = (data.daily ?? {}) as Record<string, unknown>;
  if (typeof c.time !== 'string') throw new Error('Open-Meteo sent no current conditions.');

  return {
    place,
    units,
    fetchedAt: Date.now(),
    current: {
      time: c.time,
      temperature: Number(c.temperature_2m ?? 0),
      apparent: Number(c.apparent_temperature ?? 0),
      humidity: Number(c.relative_humidity_2m ?? 0),
      precipitation: Number(c.precipitation ?? 0),
      pressure: Number(c.pressure_msl ?? 0),
      windSpeed: Number(c.wind_speed_10m ?? 0),
      windDirection: Number(c.wind_direction_10m ?? 0),
      code: Number(c.weather_code ?? 0),
      isDay: Number(c.is_day ?? 1) === 1,
    },
    hourly: {
      time: strings(h.time),
      temperature: numbers(h.temperature_2m),
      rainChance: numbers(h.precipitation_probability),
      code: numbers(h.weather_code),
      isDay: numbers(h.is_day),
    },
    daily: {
      time: strings(d.time),
      code: numbers(d.weather_code),
      max: numbers(d.temperature_2m_max),
      min: numbers(d.temperature_2m_min),
      rainChance: numbers(d.precipitation_probability_max),
      rainSum: numbers(d.precipitation_sum),
      sunrise: strings(d.sunrise),
      sunset: strings(d.sunset),
      uvMax: numbers(d.uv_index_max),
      windMax: numbers(d.wind_speed_10m_max),
    },
  };
}

class WeatherStore {
  forecasts = $state<Record<string, Forecast>>({});
  loading = $state<Record<string, boolean>>({});
  errors = $state<Record<string, string>>({});

  #file: Promise<WeatherFile> | null = null;
  #watchers = new Map<string, { users: number; timer: ReturnType<typeof setInterval> | undefined }>();

  /**
   * Keeps one place's forecast current while a panel shows it.
   *
   * Written for `$effect`: the place, units and length are its arguments, so a
   * change to any of them releases the old watch and starts the new one.
   */
  watch(label: string, units: WeatherUnits, days: number): UnSubscriber {
    if (!label.trim()) return () => {};
    const key = forecastKey(label, units, days);
    let watcher = this.#watchers.get(key);
    if (!watcher) {
      watcher = { users: 0, timer: undefined };
      this.#watchers.set(key, watcher);
    }
    watcher.users++;
    if (watcher.users === 1) {
      void this.#ensure(label, units, days, false);
      watcher.timer = setInterval(() => void this.#ensure(label, units, days, false), CHECK_MS);
    }

    let released = false;
    return () => {
      if (released || !watcher) return;
      released = true;
      watcher.users--;
      if (watcher.users > 0) return;
      clearInterval(watcher.timer);
      this.#watchers.delete(key);
    };
  }

  refresh(label: string, units: WeatherUnits, days: number): void {
    void this.#ensure(label, units, days, true);
  }

  /** Remembers a chosen place's coordinates, so it is never looked up again. */
  async remember(place: Place): Promise<void> {
    const file = await this.#read();
    file.places[place.label.toLowerCase()] = place;
    await writeJson(FILE, file).catch(() => {});
  }

  async #ensure(label: string, units: WeatherUnits, days: number, force: boolean): Promise<void> {
    const key = forecastKey(label, units, days);
    const file = await this.#read();

    const cached = this.forecasts[key] ?? file.forecasts[key];
    if (cached && !this.forecasts[key]) this.forecasts[key] = cached;
    if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS) return;
    if (this.loading[key]) return;

    this.loading[key] = true;
    try {
      let place = file.places[label.trim().toLowerCase()];
      if (!place) {
        place = (await searchPlaces(label))[0];
        if (!place) throw new Error(`No place called “${label}” was found.`);
        file.places[label.trim().toLowerCase()] = place;
      }
      const forecast = await fetchForecast(place, units, days);
      this.forecasts[key] = forecast;
      delete this.errors[key];

      file.forecasts[key] = forecast;
      const keys = Object.keys(file.forecasts).sort(
        (a, b) => (file.forecasts[b]?.fetchedAt ?? 0) - (file.forecasts[a]?.fetchedAt ?? 0),
      );
      for (const stale of keys.slice(KEPT_FORECASTS)) delete file.forecasts[stale];
      await writeJson(FILE, file).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // An offline machine is normal; the cached forecast stays up with its age.
      this.errors[key] = /fetch|network|abort|timed? ?out/i.test(message) ? 'Could not reach Open-Meteo.' : message;
      noteError(`weather: ${message}`);
    } finally {
      this.loading[key] = false;
    }
  }

  #read(): Promise<WeatherFile> {
    this.#file ??= readJson<Partial<WeatherFile> | null>(FILE, null).then((raw) => ({
      version: 1,
      places: raw?.places ?? {},
      forecasts: raw?.forecasts ?? {},
    }));
    return this.#file;
  }
}

export const weather = new WeatherStore();

/** WMO weather interpretation codes, as Open-Meteo reports them. */
export function describeWeather(code: number, isDay = true): { label: string; icon: string } {
  switch (code) {
    case 0:
      return { label: 'Clear', icon: isDay ? '☀️' : '🌙' };
    case 1:
      return { label: 'Mainly clear', icon: isDay ? '🌤️' : '🌙' };
    case 2:
      return { label: 'Partly cloudy', icon: isDay ? '⛅' : '☁️' };
    case 3:
      return { label: 'Overcast', icon: '☁️' };
    case 45:
    case 48:
      return { label: 'Fog', icon: '🌫️' };
    case 51:
    case 53:
    case 55:
      return { label: 'Drizzle', icon: '🌦️' };
    case 56:
    case 57:
      return { label: 'Freezing drizzle', icon: '🌧️' };
    case 61:
      return { label: 'Light rain', icon: '🌧️' };
    case 63:
      return { label: 'Rain', icon: '🌧️' };
    case 65:
      return { label: 'Heavy rain', icon: '🌧️' };
    case 66:
    case 67:
      return { label: 'Freezing rain', icon: '🌧️' };
    case 71:
      return { label: 'Light snow', icon: '🌨️' };
    case 73:
      return { label: 'Snow', icon: '🌨️' };
    case 75:
      return { label: 'Heavy snow', icon: '❄️' };
    case 77:
      return { label: 'Snow grains', icon: '🌨️' };
    case 80:
    case 81:
      return { label: 'Showers', icon: isDay ? '🌦️' : '🌧️' };
    case 82:
      return { label: 'Violent showers', icon: '🌧️' };
    case 85:
    case 86:
      return { label: 'Snow showers', icon: '🌨️' };
    case 95:
      return { label: 'Thunderstorm', icon: '⛈️' };
    case 96:
    case 99:
      return { label: 'Thunderstorm, hail', icon: '⛈️' };
    default:
      return { label: 'Unknown', icon: '🌡️' };
  }
}

/** A compass point for a wind bearing in degrees. */
export function compass(degrees: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8] as string;
}
