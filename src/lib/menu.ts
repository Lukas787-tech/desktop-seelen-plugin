/** One entry in a surface context menu. */
export interface MenuItem {
  label: string;
  action?: () => void;
  /** Renders a divider; every other field is ignored. */
  separator?: boolean;
  /** Renders a non-interactive section label. */
  header?: boolean;
  /** Opens a submenu instead of running an action. */
  items?: MenuItem[];
  /** Shows a tick column. `false` reserves the space, `undefined` does not. */
  checked?: boolean;
  /** Muted text at the end of the row, e.g. where a value comes from. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
}

/** A divider, written often enough to be worth a helper. */
export const menuSeparator: MenuItem = { label: '', separator: true };
