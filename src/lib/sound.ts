/**
 * Short synthesised tones for the modules that need to be heard.
 *
 * WebAudio oscillators rather than a sound file, as the Timer module already
 * does: nothing to ship, nothing to load, and no audio context is kept alive
 * between rings - each one is created, played and closed.
 */

export type ChimeKind = 'soft' | 'done' | 'alarm';

const PATTERNS: Record<ChimeKind, readonly (readonly [frequency: number, at: number, length: number])[]> = {
  soft: [[880, 0, 0.3]],
  done: [
    [880, 0, 0.22],
    [1320, 0.25, 0.26],
  ],
  alarm: [
    [988, 0, 0.16],
    [1319, 0.18, 0.16],
    [1568, 0.36, 0.3],
  ],
};

/** Plays one ring. `volume` is 0-1. */
export function chime(kind: ChimeKind = 'soft', volume = 0.6): void {
  try {
    const context = new AudioContext();
    const start = context.currentTime + 0.02;
    const peak = Math.max(0.0002, Math.min(1, volume) * 0.3);
    let end = 0;
    for (const [frequency, at, length] of PATTERNS[kind]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(peak, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
      osc.connect(gain).connect(context.destination);
      osc.start(start + at);
      osc.stop(start + at + length + 0.02);
      end = Math.max(end, at + length);
    }
    setTimeout(() => void context.close().catch(() => {}), (end + 0.5) * 1000);
  } catch (err) {
    // No output device is not worth failing an alarm over; the banner still shows.
    console.error('[sound] could not play', err);
  }
}

/**
 * Rings `times` times, a little apart, until stopped.
 *
 * Returns the way to stop it early - what "Dismiss" calls.
 */
export function ring(kind: ChimeKind, times: number, volume = 0.6, gapMs = 1600): () => void {
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const next = () => {
    if (count >= times) return;
    count++;
    chime(kind, volume);
    timer = setTimeout(next, gapMs);
  };
  next();
  return () => {
    count = times;
    clearTimeout(timer);
  };
}
