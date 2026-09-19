import { config } from './config.svelte';
import { chat } from './chat.svelte';
import { noteAction, noteError } from './diagnostics';
import { newId } from './ids';
import { launch } from './launch.svelte';
import { ENGINES, hostOf, resolveQuery } from './links';
import { debouncedWriter, readJson } from './persist';
import { SeelenCommand, Widget, invoke } from './seelen';
import { snapshotDocument } from './snapshot';
import { readPage, renderPage } from './web';
import {
  addressLabel,
  cleanReaderText,
  formDestination,
  inPageTarget,
  linkDestination,
  loadFor,
  nextMode,
  routeFor,
  type PageMode,
} from './browser';

/**
 * The Browser module's pages: a history per display, and what is on screen.
 *
 * A live page is an iframe, and an iframe's own navigation is out of reach -
 * the frame is cross-origin, so its address cannot be read. What this document
 * does see is the frame's `load` event, and the joint session history the frame
 * writes into, which `history.back()` here walks. So Back first undoes the
 * pages the frame went to by itself, counted from its loads, and then the ones
 * opened from the bar. A page that changes its address without loading - a
 * single-page app - is not counted, and Back goes straight to the entry before.
 *
 * That walk is the one dangerous thing here: the joint history also holds this
 * surface's own entries, so a Back with no frame entry left to undo would
 * navigate the desktop itself away. Every count is capped by how far
 * `history.length` has actually grown since the frame's first load.
 *
 * A copy (`snapshot.ts`) has none of that: it never navigates, because the
 * panel catches its links and opens them as entries of their own.
 */

export type Entry =
  | { id: string; kind: 'page'; url: string; load: string; mode: PageMode }
  | { id: string; kind: 'search'; query: string };

export type View =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'page'; title: string; base: string; srcdoc: string }
  | { status: 'reader'; title: string; text: string; truncated: boolean }
  | { status: 'error'; message: string };

const MAX_ENTRIES = 30;

/** The saved history's shape. Version 1 predates copies, when a refusing site was saved as text. */
const VERSION = 2;

/** Searches are DuckDuckGo's script-free results page, shown as a copy like any other page. */
const SEARCH = 'https://html.duckduckgo.com/html/?q=';

/** Edge's app mode is the page and a title bar, nothing else; Edge ships with Windows, here. */
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function isEntry(value: unknown): value is Entry {
  const entry = value as Entry | null;
  if (!entry || typeof entry.id !== 'string') return false;
  if (entry.kind === 'search') return typeof entry.query === 'string';
  return (
    entry.kind === 'page' &&
    typeof entry.url === 'string' &&
    typeof entry.load === 'string' &&
    ['live', 'page', 'reader', 'window'].includes(entry.mode)
  );
}

/** A page saved before copies existed, routed again. */
function migrate(entry: Entry): Entry {
  if (entry.kind !== 'page') return entry;
  const route = routeFor(entry.url);
  return route.mode === 'external' ? entry : { ...entry, load: route.load, mode: route.mode };
}

function sameTarget(a: Entry, b: Entry): boolean {
  if (a.kind === 'page' && b.kind === 'page') return a.url === b.url && a.mode === b.mode;
  if (a.kind === 'search' && b.kind === 'search') return a.query === b.query;
  return false;
}

function failure(err: unknown, what: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b429\b/.test(message)) return 'The reader is busy - it takes a few pages a minute without a key. Try again shortly.';
  return `This ${what} could not be loaded here.`;
}

class BrowserSession {
  entries = $state<Entry[]>([]);
  index = $state(-1);
  view = $state<View>({ status: 'idle' });

  /** Pages the live frame went to by itself, which Back and Forward walk before the entries. */
  #frameBack = $state(0);
  #frameForward = $state(0);
  /** Set while a newly mounted frame has yet to load its first page. */
  #firstLoad = false;
  /** `history.length` when the frame's first page loaded: where its own entries begin. */
  #frameStart = 0;
  /** Loads caused by stepping through the frame's history, rather than by the page. */
  #stepLoads = 0;

  #users = 0;
  #restored: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #writer: ReturnType<typeof debouncedWriter> | null = null;

  get current(): Entry | null {
    return this.entries[this.index] ?? null;
  }

  get canBack(): boolean {
    return this.#frameBack > 0 || this.index > 0;
  }

  get canForward(): boolean {
    return this.#frameForward > 0 || this.index < this.entries.length - 1;
  }

