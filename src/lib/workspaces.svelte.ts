import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import type { DesktopWorkspace, VirtualDesktops } from '@seelen-ui/lib/types';

/**
 * Seelen's virtual desktops, which are per monitor rather than global.
 *
 * The host keeps workspaces in a grid (rows of workspaces), so a flat list for
 * a panel has to be read out of `workspaces` row by row.
 */
export const virtualDesktops = hostValue<VirtualDesktops>({
  label: 'workspaces',
  initial: { monitors: {}, pinned: [], switching: false },
  load: () => invoke(SeelenCommand.StateGetVirtualDesktops),
  listen: (apply) => subscribe(SeelenEvent.VirtualDesktopsChanged, (e) => apply(e.payload)),
});

export interface WorkspaceEntry {
  workspace: DesktopWorkspace;
  /** 1-based position in the flattened grid, used when a workspace is unnamed. */
  index: number;
  active: boolean;
}

/** The workspaces of one display, flattened in reading order. */
export function workspacesOf(desktops: VirtualDesktops, monitorId: string | null): WorkspaceEntry[] {
  const monitor = monitorId ? desktops.monitors[monitorId] : undefined;
  if (!monitor) return [];
  const flat = monitor.workspaces.flat();
  return flat.map((workspace, i) => ({
    workspace,
    index: i + 1,
    active: workspace.id === monitor.active_workspace,
  }));
}

/** What a workspace is called in a list: its own name, or its position. */
export function workspaceLabel(entry: WorkspaceEntry, showNames: boolean): string {
  const name = entry.workspace.name?.trim();
  return showNames && name ? name : `Desktop ${entry.index}`;
}

export function switchWorkspace(workspaceId: string): void {
  tell('workspaces', invoke(SeelenCommand.SwitchWorkspace, { workspaceId }));
}

export function moveWindowToWorkspace(hwnd: number, workspaceId: string): void {
  tell('workspaces', invoke(SeelenCommand.MoveWindowToWorkspace, { hwnd, workspaceId }));
}

/**
 * Adds a workspace to one display.
 *
 * Seelen lays workspaces out as a grid of rows; `create_workspace` appends to
 * the last row, which is the flat "one more desktop" a list wants. The host
 * broadcasts `virtual-desktops::changed`, so nothing here has to re-read.
 */
export function createWorkspace(monitorId: string): void {
  tell('workspaces', invoke(SeelenCommand.CreateWorkspace, { monitorId }));
}

/** An empty or blank name clears it, which puts the row back to `Desktop N`. */
export function renameWorkspace(workspaceId: string, name: string): void {
  const trimmed = name.trim();
  tell('workspaces', invoke(SeelenCommand.RenameWorkspace, { workspaceId, name: trimmed || null }));
}

export function destroyWorkspace(workspaceId: string): void {
  tell('workspaces', invoke(SeelenCommand.DestroyWorkspace, { workspaceId }));
}
