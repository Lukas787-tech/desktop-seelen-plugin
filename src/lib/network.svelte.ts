import { hostValue, tell } from './live.svelte';
import { noteError } from './diagnostics';
import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import type { NetworkAdapter, WlanBssEntry } from '@seelen-ui/lib/types';

/** Whether the machine can actually reach the internet, not merely a link. */
export const internetConnected = hostValue<boolean>({
  label: 'network',
  initial: false,
  load: () => invoke(SeelenCommand.GetNetworkInternetConnection),
  listen: (apply) => subscribe(SeelenEvent.NetworkInternetConnection, (e) => apply(e.payload)),
});

/** The address of the adapter the default route goes out of. */
export const localIp = hostValue<string>({
  label: 'network',
  initial: '',
  load: () => invoke(SeelenCommand.GetNetworkDefaultLocalIp),
  listen: (apply) => subscribe(SeelenEvent.NetworkDefaultLocalIp, (e) => apply(e.payload)),
});

export const adapters = hostValue<NetworkAdapter[]>({
  label: 'network',
  initial: [],
  load: () => invoke(SeelenCommand.GetNetworkAdapters),
  listen: (apply) => subscribe(SeelenEvent.NetworkAdapters, (e) => apply(e.payload)),
});

/**
 * Nearby wireless networks.
 *
 * Unlike everything else here there is no command that returns the current
 * list: `wlan_scan` starts a scan and the results arrive later on
 * `wlan-scanned`, so this holds the last set the host sent rather than reading
 * one on demand.
 */
class WlanScanner {
  entries = $state<WlanBssEntry[]>([]);
  scanning = $state(false);

  #users = 0;
  #generation = 0;
  #off: UnSubscriber | null = null;

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) this.#start(++this.#generation);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      this.#generation++;
      this.#off?.();
      this.#off = null;
      this.entries = [];
      this.scanning = false;
    };
  }

  /** Asks the host to scan; results arrive on the event, not from this call. */
  scan(): void {
    this.scanning = true;
    invoke(SeelenCommand.WlanScan)
      .catch((err) => {
        console.error('[wlan] scan failed', err);
        noteError(`wlan: ${err instanceof Error ? err.message : String(err)}`);
      })
      // The host answers when the scan has been *started*; a radio that is off
      // never sends results, so the spinner has to stop on its own.
      .finally(() => setTimeout(() => (this.scanning = false), 4000));
  }

  connect(ssid: string, password: string | null): void {
    tell('wlan', invoke(SeelenCommand.WlanConnect, { ssid, password, hidden: false }));
  }

  disconnect(): void {
    tell('wlan', invoke(SeelenCommand.WlanDisconnect));
  }

  forget(ssid: string): void {
    tell('wlan', invoke(SeelenCommand.WlanForget, { ssid }));
  }

  #start(mine: number): void {
    void (async () => {
      try {
        const off = await subscribe(SeelenEvent.NetworkWlanScanned, (e) => {
          if (mine !== this.#generation) return;
          this.entries = e.payload;
          this.scanning = false;
        });
        if (mine === this.#generation) this.#off = off;
        else off();
      } catch (err) {
        console.error('[wlan] could not watch scan results', err);
      }
      if (mine === this.#generation) this.scan();
    })();
  }
}

export const wlan = new WlanScanner();

/**
 * One row per network name, strongest signal first.
 *
 * A scan reports every access point separately, so a mesh or a repeater puts
 * the same SSID on screen several times - and, being keyed by name, would tear
 * the list down at runtime. Hidden networks (no SSID) are dropped: there is
 * nothing to show and nothing useful to do with them here.
 */
export function uniqueNetworks(entries: readonly WlanBssEntry[]): WlanBssEntry[] {
  const best = new Map<string, WlanBssEntry>();
  for (const entry of entries) {
    if (!entry.ssid) continue;
    const seen = best.get(entry.ssid);
    if (!seen || entry.signal > seen.signal || (entry.connected && !seen.connected)) {
      best.set(entry.ssid, entry);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return b.signal - a.signal;
  });
}

/** Signal as a 0-4 bar count, the way Windows draws it. */
export function signalBars(signal: number): number {
  return Math.max(0, Math.min(4, Math.round((signal / 100) * 4)));
}
