/**
 * A page the Browser module cannot frame, shown as a copy rather than as text.
 *
 * r.jina.ai opens the page in a browser of its own, lets its scripts run and
 * returns the DOM they left (`X-Return-Format: html`). Put into a frame under a
 * `<base>`, that is the page as it looked - its stylesheets, fonts and images
 * load from the site as they would anywhere - with none of its behaviour: the
 * frame is sandboxed without `allow-scripts`, so nothing on it runs. What still
 * works on a static page, links and plain forms, the panel catches and routes
 * like anything typed into the bar (`browser.svelte.ts`).
 *
 * `allow-same-origin` is what lets the panel reach into the copy to catch those
 * clicks, and it is safe only because scripts stay off: a frame given both
 * flags could reach back into the surface itself.
 */

export const SNAPSHOT_SANDBOX = 'allow-same-origin allow-forms';

/** Everything that would run, fetch on its own, or move the frame somewhere else. */
const STRIP = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'base',
  'meta[http-equiv]',
  'link[rel~="preload"]',
  'link[rel~="modulepreload"]',
  'link[rel~="prefetch"]',
  'link[rel~="prerender"]',
  'link[rel~="manifest"]',
].join(', ');

export function snapshotDocument(html: string, base: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll(STRIP)) el.remove();
  // With scripts off, what the page wrote for that case is what should show.
  for (const el of doc.querySelectorAll('noscript')) el.replaceWith(...el.childNodes);
  // Images a script would have swapped in as they scrolled into view.
  for (const el of doc.querySelectorAll('[data-src]')) {
    const src = el.getAttribute('src');
    if (!src || src.startsWith('data:')) el.setAttribute('src', el.getAttribute('data-src') ?? '');
  }
  for (const el of doc.querySelectorAll('[data-srcset]')) {
    if (!el.getAttribute('srcset')) el.setAttribute('srcset', el.getAttribute('data-srcset') ?? '');
  }
  const baseElement = doc.createElement('base');
  baseElement.href = base;
  // Hotlink protection turns away a referrer it does not know, and lets none through.
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.prepend(referrer, baseElement);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
