import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import type { Core, Disk, Memory, NetworkStatistics } from '@seelen-ui/lib/types';

/**
 * How many samples the graphs keep. At the host's usual three-second interval
 * that is six minutes, which is what a Performance panel wants; the small
 * System panel draws the same series.
 */
export const HISTORY = 120;

function pushCapped(history: number[], value: number): number[] {
  const next = history.length >= HISTORY ? history.slice(1) : history.slice();
  next.push(value);
  return next;
}

/** Bytes per second in each direction. */
export interface NetRate {
  down: number;
  up: number;
}

export interface IoRate {
  read: number;
  write: number;
}

/**
 * System metrics, sourced entirely from the host's change events.
 *
 * Seelen already samples the machine on one shared interval (the user's
 * `pollingInterval`, 3s here) and broadcasts the results, so this surface adds
 * no timers and no duplicate sampling of its own.
 *
 * Held only while something shows it - the System or Performance panel - so a
 * surface with neither shown takes no metrics events at all. It used to be
 * started for every display at launch, which kept both replicas re-deriving
 * rates and histories every few seconds for panels nobody had switched on.
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
  swapHistory = $state<number[]>([]);

  /** Bytes per second since the previous sample, derived from cumulative totals. */
  downloadRate = $state(0);
  uploadRate = $state(0);
  downHistory = $state<number[]>([]);
  upHistory = $state<number[]>([]);
  /** The same, per adapter name. */
  adapterRates = $state<Record<string, NetRate>>({});

  /** Disk throughput per mount point, and the sum of every disk over time. */
  diskRates = $state<Record<string, IoRate>>({});
  diskHistory = $state<number[]>([]);

  /** Seconds between host samples, smoothed; what a graph's time axis means. */
  sampleSeconds = $state(3);

  #lastNet: { perAdapter: Map<string, { rx: number; tx: number }>; atMs: number } | null = null;
  #lastDisk: { perDisk: Map<string, { read: number; write: number }>; atMs: number } | null = null;
  #lastCoresAt = 0;
  /**
   * Whether the host's disk counters are per-sample rather than running
   * totals. Its types do not say; a running total never goes down, so the
   * first one that does settles it.
   */
  #diskCountersPerSample = false;

  #users = 0;
  #generation = 0;
  #offs: UnSubscriber[] = [];

  get cpuUsage(): number {
    if (!this.cores.length) return 0;
    return this.cores.reduce((sum, c) => sum + c.usage, 0) / this.cores.length;
  }

  get cpuBrand(): string {
    return this.cores[0]?.brand?.trim() ?? '';
  }

  /** Mean core frequency in MHz, or 0 when the host does not report one. */
  get cpuFrequency(): number {
    if (!this.cores.length) return 0;
    return this.cores.reduce((sum, c) => sum + c.frequency, 0) / this.cores.length;
  }

  get memoryUsedRatio(): number {
    const m = this.memory;
    if (!m || m.total <= 0) return 0;
    return (m.total - m.free) / m.total;
  }

  get swapUsedRatio(): number {
    const m = this.memory;
    if (!m || m.swapTotal <= 0) return 0;
    return (m.swapTotal - m.swapFree) / m.swapTotal;
  }

  /** Starts (or joins) the metrics; call the result to release them. */
  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) {
      const mine = ++this.#generation;
      void this.start().then(
        (offs) => {
          if (mine === this.#generation) this.#offs.push(...offs);
          else for (const off of offs) off();
        },
        (err) => console.error('[system] could not start', err),
      );
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      this.#generation++;
      for (const off of this.#offs.splice(0)) off();
      // A graph that resumed from a stale history would draw a straight line
      // across however long the panel was away.
      this.cpuHistory = [];
      this.ramHistory = [];
      this.swapHistory = [];
      this.downHistory = [];
      this.upHistory = [];
      this.diskHistory = [];
      this.#lastNet = null;
      this.#lastDisk = null;
      this.#lastCoresAt = 0;
    };
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
        .then((v) => this.#applyDisks(v))
        .catch(() => {}),
      invoke(SeelenCommand.GetSystemNetwork)
        .then((v) => this.#applyNetwork(v))
        .catch(() => {}),
    ]);

    return Promise.all([
      subscribe(SeelenEvent.SystemCoresChanged, (e) => this.#applyCores(e.payload)),
      subscribe(SeelenEvent.SystemMemoryChanged, (e) => this.#applyMemory(e.payload)),
      subscribe(SeelenEvent.SystemDisksChanged, (e) => this.#applyDisks(e.payload)),
      subscribe(SeelenEvent.SystemNetworkChanged, (e) => this.#applyNetwork(e.payload)),
    ]);
  }

  #applyCores(cores: Core[]): void {
    const now = Date.now();
    if (this.#lastCoresAt) {
      const seconds = (now - this.#lastCoresAt) / 1000;
      // Ignore the gap a sleep or a reload leaves; it is not the interval.
      if (seconds > 0.2 && seconds < 60) this.sampleSeconds = this.sampleSeconds * 0.8 + seconds * 0.2;
    }
    this.#lastCoresAt = now;
    this.cores = cores;
    this.cpuHistory = pushCapped(this.cpuHistory, this.cpuUsage);
  }

  #applyMemory(memory: Memory): void {
    this.memory = memory;
    this.ramHistory = pushCapped(this.ramHistory, this.memoryUsedRatio * 100);
    this.swapHistory = pushCapped(this.swapHistory, this.swapUsedRatio * 100);
  }

  #applyDisks(disks: Disk[]): void {
    this.disks = disks;

    const atMs = Date.now();
    const perDisk = new Map(disks.map((d) => [d.mountPoint, { read: d.readBytes, write: d.writtenBytes }]));
    const prev = this.#lastDisk;
    this.#lastDisk = { perDisk, atMs };
    if (!prev) return;

    const seconds = (atMs - prev.atMs) / 1000;
    if (seconds <= 0) return;

    const rates: Record<string, IoRate> = {};
    let total = 0;
    for (const [mount, now] of perDisk) {
      const before = prev.perDisk.get(mount);
      if (!before) continue;
      if (now.read < before.read || now.write < before.write) this.#diskCountersPerSample = true;
      const read = this.#diskCountersPerSample ? now.read : now.read - before.read;
      const write = this.#diskCountersPerSample ? now.write : now.write - before.write;
      const rate = { read: Math.max(0, read / seconds), write: Math.max(0, write / seconds) };
      rates[mount] = rate;
      total += rate.read + rate.write;
    }
    this.diskRates = rates;
    this.diskHistory = pushCapped(this.diskHistory, total);
  }

  #applyNetwork(stats: NetworkStatistics[]): void {
    this.network = stats;

    // The host reports cumulative byte counters, so a rate needs the delta
    // against the previous sample and the real elapsed time between them.
    const atMs = Date.now();
    const perAdapter = new Map(stats.map((s) => [s.name, { rx: s.received, tx: s.transmitted }]));
    const prev = this.#lastNet;
    this.#lastNet = { perAdapter, atMs };
    if (!prev) return;

    const seconds = (atMs - prev.atMs) / 1000;
    if (seconds <= 0) return;

    const rates: Record<string, NetRate> = {};
    let down = 0;
    let up = 0;
    for (const [name, now] of perAdapter) {
      const before = prev.perAdapter.get(name);
      if (!before) continue;
      // Counters reset when an adapter goes away; a negative delta is not a rate.
      const rate = {
        down: Math.max(0, (now.rx - before.rx) / seconds),
        up: Math.max(0, (now.tx - before.tx) / seconds),
      };
      rates[name] = rate;
      down += rate.down;
      up += rate.up;
    }
    this.adapterRates = rates;
    this.downloadRate = down;
    this.uploadRate = up;
    this.downHistory = pushCapped(this.downHistory, down);
    this.upHistory = pushCapped(this.upHistory, up);
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
