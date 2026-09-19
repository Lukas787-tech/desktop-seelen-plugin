import { newId } from './ids';
import { readJson, writeJson } from './persist';
import { Widget, type UnSubscriber } from './seelen';

/**
 * Which one display replica does a thing that must happen exactly once.
 *
 * Both replicas run the same code against the same data. For most modules that
 * is harmless, but an alarm would ring twice, a reminder would chime twice and
 * screen time would count every second twice. `chat.claimTimers()` settles its
 * case by giving the job to the primary display - which only works if the
 * primary display is showing the panel that does the job. These modules can be
 * shown on either display, or both, or turned off on the primary one.
 *
 * So the job goes to whichever replica holds a lease: a small file naming its
 * holder and when it last renewed. A holder renews every 20 seconds; a lease
 * nobody has renewed for a minute is up for grabs, which is how a display that
 * is unplugged, reloaded or has the panel turned off hands over. A replica that
 * releases on purpose clears the file, so the other takes over on its next
 * renewal rather than a minute later.
 *
 * Two replicas starting at the same moment can both see a free lease. Each
 * writes, waits, and reads back; only the one whose name is in the file holds
 * it. The unlucky case - both read back before either wrote - costs at most one
 * renewal period of doing the job twice, which is the price of having no lock.
 */

const RENEW_MS = 20_000;
const STALE_MS = 60_000;

interface LeaseFile {
  owner: string;
  at: number;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export class Lease {
  /** True while this replica is the one that should act. */
  held = $state(false);

  #file: string;
  #me: string;
  #users = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #generation = 0;

  constructor(name: string) {
    this.#file = `lease-${name}.json`;
    this.#me = `${Widget.self.decoded.monitorId ?? 'primary'}:${newId('lease')}`;
  }

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1) {
      const mine = ++this.#generation;
      // Jittered, so two replicas starting together rarely race at all.
      void sleep(Math.random() * 400).then(() => {
        if (mine === this.#generation) void this.#renew(mine);
      });
      this.#timer = setInterval(() => void this.#renew(mine), RENEW_MS);
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users > 0) return;
      this.#generation++;
      clearInterval(this.#timer);
      this.#timer = undefined;
      if (this.held) {
        this.held = false;
        void writeJson(this.#file, { owner: '', at: 0 }).catch(() => {});
      }
    };
  }

  async #renew(mine: number): Promise<void> {
    try {
      const file = await readJson<LeaseFile | null>(this.#file, null);
      if (mine !== this.#generation) return;
      const now = Date.now();
      const free = !file?.owner || file.owner === this.#me || now - (file.at ?? 0) > STALE_MS;
      if (!free) {
        this.held = false;
        return;
      }
      await writeJson(this.#file, { owner: this.#me, at: now });
      await sleep(150);
      const check = await readJson<LeaseFile | null>(this.#file, null);
      if (mine !== this.#generation) return;
      this.held = check?.owner === this.#me;
    } catch {
      // Unable to read or write the data directory at all: acting twice is a
      // better failure than an alarm that never rings.
      if (mine === this.#generation) this.held = true;
    }
  }
}
