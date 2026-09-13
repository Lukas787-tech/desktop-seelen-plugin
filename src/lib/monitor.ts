import { ConnectedMonitorList, Widget } from './seelen';
import type { PhysicalMonitor } from '@seelen-ui/lib/types';

/**
 * Resolves the display this widget replica belongs to.
 *
 * With `instances: ReplicaByMonitor` the host stamps the monitor id onto the
 * webview label, which `Widget.self.decoded.monitorId` decodes. Falls back to
 * the primary display so a mis-stamped instance still renders something.
 */
export async function resolveOwnMonitor(): Promise<PhysicalMonitor | null> {
  const wanted = Widget.self.decoded.monitorId;
  const monitors = (await ConnectedMonitorList.getAsync()).all();
  if (wanted) {
    const found = monitors.find((m) => m.id === wanted);
    if (found) return found;
  }
  return monitors.find((m) => m.isPrimary) ?? monitors[0] ?? null;
}

export function monitorWidth(m: PhysicalMonitor): number {
  return m.rect.right - m.rect.left;
}

export function monitorHeight(m: PhysicalMonitor): number {
  return m.rect.bottom - m.rect.top;
}
