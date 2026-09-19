import { hostOf } from './links';

/**
 * Where the Browser module shows an address. Pure, for `npm test`.
 *
 * The module is an iframe in a panel because Seelen does not let a widget make
 * a webview of its own: `plugin:webview|create_webview` and
 * `create_webview_window` both answer "not allowed by ACL", probed from the
 * running widget on 2026-09-15. An iframe is only as good as the sites that
 * allow framing, and most large ones send `X-Frame-Options` or
 * `frame-ancestors`, which leaves WebView2's refusal page in the frame. The
 * parent cannot see that happen - the frame is cross-origin either way - so the
 * hosts below were measured instead (response headers, 2026-09-15), and each is
 * sent where it can actually be seen:
 *
 * - `page`: a copy of the page as it rendered, styles and images and all, with
 *   its scripts off (`snapshot.ts`). Articles, docs, stores, forums, code.
 * - `window`: an app behind a login, or a page that is nothing without its
 *   scripts - mail, maps, video, chat. It opens in a window of its own.
 *
 * Anything not listed is tried live. Wikipedia, Amazon, Microsoft, Bing's
 * results and YouTube's embed player all frame, as do most small sites and
 * anything on localhost. `reader`, the page as plain text, is only ever asked
 * for.
 */

export type PageMode = 'live' | 'page' | 'reader' | 'window';

export const REFUSES_FRAMING: Readonly<Record<string, 'page' | 'window'>> = {
  // A copy shows them well.
  'github.com': 'page',
  'news.ycombinator.com': 'page',
  // Its script-free results page, which the panel's searches are.
  'html.duckduckgo.com': 'page',
  'stackoverflow.com': 'page',
  'developer.mozilla.org': 'page',
  'npmjs.com': 'page',
  'medium.com': 'page',
  'nytimes.com': 'page',
  'theverge.com': 'page',
  'bbc.com': 'page',
  'apple.com': 'page',
  'spiegel.de': 'page',
  'heise.de': 'page',
  'tagesschau.de': 'page',
  'archive.ph': 'page',

  // Nothing without their scripts, or a login.
  'google.com': 'window',
  'youtube.com': 'window',
  'bing.com': 'window',
  'duckduckgo.com': 'window',
  'search.brave.com': 'window',
  'startpage.com': 'window',
  'ecosia.org': 'window',
  'mojeek.com': 'window',
  'kagi.com': 'window',
  'perplexity.ai': 'window',
  'chatgpt.com': 'window',
  'claude.ai': 'window',
  'x.com': 'window',
  'twitter.com': 'window',
  'facebook.com': 'window',
  'instagram.com': 'window',
  'linkedin.com': 'window',
  'twitch.tv': 'window',
  'netflix.com': 'window',
  'spotify.com': 'window',
  'discord.com': 'window',
  'notion.so': 'window',
  'openstreetmap.org': 'window',
  // Turns the reader away, so a copy is a block page.
  'reddit.com': 'window',
};

/** Longest first, so a subdomain listed on its own would win over its parent. */
const DOMAINS = Object.keys(REFUSES_FRAMING).sort((a, b) => b.length - a.length);

/** Pages on a refusing host that do frame. */
const FRAMES_ANYWAY: readonly (readonly [domain: string, path: RegExp])[] = [
  ['bing.com', /^\/search\b/],
  ['google.com', /^\/maps\/embed\b/],
  ['youtube.com', /^\/embed\//],
];

const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const isWeb = (u: URL) => u.protocol === 'http:' || u.protocol === 'https:';

/** Where a refusing host is sent instead, or null when it can be tried live. */
export function refusalFor(url: string): 'page' | 'window' | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (FRAMES_ANYWAY.some(([domain, path]) => within(host, domain) && path.test(u.pathname))) return null;
  const domain = DOMAINS.find((d) => within(host, d));
  return domain ? (REFUSES_FRAMING[domain] ?? null) : null;
}

