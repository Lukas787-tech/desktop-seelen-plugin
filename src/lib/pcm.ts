/**
 * Raw audio, as numbers: levels, resampling and WAV files.
 *
 * The microphone delivers 32-bit float frames at the device's rate (48 kHz
 * here); every recogniser this panel talks to takes a 16 kHz mono WAV, and
 * Gemma's audio encoder takes nothing else. Encoding it ourselves rather than
 * using `MediaRecorder` means one format that every engine accepts, with no
 * container a server has to shell out to ffmpeg for.
 *
 * Pure, so `npm test` can check a header byte by byte.
 */

/** The level of one frame in dBFS; -100 for digital silence. */
export function levelDb(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += (frame[i] as number) ** 2;
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms > 1e-5 ? 20 * Math.log10(rms) : -100;
}

export function concat(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Changes the sample rate with a windowed-sinc filter.
 *
 * Going from 48 kHz to 16 kHz by picking every third sample folds everything
 * between 8 and 24 kHz - sibilants, fan noise - back into the band a
 * recogniser listens to. The kernel is tabulated once per call, so a
 * 30-second clip costs tens of milliseconds.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !input.length) return input.slice();
  const ratio = from / to;
  // Cutoff as a fraction of the input's Nyquist frequency, just under the
  // output's, so the transition band stays out of the kept audio.
  const cutoff = Math.min(1, 1 / ratio) * 0.9;
  const half = Math.ceil(8 / cutoff);
  const STEPS = 64;
  const table = new Float32Array(half * STEPS + 2);
  for (let k = 0; k < table.length; k++) {
    const x = k / STEPS;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
    const window = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, x / half));
    table[k] = sinc * window;
  }

  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const center = i * ratio;
    const lo = Math.max(0, Math.ceil(center - half));
    const hi = Math.min(input.length - 1, Math.floor(center + half));
    let sum = 0;
    let weights = 0;
    for (let j = lo; j <= hi; j++) {
      const weight = table[Math.round(Math.abs(j - center) * STEPS)] ?? 0;
      sum += (input[j] as number) * weight;
      weights += weight;
    }
    out[i] = weights ? sum / weights : 0;
  }
  return out;
}

/**
 * Brings a quiet recording up towards `peak`, never by more than `maxGain` and
 * never down. A laptop microphone across a desk can arrive 20 dB under a
 * headset, and a recogniser hears that as mumbling.
 */
export function normalise(samples: Float32Array, peak = 0.9, maxGain = 6): Float32Array {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i] as number));
  if (!max) return samples;
  const gain = Math.min(maxGain, peak / max);
  return gain <= 1 ? samples : samples.map((s) => s * gain);
}

function header(view: DataView, dataBytes: number, sampleRate: number): void {
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  header(view, samples.length * 2, sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Wraps bare little-endian 16-bit PCM - what Gemini's voices return - so a browser can decode it. */
export function wrapPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const length = pcm.length - (pcm.length % 2);
  const bytes = new Uint8Array(44 + length);
  header(new DataView(bytes.buffer), length, sampleRate);
  bytes.set(pcm.subarray(0, length), 44);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
