/**
 * Ids for things the user creates - a note, a desktop icon.
 *
 * `crypto.randomUUID()` is defined only in a secure context. A widget is served
 * from a host-controlled origin that we do not choose and cannot check from
 * here, and where it is absent the call does not degrade: it throws
 * `TypeError`, from inside the click handler that was adding the row, so
 * nothing is added and nothing is said. "Add a task and watch it not appear"
 * is not a failure worth risking for an id nobody ever reads, so this asks for
 * the good source and carries its own way of answering when it is missing.
 *
 * Uniqueness only has to hold within one file's list, and the counter alone
 * would guarantee that inside a single replica; the random half is what keeps
 * two replicas writing the same list from colliding.
 */
let counter = 0;

export function newId(prefix: string): string {
  counter += 1;

  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;

  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}
