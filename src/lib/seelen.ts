/**
 * Thin, typed access to the Seelen host.
 *
 * Everything the widget needs from the host goes through here so the rest of
 * the code never imports the SDK directly — that keeps the API surface we
 * depend on small and visible in one place.
 */
export {
  invoke,
  subscribe,
  SeelenCommand,
  SeelenEvent,
  Settings,
  Widget,
  ConnectedMonitorList,
} from '@seelen-ui/lib';
/**
 * Teardown handle returned by `subscribe`. The package does not re-export this
 * type from its root, so it is mirrored here rather than reached for through a
 * deep import into generated code.
 */
export type UnSubscriber = () => void;

/**
 * Collects teardown handles so a component can release every host
 * subscription at once. Subscribing is async, so `add` takes the promise and
 * still unsubscribes correctly if `dispose` runs before it resolves.
 */
export class Disposables {
  #handles: UnSubscriber[] = [];
  #disposed = false;

  add(pending: Promise<UnSubscriber>): void {
    void pending.then((off) => {
      if (this.#disposed) off();
      else this.#handles.push(off);
    });
  }

  addFn(off: UnSubscriber): void {
    if (this.#disposed) off();
    else this.#handles.push(off);
  }

  dispose(): void {
    this.#disposed = true;
    for (const off of this.#handles.splice(0)) {
      try {
        off();
      } catch {
        /* a host teardown failure must not block the rest */
      }
    }
  }
}
