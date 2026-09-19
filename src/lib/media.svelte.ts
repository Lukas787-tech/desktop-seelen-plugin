import { SeelenCommand, SeelenEvent, invoke, subscribe, type UnSubscriber } from './seelen';
import { coalesced } from './live.svelte';
import type {
  AudioWaveform,
  MediaDevice,
  MediaDeviceSession,
  MediaPlayer,
} from '@seelen-ui/lib/types';

/**
 * Live media and audio state from the host.
 *
 * Everything here is event-driven: Seelen already polls the system on a shared
 * interval and pushes changes, so this surface adds no polling of its own.
 */
class MediaStore {
  players = $state<MediaPlayer[]>([]);
  outputs = $state<MediaDevice[]>([]);
  inputs = $state<MediaDevice[]>([]);

  #users = 0;
  #generation = 0;
  #offs: UnSubscriber[] = [];

  /**
   * Starts (or joins) the live media state; call the result to release it.
   *
   * The surface used to `start()` this for every display at launch, whether a
   * media panel was shown or not - and a playing track sends a sessions event
   * each time its timeline moves, so both replicas took a stream of updates
   * nothing on screen read for as long as music played. It now runs only while
   * the Media panel or the palette holds it.
   */
  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) {
      const mine = ++this.#generation;
      void this.start().then(
        (offs) => {
          if (mine === this.#generation) this.#offs.push(...offs);
          else for (const off of offs) off();
        },
        (err) => console.error('[media] could not start', err),
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
    };
  }

  /** The session the transport controls act on. */
  get activePlayer(): MediaPlayer | null {
    return this.players.find((p) => p.default) ?? this.players.find((p) => p.playing) ?? this.players[0] ?? null;
  }

  get defaultOutput(): MediaDevice | null {
    return this.outputs.find((d) => d.isDefaultMultimedia) ?? this.outputs[0] ?? null;
  }

  async start(): Promise<UnSubscriber[]> {
    const [players, devices] = await Promise.all([
      invoke(SeelenCommand.GetMediaSessions).catch((e) => {
        console.error('[media] sessions unavailable', e);
        return [] as MediaPlayer[];
      }),
      invoke(SeelenCommand.GetMediaDevices).catch((e) => {
        console.error('[media] devices unavailable', e);
        return [[], []] as [MediaDevice[], MediaDevice[]];
      }),
    ]);
    this.players = players;
    this.#applyDevices(devices);

    return Promise.all([
      subscribe(SeelenEvent.MediaSessions, (e) => {
        this.players = e.payload;
      }),
      subscribe(SeelenEvent.MediaDevices, (e) => {
        this.#applyDevices(e.payload);
      }),
    ]);
  }

  #applyDevices(payload: [MediaDevice[], MediaDevice[]]): void {
    // The host sends a pair of device arrays, but their order is not something
    // to rely on: on this machine the first array held a device whose own
    // `type` was "input" (Stereo Mix). Split on the device's declared type
    // instead, which is correct whichever way round the pair arrives.
    const all = [...(payload[0] ?? []), ...(payload[1] ?? [])];
    const seen = new Set<string>();
    const unique = all.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
    this.outputs = unique.filter((d) => d.type === 'output');
    this.inputs = unique.filter((d) => d.type === 'input');

    // Loopback devices such as Stereo Mix report themselves as inputs while
    // still carrying every playback session. If nothing identifies as an
    // output, fall back to whatever actually has sessions so the mixer works.
    if (this.outputs.length === 0) {
      this.outputs = unique.filter((d) => d.sessions.length > 0);
    }
  }

  // --- transport -----------------------------------------------------------
  // Each command targets one player by its `umid`, so transport acts on the
  // active session rather than "whatever is playing". There is no seek command
  // in the host API, so the progress bar stays display-only.

  togglePlayPause(): void {
    const id = this.activePlayer?.umid;
    if (!id) return;
    void invoke(SeelenCommand.MediaTogglePlayPause, { id }).catch((err) =>
      console.error('[media] play/pause failed', err),
    );
  }

  next(): void {
    const id = this.activePlayer?.umid;
    if (!id) return;
    void invoke(SeelenCommand.MediaNext, { id }).catch((err) =>
      console.error('[media] next failed', err),
    );
  }

  previous(): void {
    const id = this.activePlayer?.umid;
    if (!id) return;
    void invoke(SeelenCommand.MediaPrev, { id }).catch((err) =>
      console.error('[media] previous failed', err),
    );
  }

  // --- volume --------------------------------------------------------------

  /** Sets device volume, or one application's volume when `sessionId` is given. */
  setVolume(deviceId: string, level: number, sessionId: string | null = null): void {
    const clamped = Math.min(1, Math.max(0, level));
    sendVolume(`${deviceId}|${sessionId ?? ''}`, () =>
      invoke(SeelenCommand.SetVolumeLevel, { deviceId, sessionId, level: clamped }),
    );
  }

  toggleMute(deviceId: string, sessionId: string | null = null): void {
    void invoke(SeelenCommand.MediaToggleMute, { deviceId, sessionId }).catch((err) =>
      console.error('[media] toggle mute failed', err),
    );
  }

  /** Switches the system default output. `multimedia` is the role users mean. */
  setDefaultOutput(id: string): void {
    void invoke(SeelenCommand.MediaSetDefaultDevice, { id, role: 'multimedia' }).catch((err) =>
      console.error('[media] set default device failed', err),
    );
  }
}

/** Volume levels per device and session; see `coalesced`. */
const sendVolume = coalesced('media');

export const media = new MediaStore();

/**
 * Waveform data for the visualiser.
 *
 * Kept separate and subscribed on demand: it is a high-frequency stream, so it
 * should only run while something is actually drawing it.
 */
export function subscribeWaveform(cb: (wave: AudioWaveform) => void): Promise<UnSubscriber> {
  return subscribe(SeelenEvent.MediaWaveform, (e) => cb(e.payload));
}

/**
 * Display name for a mixer row.
 *
 * The host reports the system-sounds session with `isSystem` and the literal
 * name "???", and some apps report nothing at all; fall back to the executable
 * name before giving up.
 */
export function sessionLabel(session: MediaDeviceSession): string {
  if (session.isSystem) return 'System sounds';
  const name = session.name?.trim();
  if (name && name !== '???') return name;
  // Both separators: the path is a Windows one, and splitting on `/` alone
  // labelled every such row with the whole executable path.
  const exe = session.iconPath?.split(/[\\/]/).pop();
  if (exe) return exe.replace(/\.exe$/i, '');
  return 'Unknown application';
}

/** Timeline values arrive in nanoseconds. */
export function nanosToSeconds(nanos: number): number {
  return nanos / 1_000_000_000;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
