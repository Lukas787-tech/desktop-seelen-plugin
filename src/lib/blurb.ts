/**
 * Descriptions for the game library, written by a model.
 *
 * Detection gives a library of names and paths and nothing else - no store
 * tells a widget what a game *is* - so the launcher had a shelf of titles with
 * no way to answer "what is this one?". A model already knows most of them, so
 * it is asked, once, for the whole library at a time.
 *
 * The pure half: the prompt, and reading the answer back. The request itself is
 * `blurbs.svelte.ts`, which borrows the assistant's services exactly as the AI
 * appearance designer does.
 *
 * ## The one rule that matters
 *
 * **A model must not invent a game.** Half a detected library is folder names,
 * installers and things that are not games at all, and a model asked to
 * describe `setup_v2_final` will happily oblige. So the prompt demands an empty
 * string for anything it does not actually recognise, and `parseBlurbs` drops
 * every empty answer rather than storing it. A missing description is correct;
 * a confident wrong one is not.
 */

/** One entry to describe: what it is called, and where it came from. */
export interface BlurbRequest {
  /** The key it is stored and matched under - see `blurbKey`. */
  key: string;
  name: string;
  /** The store's label, which disambiguates a name two games share. */
  launcher?: string;
}

export interface Blurb {
  /** One or two sentences. Empty is never stored. */
  text: string;
  /** When it was written, so a stale library can be refreshed. */
  at: number;
}

/** Longer than this is a paragraph, not a caption, and the pane has no room. */
export const MAX_BLURB = 240;

/**
 * How a game is matched to its description.
 *
 * The display name, folded: a rescan can renumber ids and rewrite targets, and
 * a description is about the *game*, so it should survive both. Punctuation and
 * spacing go because `Hades II`, `Hades 2` and `hades-ii` are one game to a
 * reader and the model answers with whichever it prefers.
 */
export function blurbKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function buildBlurbPrompt(games: readonly BlurbRequest[]): {
  system: string;
  user: string;
} {
  const system = [
    'You write one-line descriptions of video games for a living-room game launcher.',
    '',
    'Rules:',
    '- One or two short sentences per game, at most 30 words. Say what kind of game it is and what the player does.',
    '- Plain text. No Markdown, no quotes around the description, no title repeated back.',
    '- Write in English.',
    '- If you do not genuinely recognise the title, return an empty string for it. Many entries in this list are not games at all - installers, folders, tools. Never guess, never invent a game, and never describe something generically to fill the gap. An empty string is the correct answer and is expected for several entries.',
    '',
    'Answer with JSON only, in exactly this shape:',
    '{"games":[{"key":"<the key you were given>","text":"<description or empty string>"}]}',
  ].join('\n');

  const list = games
    .map((game) => `- key: ${game.key} | title: ${game.name}${game.launcher ? ` | store: ${game.launcher}` : ''}`)
    .join('\n');

  const user = `Describe each of these ${games.length} entries:\n\n${list}`;
  return { system, user };
}

export interface ParsedBlurbs {
  ok: boolean;
  error?: string;
  /** Only the entries the model actually recognised. */
  blurbs: Record<string, string>;
  /** Keys it was asked about and returned nothing for. */
  unknown: string[];
}

/** Strips the wrapping a chatty model puts round its JSON. */
function jsonOf(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** A description, cleaned of the things a model adds without being asked. */
export function cleanBlurb(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let text = raw
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A model that answers `"Factorio: a factory builder"` or wraps the lot in
  // quotation marks, which both read as a mistake in a caption.
  text = text.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (!text) return '';
  // Refusals and non-answers arrive as prose; they are not descriptions.
  if (/^(i (do not|don't|cannot|can't)|unknown|n\/?a|no description|not a game)\b/i.test(text)) return '';
  if (text.length > MAX_BLURB) {
    const cut = text.slice(0, MAX_BLURB);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = stop > 60 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
  }
  return text;
}

/**
 * Reads the model's answer, keeping only what was asked for and recognised.
 *
 * Keys the model invented are dropped: it is answering about a library it was
 * handed, and an entry that was not in it is not an answer to anything.
 */
export function parseBlurbs(text: string, asked: readonly string[]): ParsedBlurbs {
  const wanted = new Set(asked);
  const data = jsonOf(text);
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'The model did not answer with JSON.', blurbs: {}, unknown: [...wanted] };
  }

  const rows = (data as { games?: unknown }).games;
  const blurbs: Record<string, string> = {};

  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const key = (row as { key?: unknown }).key;
      if (typeof key !== 'string' || !wanted.has(key)) continue;
      const cleaned = cleanBlurb((row as { text?: unknown }).text);
      if (cleaned) blurbs[key] = cleaned;
    }
  } else {
    // A model that answers with a plain object of key to text rather than the
    // array it was asked for; the content is right, so it is taken.
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!wanted.has(key)) continue;
      const cleaned = cleanBlurb(value);
      if (cleaned) blurbs[key] = cleaned;
    }
  }

  const unknown = [...wanted].filter((key) => !blurbs[key]);
  if (!Object.keys(blurbs).length) {
    return { ok: false, error: 'The model recognised none of them.', blurbs: {}, unknown };
  }
  return { ok: true, blurbs, unknown };
}

/**
 * The library, cut into requests.
 *
 * One request for two hundred games would be a long answer to wait for and an
 * easy one to have truncated; a batch at a time also means a failure halfway
 * through keeps what came before it.
 */
export function batchGames<T>(games: readonly T[], size = 30): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < games.length; i += Math.max(1, size)) {
    batches.push(games.slice(i, i + Math.max(1, size)));
  }
  return batches;
}
