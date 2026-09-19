import { SeelenCommand, invoke } from './seelen';

/**
 * The families installed on this PC, for the font pickers.
 *
 * Asked of the host rather than of the page: Chromium's own Local Font Access
 * API needs a permission prompt that a desktop-preset window has no way to
 * show. The host's `get_fonts` is the list Seelen's own font picker is built
 * from, so a family chosen here is one Seelen's settings would offer too.
 *
 * Loaded on first use, not at start-up - nothing needs it until a picker opens.
 */

/** What the pickers offer when the host cannot be asked: the families Windows 11 ships. */
const WINDOWS_FONTS = [
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Cascadia Code',
  'Cascadia Mono',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Ebrima',
  'Franklin Gothic Medium',
  'Gabriola',
  'Georgia',
  'Ink Free',
  'Lucida Console',
  'Palatino Linotype',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Segoe UI Variable Display',
  'Segoe UI Variable Text',
  'Sitka Text',
  'Sylfaen',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

class FontList {
  families = $state<string[]>([]);
  /** True once the host's list arrived; false while it is the built-in stand-in. */
  fromHost = $state(false);
  #loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.#loading ??= (async () => {
      try {
        const fonts = (await invoke(SeelenCommand.GetFonts)) as Array<{ family: string }> | null;
        const families = [...new Set((fonts ?? []).map((font) => font.family?.trim()).filter(Boolean))];
        if (!families.length) throw new Error('the host returned no fonts');
        this.families = families.sort((a, b) => a.localeCompare(b));
        this.fromHost = true;
      } catch (err) {
        console.warn('[fonts] could not list the installed fonts; offering the Windows set', err);
        this.families = WINDOWS_FONTS;
        // A later picker may try again: the host may simply not have been ready.
        this.#loading = null;
      }
    })();
    return this.#loading;
  }
}

export const fonts = new FontList();
