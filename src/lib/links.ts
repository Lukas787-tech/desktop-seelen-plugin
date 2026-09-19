/**
 * Search and address handling for the Links module. Pure, for `npm test`.
 */

export type EngineId = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage' | 'ecosia' | 'kagi';

export const ENGINES: Readonly<Record<EngineId, { label: string; url: string }>> = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { label: 'Brave', url: 'https://search.brave.com/search?q=' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  kagi: { label: 'Kagi', url: 'https://kagi.com/search?q=' },
};

/** `!yt cats` searches YouTube for cats, whichever engine is chosen. */
export const BANGS: Readonly<Record<string, { label: string; url: string }>> = {
  g: ENGINES.google,
  ddg: ENGINES.duckduckgo,
  b: ENGINES.bing,
  brave: ENGINES.brave,
  yt: { label: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  gh: { label: 'GitHub', url: 'https://github.com/search?q=' },
  w: { label: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' },
  wde: { label: 'Wikipedia (de)', url: 'https://de.wikipedia.org/w/index.php?search=' },
  maps: { label: 'Maps', url: 'https://www.google.com/maps/search/' },
  r: { label: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
  a: { label: 'Amazon', url: 'https://www.amazon.com/s?k=' },
  so: { label: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
  npm: { label: 'npm', url: 'https://www.npmjs.com/search?q=' },
  tr: { label: 'Translate', url: 'https://translate.google.com/?sl=auto&tl=en&text=' },
  img: { label: 'Images', url: 'https://www.google.com/search?tbm=isch&q=' },
};

/**
 * An address a person typed, made openable: a scheme where there was none.
 * Returns null for anything that is not shaped like an address, which is what
 * sends it to a search instead.
 */
export function asUrl(text: string): string | null {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^(https?|ftp|file|mailto|steam|spotify|obsidian|vscode):/i.test(value)) return value;
  // localhost, an IP, or a dotted host - with an optional port and path.
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[\w-]+)*\.[a-z]{2,})(:\d{1,5})?([/?#]\S*)?$/i.test(value)) {
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})/i.test(value);
    return `${local ? 'http' : 'https'}://${value}`;
  }
  return null;
}

export interface Resolved {
  url: string;
  /** What the panel says it will do, e.g. `YouTube: cats` or the address itself. */
  label: string;
  kind: 'address' | 'search';
}

export function resolveQuery(text: string, engine: EngineId): Resolved | null {
  const value = text.trim();
  if (!value) return null;

  const bang = /^!(\w+)\s+(.+)$/.exec(value) ?? /^(.+?)\s+!(\w+)$/.exec(value)?.slice(0).reverse();
  if (bang) {
    // The reversed match puts the bang first either way: [_, name, query].
    const [name, query] = value.startsWith('!') ? [bang[1], bang[2]] : [bang[0], bang[1]];
    const target = BANGS[(name as string).toLowerCase()];
    if (target && query) {
      return { url: target.url + encodeURIComponent(query.trim()), label: `${target.label}: ${query.trim()}`, kind: 'search' };
    }
  }

  const address = asUrl(value);
  if (address) return { url: address, label: address.replace(/^https?:\/\//, ''), kind: 'address' };

  const chosen = ENGINES[engine] ?? ENGINES.google;
  return { url: chosen.url + encodeURIComponent(value), label: `${chosen.label}: ${value}`, kind: 'search' };
}

/** The host part of an address, for a favicon and a fallback name. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^\w+:\/\//, '').split(/[/?#]/)[0] ?? url;
  }
}

/** A readable name for a bookmark nobody named: `github.com` becomes `GitHub`-ish `Github`. */
export function nameFor(url: string): string {
  const host = hostOf(url);
  const parts = host.split('.');
  const main = parts.length > 2 && parts[parts.length - 2]!.length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  const word = main ?? host;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
