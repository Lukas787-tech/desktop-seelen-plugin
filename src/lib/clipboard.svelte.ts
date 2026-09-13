import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import type { ClipboardData, ClipboardEntry } from '@seelen-ui/lib/types';

/**
 * Windows' own clipboard history.
 *
 * `isHistoryEnabled` mirrors the switch in Windows Settings; when it is off
 * Windows keeps no history at all and there is nothing for this to show, which
 * is worth saying on the panel rather than looking broken.
 */
export const clipboard = hostValue<ClipboardData>({
  label: 'clipboard',
  initial: { isHistoryEnabled: false, history: [] },
  load: () => invoke(SeelenCommand.ClipboardGetData),
  listen: (apply) => subscribe(SeelenEvent.ClipboardDataChanged, (e) => apply(e.payload)),
});

/** Puts the entry back on the clipboard, ready to paste. */
export function copyEntry(id: string): void {
  tell('clipboard', invoke(SeelenCommand.ClipboardSetContent, { id }));
}

/** Pastes the entry straight into whatever window has focus. */
export function pasteEntry(id: string): void {
  tell('clipboard', invoke(SeelenCommand.ClipboardPaste, { id }));
}

export function deleteEntry(id: string): void {
  tell('clipboard', invoke(SeelenCommand.ClipboardDeleteEntry, { id }));
}

export function clearHistory(): void {
  tell('clipboard', invoke(SeelenCommand.ClipboardClearHistory));
}

export type ClipboardKind = 'text' | 'image' | 'files' | 'link';

export interface ClipboardPreview {
  kind: ClipboardKind;
  /** One line of text for the row. */
  text: string;
  /** A `data:` URL for image entries, which arrive base64-encoded. */
  image: string | null;
}

/** What to draw for one entry, chosen from the richest content it carries. */
export function previewOf(entry: ClipboardEntry): ClipboardPreview {
  const content = entry.content;

  if (content.bitmap) {
    return { kind: 'image', text: 'Image', image: `data:image/webp;base64,${content.bitmap}` };
  }
  if (content.files?.length) {
    const names = content.files.map((path) => path.split(/[\\/]/).pop() ?? path);
    return { kind: 'files', text: names.join(', '), image: null };
  }
  const link = content.webLink ?? content.applicationLink;
  if (link && !content.text) return { kind: 'link', text: link, image: null };

  const text = (content.text ?? '').replace(/\s+/g, ' ').trim();
  return { kind: link ? 'link' : 'text', text, image: null };
}

/** Base64 WebP app logos come inline with the entry; nothing to fetch. */
export function sourceLogo(entry: ClipboardEntry): string | null {
  return entry.sourceAppLogo ? `data:image/webp;base64,${entry.sourceAppLogo}` : null;
}
