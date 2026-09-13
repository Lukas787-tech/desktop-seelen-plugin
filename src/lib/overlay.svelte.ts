import type { Component } from 'svelte';
import type { MenuItem } from './menu';

/**
 * The surface's overlay layer: one context menu and one dialog, opened from
 * anywhere and rendered at the top of the surface.
 *
 * It exists because a module cannot open either one itself. Every panel is a
 * `.panel`, every panel carries a `backdrop-filter`, and that makes the panel a
 * containing block for its `position: fixed` descendants *and* clips them to its
 * own overflow - so a menu or a modal rendered inside a module would be trapped
 * in a box a couple of hundred pixels wide. (The same property is why
 * `ContextMenu` keeps its levels in a flat list; see the README.)
 *
 * Hoisting the two out to the surface is what lets a module offer a per-item
 * menu and a proper dialog while staying a component that only knows about its
 * own contents.
 */

type DialogProps = Record<string, unknown>;

export interface OverlayMenu {
  x: number;
  y: number;
  items: MenuItem[];
}

export interface OverlayDialog {
  component: Component<DialogProps>;
  props: DialogProps;
}

class OverlayLayer {
  menu = $state<OverlayMenu | null>(null);
  dialog = $state<OverlayDialog | null>(null);

  /** Opens a menu at a click, suppressing the one the surface would show. */
  openMenu(event: MouseEvent, items: MenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.openMenuAt(event.clientX, event.clientY, items);
  }

  openMenuAt(x: number, y: number, items: MenuItem[]): void {
    this.menu = { x, y, items };
  }

  closeMenu(): void {
    this.menu = null;
  }

  /**
   * Shows one dialog component on the surface.
   *
   * Generic so the caller's props are still checked against the component it
   * passes; the cast is only to store the pair in one field.
   */
  openDialog<P extends DialogProps>(component: Component<P>, props: P): void {
    this.dialog = { component: component as unknown as Component<DialogProps>, props };
  }

  closeDialog(): void {
    this.dialog = null;
  }
}

export const overlay = new OverlayLayer();
