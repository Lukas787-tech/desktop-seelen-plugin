import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import type { Core, Disk, Memory, NetworkStatistics } from '@seelen-ui/lib/types';

/** How many samples the sparklines keep. */
const HISTORY = 60;

function pushCapped(history: number[], value: number): number[] {
  const next = history.length >= HISTORY ? history.slice(1) : history.slice();
  next.push(value);
  return next;
}

/**
 * System metrics, sourced entirely from the host's change events.
 *
 * Seelen already samples the machine on one shared interval (the user's
 * `pollingInterval`, 3s here) and broadcasts the results, so this surface adds
 * no timers and no duplicate sampling of its own.
 *
 * Note there is no GPU metric in the host API, so none is reported.
 */
class SystemStore {
  cores = $state<Core[]>([]);
  memory = $state<Memory | null>(null);
  disks = $state<Disk[]>([]);
  network = $state<NetworkStatistics[]>([]);

  cpuHistory = $state<number[]>([]);
  ramHistory = $state<number[]>([]);

  /** Bytes per second since the previous sample, derived from cumulative totals. */
  downloadRate = $state(0);
  uploadRate = $state(0);

  #lastNetTotals: { received: number; transmitted: number; atMs: number } | null = null;

  get cpuUsage(): number {
    if (!this.cores.length) return 0;
    return this.cores.reduce((sum, c) => sum + c.usage, 0) / this.cores.length;
  }

  get memoryUsedRatio(): number {
    const m = this.memory;
    if (!m || m.total <= 0) return 0;
    return (m.total - m.free) / m.total;
  }

  async start(): Promise<UnSubscriber[]> {
    // Seed from the current values so the panel is populated before the first
    // change event arrives.
    await Promise.all([
      invoke(SeelenCommand.GetSystemCores)
        .then((v) => this.#applyCores(v))
        .catch(() => {}),
      invoke(SeelenCommand.GetSystemMemory)
        .then((v) => this.#applyMemory(v))
        .catch(() => {}),
      invoke(SeelenCommand.GetSystemDisks)
        .then((v) => (this.disks = v))
        .catch(() => {}),
      invoke(SeelenCommand.GetSystemNetwork)
        .then((v) => this.#applyNetwork(v))
        .catch(() => {}),
    ]);

    return Promise.all([
      subscribe(SeelenEvent.SystemCoresChanged, (e) => this.#applyCores(e.payload)),
      subscribe(SeelenEvent.SystemMemoryChanged, (e) => this.#applyMemory(e.payload)),
      subscribe(SeelenEvent.SystemDisksChanged, (e) => (this.disks = e.payload)),
      subscribe(SeelenEvent.SystemNetworkChanged, (e) => this.#applyNetwork(e.payload)),
    ]);
  }

  #applyCores(cores: Core[]): void {
    this.cores = cores;
    this.cpuHistory = pushCapped(this.cpuHistory, this.cpuUsage);
  }

  #applyMemory(memory: Memory): void {
    this.memory = memory;
    this.ramHistory = pushCapped(this.ramHistory, this.memoryUsedRatio * 100);
  }

  #applyNetwork(stats: NetworkStatistics[]): void {
    this.network = stats;

    // The host reports cumulative byte counters, so a rate needs the delta
    // against the previous sample and the real elapsed time between them.
    const received = stats.reduce((sum, s) => sum + s.received, 0);
    const transmitted = stats.reduce((sum, s) => sum + s.transmitted, 0);
    const atMs = Date.now();
    const prev = this.#lastNetTotals;

    if (prev) {
      const seconds = (atMs - prev.atMs) / 1000;
      if (seconds > 0) {
        // Counters reset when an adapter goes away; a negative delta is not a rate.
        this.downloadRate = Math.max(0, (received - prev.received) / seconds);
        this.uploadRate = Math.max(0, (transmitted - prev.transmitted) / seconds);
      }
    }
    this.#lastNetTotals = { received, transmitted, atMs };
  }
}

export const system = new SystemStore();

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Formats a byte count for display, e.g. `1.4 GB`. */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${UNITS[0]}`;
  const power = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : fractionDigits)} ${UNITS[power]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}