/** `90`, `90s`, `1m30s` or `1h2m3s`, in seconds. */
function seconds(value: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * A YouTube video as its embed player, which frames where the watch page does
 * not. The no-cookie host because it is the one measured to frame.
 */
export function youtubeEmbed(url: string): string | null {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com') {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (/^\/(?:shorts|live)\/([\w-]+)/.exec(u.pathname)?.[1] ?? null);
  }
  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '');
  return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`;
}

export interface Route {
  /** The address as asked for: what the bar shows and a window opens. */
  url: string;
  /** What is actually loaded, which differs for a video. */
  load: string;
  /** `external` is anything that is not a web page, handed to the shell. */
  mode: PageMode | 'external';
}

/** What a page loads in a given mode: a video's player when live, the address itself otherwise. */
export function loadFor(url: string, mode: PageMode): string {
  return mode === 'live' ? (youtubeEmbed(url) ?? url) : url;
}

export function routeFor(url: string, preferReader = false): Route {
  if (!/^https?:\/\//i.test(url)) return { url, load: url, mode: 'external' };
  if (youtubeEmbed(url)) return { url, load: loadFor(url, 'live'), mode: 'live' };
  if (preferReader) return { url, load: url, mode: 'reader' };
  const mode = refusalFor(url) ?? 'live';
  return { url, load: loadFor(url, mode), mode };
}

/**
 * What the bar's view button turns a page into: a page that will not load live
 * into its copy, a copy into text, and text back into the page.
 */
export function nextMode(url: string, mode: PageMode): PageMode {
  if (mode === 'live' || mode === 'window') return 'page';
  if (mode === 'page') return 'reader';
  return routeFor(url).mode === 'live' ? 'live' : 'page';
}

/**
 * Where a link on a copied page leads. DuckDuckGo's redirect links are
 * unwrapped; anything but a web or mail address is dropped, so a page cannot
 * hand the shell a protocol of its choosing.
 */
export function linkDestination(href: string): string | null {
  const u = parse(href);
  if (!u) return null;
  if (u.protocol === 'mailto:') return u.href;
  if (!isWeb(u)) return null;
  if (within(u.hostname.toLowerCase(), 'duckduckgo.com') && u.pathname === '/l/') {
    const real = parse(u.searchParams.get('uddg') ?? '');
    if (real && isWeb(real)) return real.href;
  }
  return u.href;
}

/** The fragment a link scrolls to when it only moves within the page, or null when it leaves it. */
export function inPageTarget(href: string, page: string): string | null {
  const u = parse(href);
  const p = parse(page);
  if (!u || !p || u.hash.length < 2) return null;
  const fragment = decodeURIComponent(u.hash.slice(1));
  u.hash = '';
  p.hash = '';
  return u.href === p.href ? fragment : null;
}

/** Where a plain form goes: its action with its fields as the query. Null for one that posts. */
export function formDestination(action: string, method: string, fields: readonly (readonly [string, string])[]): string | null {
  if (method.toLowerCase() === 'post') return null;
  const u = parse(action);
  if (!u || !isWeb(u)) return null;
  u.search = new URLSearchParams(fields as [string, string][]).toString();
  u.hash = '';
  return u.href;
}

/**
 * The reader's Markdown, tidied for a narrow panel: images dropped, and the
 * empty links a page's icons and vote arrows leave behind, which would
 * otherwise print as `[](...)`.
 */
export function cleanReaderText(markdown: string, limit = 60_000): { text: string; truncated: boolean } {
  let text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = text.length > limit;
  if (truncated) {
    const paragraph = text.lastIndexOf('\n\n', limit);
    text = text.slice(0, paragraph > limit * 0.8 ? paragraph : limit).trimEnd();
  }
  return { text, truncated };
}

/** What the address bar shows while it is not being edited. */
export function addressLabel(url: string): string {
  return hostOf(url);
}
