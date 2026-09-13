import { hostValue, tell } from './live.svelte';
import { SeelenCommand, SeelenEvent, invoke, subscribe } from './seelen';
import type { TrashBinInfo } from '@seelen-ui/lib/types';

/** How much is in the recycle bin, kept live by the host's own watcher. */
export const trash = hostValue<TrashBinInfo>({
  label: 'trash',
  initial: { itemCount: 0, sizeInBytes: 0 },
  load: () => invoke(SeelenCommand.GetTrashBinInfo),
  listen: (apply) => subscribe(SeelenEvent.TrashBinChanged, (e) => apply(e.payload)),
});

/**
 * Deletes everything in the bin. Not reversible, so always confirm first.
 *
 * Windows fails this outright - `0x8000FFFF`, with no detail - when something
 * still holds one of the files, and the count on the panel simply does not
 * change, so the caller is given the message to show.
 */
export function emptyTrash(onError?: (message: string) => void): void {
  tell('trash', invoke(SeelenCommand.TrashBinEmpty), onError);
}

/** Opens the bin in Explorer through its shell folder name. */
export function openTrash(onError?: (message: string) => void): void {
  tell('trash', invoke(SeelenCommand.OpenFile, { path: 'shell:RecycleBinFolder' }), onError);
}
