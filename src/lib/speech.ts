/**
 * Text for the ear rather than the eye.
 *
 * A reply is written for the panel - Markdown, lists, links, the odd code
 * block - and read out as it stands it would be full of asterisks and URLs.
 * This turns it into what a person would say, cuts it into pieces while it is
 * still streaming so the first sentence is spoken before the last one is
 * written, and tidies what a recogniser hands back.
 *
 * Pure, like `markdown.ts`: no host, no audio, no Svelte, so `npm test` reads
 * it directly.
 */

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BLOCK_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

export const LANGUAGES: readonly { code: string; label: string; name: string }[] = [
  { code: '', label: 'Automatic', name: '' },
  { code: 'en', label: 'English', name: 'English' },
  { code: 'de', label: 'Deutsch', name: 'German' },
  { code: 'fr', label: 'Français', name: 'French' },
  { code: 'es', label: 'Español', name: 'Spanish' },
  { code: 'it', label: 'Italiano', name: 'Italian' },
  { code: 'pt', label: 'Português', name: 'Portuguese' },
  { code: 'nl', label: 'Nederlands', name: 'Dutch' },
  { code: 'pl', label: 'Polski', name: 'Polish' },
  { code: 'tr', label: 'Türkçe', name: 'Turkish' },
  { code: 'ja', label: '日本語', name: 'Japanese' },
  { code: 'zh', label: '中文', name: 'Chinese' },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? '';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Inline Markdown to plain words: a link is its text, a URL is its site. */
function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/<?(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])>?/g, (_, url: string) => hostOf(url))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s*(?:->|=>|→|⟶)\s*/g, ', ')
    .replace(EMOJI, '')
    .replace(/[*`|~]/g, '')
    .replace(/(\w)_(?=\w)/g, '$1 ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One complete line of a reply as it should be said; empty for a line that is not said at all. */
export function speakLine(line: string): string {
  if (!line.trim() || RULE.test(line) || TABLE_SEP.test(line) || TABLE_ROW.test(line) || FENCE.test(line)) return '';
  const structural = BLOCK_PREFIX.test(line);
  let text = inline(line.replace(BLOCK_PREFIX, ''));
  if (!text) return '';
  // A heading or a list item has no full stop of its own, and without one the
  // voice runs it straight into the next line.
  if (structural && /[\p{L}\p{N})"'”’]$/u.test(text)) text += '.';
  return text;
}

/** A whole reply as it should be said. Code blocks and tables are left to the panel. */
export function speakable(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const text = speakLine(line);
    if (text) out.push(text);
  }
  return out.join(' ');
}

const SENTENCE_END = /[.!?…。！？]+["'”’)\]]*(?=\s)/g;
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|vs|approx|mr|mrs|ms|dr|prof|st|z\.b|bzw|usw|ca|nr|inkl|evtl|ggf|d\.h|u\.a|sog|bspw)$/i;
const INITIAL = /(?:^|\s)\p{Lu}$/u;

/**
 * Where the last finished sentence in `text` ends, or 0.
 *
 * A full stop after a digit is not an end: it is a list number, a German
 * ordinal (`13. September`) or a decimal still arriving, and splitting there
 * reads the number as a sentence of its own. Nor is one that needs the next
 * character to decide (`3.` could become `3.5`), so an end is only an end once
 * whitespace follows it.
 */
export function lastSentenceEnd(text: string): number {
  let cut = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const at = match.index ?? 0;
    if (match[0].startsWith('.') && !match[0].startsWith('..')) {
      const before = text.slice(Math.max(0, at - 8), at);
      if (/\d$/.test(before) || ABBREVIATION.test(before) || INITIAL.test(before)) continue;
    }
    cut = at + match[0].length;
  }
  return cut;
}

/**
 * Cuts a streaming reply into pieces worth sending to a voice.
 *
 * The first piece goes as soon as it is one sentence, because it is the one
 * the listener is waiting in silence for. Later pieces gather to roughly
 * `target` characters: a voice reads a paragraph more naturally than a string
 * of one-sentence clips, and every piece is a request. `flush` hands out
 * whatever is left - at the end of the reply, and whenever the model stops
 * writing to use a tool, so a half-sentence is not held through the wait.
 */
export class SpeechChunker {
  #line = '';
  #pending = '';
  #fenced = false;
  #handedOut = 0;

  constructor(
    private readonly target = 90,
    private readonly limit = 320,
  ) {}

  push(delta: string): string[] {
    const out: string[] = [];
    this.#line += delta.replace(/\r/g, '');
    let nl: number;
    while ((nl = this.#line.indexOf('\n')) !== -1) {
      this.#completeLine(this.#line.slice(0, nl), out);
      this.#line = this.#line.slice(nl + 1);
    }
    // The line still arriving: its finished sentences can go now. One that may
    // yet turn out to be a fence or a table row waits for its newline.
    if (!this.#fenced && this.#line.trim() && !/^\s*[`~|]/.test(this.#line)) {
      const cut = lastSentenceEnd(this.#line);
      if (cut > 0) {
        this.#add(speakLine(this.#line.slice(0, cut)), out);
        this.#line = this.#line.slice(cut);
      }
    }
    return out;
  }

  flush(): string[] {
    const out: string[] = [];
    if (!this.#fenced) this.#add(speakLine(this.#line), out);
    this.#line = '';
    this.#fenced = false;
    this.#emit(out);
    return out;
  }

  #completeLine(line: string, out: string[]): void {
    if (FENCE.test(line)) {
      this.#fenced = !this.#fenced;
      return;
    }
    if (!this.#fenced) this.#add(speakLine(line), out);
  }

  #add(text: string, out: string[]): void {
    if (!text) return;
    this.#pending = this.#pending ? `${this.#pending} ${text}` : text;
    // A model that never ends a sentence still has to be spoken in pieces a
    // voice will take; cut at a comma where there is one.
    while (this.#pending.length > this.limit) {
      const head = this.#pending.slice(0, this.limit);
      const comma = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '));
      const space = head.lastIndexOf(' ');
      const cut = comma > this.limit / 2 ? comma + 1 : space > 0 ? space : this.limit;
      out.push(this.#pending.slice(0, cut).trim());
      this.#pending = this.#pending.slice(cut).trim();
      this.#handedOut++;
    }
    if (this.#pending.length >= (this.#handedOut ? this.target : 1)) this.#emit(out);
  }

  #emit(out: string[]): void {
    const text = this.#pending.trim();
    this.#pending = '';
    if (!text) return;
    out.push(text);
    this.#handedOut++;
  }
}

const NOISE =
  /^[\s.…,\-–—*]*$|^[[(]\s*(?:silence|no speech|inaudible|music|noise|blank[_ ]audio|stille|keine sprache|unverständlich|musik)\s*[\])]\.?$/i;

/**
 * A chat model given audio with no speech in it does not always stay silent:
 * measured on gemma4:12b with three seconds of faint noise, it answered "I'm
 * sorry, but I cannot fulfill this request. I am a text-based AI and cannot
 * hear or process audio files." That is not something the user said.
 */
const REFUSAL =
  /^(?:i'?m sorry|sorry|i am sorry|i cannot|i can'?t|i am unable|i'?m unable|as an ai|there is no (?:speech|audio)|no speech|es tut mir leid|leider kann ich|ich kann (?:keine|nicht|das)|es ist keine sprache)\b[\s\S]*\b(?:audio|speech|hear|transcri|sprache|hören|verarbeiten)/i;

function normalised(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * What a recogniser heard, without what it added.
 *
 * Measured on gemma4:12b through Ollama: a German clip came back as the same
 * sentence twice on two lines. A language model also likes to label its
 * output, quote it, or describe silence in brackets; Whisper servers mark
 * silence as `[BLANK_AUDIO]`. All of that is removed, and a transcript of
 * nothing is empty.
 */
export function cleanTranscript(raw: string): string {
  let text = raw
    .trim()
    .replace(/^(?:transcript(?:ion)?|transkript(?:ion)?)\s*:\s*/i, '')
    .replace(/\[(?:BLANK_AUDIO|silence|music|noise)\]/gi, ' ')
    .trim()
    .replace(/^["“„'«](.*)["”“'»]$/s, '$1')
    .trim();

  const lines: string[] = [];
  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    if (normalised(line) !== normalised(lines.at(-1) ?? '')) lines.push(line);
  }
  text = lines.join(' ');

  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [];
  if (sentences.length >= 2 && sentences.length % 2 === 0) {
    const half = sentences.length / 2;
    if (normalised(sentences.slice(0, half).join('')) === normalised(sentences.slice(half).join(''))) {
      text = sentences.slice(0, half).join('');
    }
  }

  text = text.replace(/\s+/g, ' ').trim();
  return NOISE.test(text) || REFUSAL.test(text) ? '' : text;
}

/** The instruction an audio-capable chat model is given to act as a recogniser. */
export function transcriptionPrompt(language: string): string {
  const name = languageName(language);
  return [
    `Transcribe the speech in this audio exactly as it is spoken, ${name ? `in ${name}` : 'in the language it is spoken in'}.`,
    'Output only the words that were said, with normal punctuation - no quotes, no labels, no translation, no commentary.',
    'If there is no speech, output nothing.',
  ].join(' ');
}

export type Approval = 'yes' | 'always' | 'no';

const SAID_NO = /\b(no|nope|nah|don'?t|do not|deny|cancel|stop|never|wait|nein|nee|nicht|abbrechen|stopp)\b/;
const SAID_ALWAYS = /\b(always|every time|immer)\b/;
const SAID_YES = /\b(yes|yeah|yep|yup|sure|ok|okay|allow|go ahead|do it|please do|confirm|fine|ja|jawohl|klar|genau|mach|erlauben|gerne?|passt)\b/;

/**
 * A spoken answer to an approval card. A refusal is looked for first, so
 * "don't do it" is not read as "do it".
 */
export function approvalAnswer(transcript: string): Approval | null {
  const text = ` ${transcript.toLowerCase().replace(/[^\p{L}\p{N}'\s]+/gu, ' ')} `;
  if (SAID_NO.test(text)) return 'no';
  if (SAID_ALWAYS.test(text)) return 'always';
  if (SAID_YES.test(text)) return 'yes';
  return null;
}

const LANGUAGE_MARKERS: readonly [string, RegExp][] = [
  ['en', /\b(the|and|is|are|you|it|not|to|of|for|with|what|how|this|that|yes|please|today|your|can|will)\b/g],
  ['de', /\b(und|der|die|das|ist|nicht|ich|du|sie|ein|eine|mit|auf|für|ja|nein|wie|was|bitte|danke|heute|dein|kann|wird|es|zu|den|dem)\b/g],
  ['fr', /\b(le|la|les|et|est|pas|je|vous|une|des|pour|avec|oui|merci|ce|que|qui|dans)\b/g],
  ['es', /\b(el|los|las|y|es|yo|usted|una|para|con|gracias|que|en|por)\b/g],
];

/**
 * The likeliest language of a reply, from its commonest little words.
 *
 * Crude, and enough for what it is for: picking a voice that can pronounce the
 * text, and telling a voice server that has to be told.
 */
export function guessLanguage(text: string, fallback = 'en'): string {
  const sample = ` ${text.toLowerCase().slice(0, 600)} `;
  let best = fallback;
  let score = 0;
  for (const [code, pattern] of LANGUAGE_MARKERS) {
    const hits = sample.match(pattern)?.length ?? 0;
    if (hits > score) {
      best = code;
      score = hits;
    }
  }
  return best;
}