  /** What a window opens for the current entry: the page, or the search on DuckDuckGo. */
  get address(): string | null {
    const entry = this.current;
    if (!entry) return null;
    return entry.kind === 'page' ? entry.url : ENGINES.duckduckgo.url + encodeURIComponent(entry.query);
  }

  acquire(): () => void {
    this.#users++;
    if (this.#users === 1) {
      this.#restored ??= this.#restore();
      void this.#restored.then(() => {
        // A panel switched off and on again keeps a page it had already shown.
        if (this.#users > 0 && this.view.status === 'idle') this.#show();
      });
    }
    return () => {
      this.#users--;
      if (this.#users > 0) return;
      this.#abort?.abort();
      this.#abort = null;
      if (this.view.status === 'loading') this.view = { status: 'idle' };
      void this.#writer?.flush();
    };
  }

  async #restore(): Promise<void> {
    const own = (Widget.self.decoded.monitorId ?? 'primary').replace(/[^A-Za-z0-9._-]/g, '_');
    const filename = `browser-${own}.json`;
    this.#writer = debouncedWriter(filename, 600);
    const saved = await readJson<{ version?: number; entries?: unknown[]; index?: number }>(filename, {});
    // Anything opened while the file was being read wins over what it held.
    if (this.entries.length || !Array.isArray(saved.entries)) return;
    let entries = saved.entries.filter(isEntry).slice(-MAX_ENTRIES);
    if (saved.version !== VERSION) entries = entries.map(migrate);
    if (!entries.length) return;
    this.entries = entries;
    this.index = Math.min(Math.max(0, saved.index ?? entries.length - 1), entries.length - 1);
  }

  /** What was typed into the bar: an address or a bang that names a site is a page, plain words a search. */
  go(text: string): void {
    const resolved = resolveQuery(text, 'duckduckgo');
    if (!resolved) return;
    if (resolved.kind === 'address' || !resolved.url.startsWith(ENGINES.duckduckgo.url)) {
      this.open(resolved.url);
      return;
    }
    this.#push({ id: newId('search'), kind: 'search', query: text.trim() });
  }

  open(url: string): void {
    const route = routeFor(url, config.current.browserReader);
    if (route.mode === 'external') {
      void launch(route.url, 'url');
      return;
    }
    this.#push({ id: newId('page'), kind: 'page', url: route.url, load: route.load, mode: route.mode });
  }

  /** The bar's view button: live to copy, copy to text, text back to the page (`nextMode`). */
  toggleView(): void {
    const entry = this.current;
    if (entry?.kind !== 'page') return;
    const mode = nextMode(entry.url, entry.mode);
    this.#replace({ ...entry, id: newId('page'), mode, load: loadFor(entry.url, mode) });
  }

  back(): void {
    if (this.#frameBack > 0 && history.length > this.#frameStart) {
      this.#frameBack--;
      this.#frameForward++;
      this.#stepLoads++;
      history.back();
      return;
    }
    if (this.index <= 0) return;
    this.index--;
    this.#show();
    this.#save();
  }

  forward(): void {
    if (this.#frameForward > 0) {
      this.#frameForward--;
      this.#frameBack++;
      this.#stepLoads++;
      history.forward();
      return;
    }
    if (this.index >= this.entries.length - 1) return;
    this.index++;
    this.#show();
    this.#save();
  }

  /** The live frame finished loading something. */
  frameLoaded(): void {
    if (this.#firstLoad) {
      this.#firstLoad = false;
      this.#frameStart = history.length;
      if (this.view.status === 'loading') this.view = { status: 'idle' };
      return;
    }
    if (this.#stepLoads > 0) {
      this.#stepLoads--;
      return;
    }
    // A page the frame went to by itself: a link, a form. A redirect or a
    // reload loads without adding an entry, hence the cap.
    this.#frameBack = Math.min(this.#frameBack + 1, Math.max(0, history.length - this.#frameStart));
    this.#frameForward = 0;
  }

  /**
   * A copy has loaded: catch what still works on it - links and plain forms -
   * and route it like anything typed into the bar. Middle- or Ctrl-clicking a
   * link opens it in a window instead.
   */
  copyLoaded(frame: HTMLIFrameElement): void {
    const doc = frame.contentDocument;
    if (!doc || this.view.status !== 'page') return;
    const page = this.view.base;
    doc.addEventListener('click', (event) => this.#follow(event, doc, page), true);
    doc.addEventListener(
      'auxclick',
      (event) => {
        if (event.button === 1) this.#follow(event, doc, page, true);
      },
      true,
    );
    doc.addEventListener('submit', (event) => this.#submit(event), true);
  }

  #follow(event: MouseEvent, doc: Document, page: string, elsewhere = false): void {
    // The copy is another realm, so its elements are not `instanceof Element` here.
    const target = event.target as { closest?: (selector: string) => Element | null } | null;
    const link = target?.closest?.('a[href], area[href]') as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    const fragment = inPageTarget(link.href, page);
    if (fragment !== null && !elsewhere) {
      (doc.getElementById(fragment) ?? doc.getElementsByName(fragment)[0])?.scrollIntoView();
      return;
    }
    const url = linkDestination(link.href);
    if (!url) return;
    if (url.startsWith('mailto:')) void launch(url, 'url');
    else if (elsewhere || event.ctrlKey || event.shiftKey) void this.openWindow(url);
    else this.open(url);
  }

  #submit(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    // A password never goes into an address, and nothing is posted from a copy.
    if (form.querySelector('input[type="password"]')) {
      void this.openWindow();
      return;
    }
    const FrameFormData = (form.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.FormData ?? FormData;
    const fields = [...new FrameFormData(form)].filter((pair): pair is [string, string] => typeof pair[1] === 'string');
    // DuckDuckGo's results page posts its own next page and its search box; it answers the same fields as a query.
    const method = /(^|\.)duckduckgo\.com$/.test(hostOf(form.action)) ? 'get' : form.method;
    const destination = formDestination(form.action, method, fields);
    if (destination) this.open(destination);
    else void this.openWindow();
  }

  /** In Edge's app mode, or the default browser if Edge will not start. */
  async openWindow(url = this.address): Promise<void> {
    if (!url) return;
    try {
      await invoke(SeelenCommand.Run, { program: EDGE, args: [`--app=${url}`], workingDir: null, elevated: false });
      noteAction(`browser: opened ${hostOf(url)} in a window`);
    } catch (err) {
      noteError(`browser: no app window, using the default browser (${err instanceof Error ? err.message : String(err)})`);
      await launch(url, 'url');
    }
  }

  #push(entry: Entry): void {
    const current = this.current;
    // Opening what is already open reloads it rather than stacking a copy.
    if (current && sameTarget(current, entry)) {
      this.#replace(entry);
      return;
    }
    this.entries = [...this.entries.slice(0, this.index + 1), entry].slice(-MAX_ENTRIES);
    this.index = this.entries.length - 1;
    this.#show();
    this.#save();
  }

  #replace(entry: Entry): void {
    this.entries[this.index] = entry;
    this.#show();
    this.#save();
  }

  #save(): void {
    this.#writer?.queue({ version: VERSION, entries: $state.snapshot(this.entries), index: this.index });
  }

  #show(): void {
    this.#abort?.abort();
    this.#abort = null;
    this.#frameBack = 0;
    this.#frameForward = 0;
    this.#firstLoad = false;
    this.#stepLoads = 0;

    const entry = this.current;
    if (!entry || (entry.kind === 'page' && entry.mode === 'window')) {
      this.view = { status: 'idle' };
      return;
    }
    if (entry.kind === 'page' && entry.mode === 'live') {
      // The entry mounts a new frame, whose first load is not a navigation.
      this.#firstLoad = true;
      this.view = { status: 'loading' };
      return;
    }

    const abort = new AbortController();
    this.#abort = abort;
    this.view = { status: 'loading' };
    const key = chat.keyFor('jina');
    const reading = entry.kind === 'page' && entry.mode === 'reader';
    const address = entry.kind === 'search' ? SEARCH + encodeURIComponent(entry.query) : entry.load;
    const label = entry.kind === 'search' ? entry.query : addressLabel(entry.url);
    const work: Promise<View> = reading
      ? readPage(address, abort.signal, key).then(
          (page): View => ({ status: 'reader', title: page.title || label, ...cleanReaderText(page.content) }),
        )
      : renderPage(address, abort.signal, key).then(
          (page): View => ({ status: 'page', title: page.title || label, base: page.url, srcdoc: snapshotDocument(page.html, page.url) }),
        );
    work.then(
      (view) => {
        if (this.#abort === abort) this.view = view;
      },
      (err) => {
        if (this.#abort !== abort || abort.signal.aborted) return;
        const what = entry.kind === 'search' ? 'search' : `${reading ? 'text' : 'copy'} of ${hostOf(entry.url)}`;
        noteError(`browser: ${what} failed (${err instanceof Error ? err.message.replace(/ for \S+$/, '') : String(err)})`);
        this.view = { status: 'error', message: failure(err, entry.kind === 'search' ? 'search' : 'page') };
      },
    );
  }
}

export const browser = new BrowserSession();
