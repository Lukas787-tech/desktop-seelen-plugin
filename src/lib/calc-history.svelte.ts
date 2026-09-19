import { newId } from './ids';
import { debouncedWriter, readJson } from './persist';
import type { UnSubscriber } from './seelen';

export interface CalcEntry {
  id: string;
  expression: string;
  /** What the display showed, units and base prefix included. */
  result: string;
  value: number;
  at: number;
}

interface CalcFile {
  version: 1;
  history: CalcEntry[];
  /** `ans` and anything assigned with `name = ...`. */
  variables: Record<string, number>;
}

const FILE = 'calculator.json';
const KEPT = 60;

function defaults(): CalcFile {
  return { version: 1, history: [], variables: {} };
}

/**
 * The Calculator's tape and its variables.
 *
 * Shared by every display, like the notes: a sum worked out on one screen is
 * worth having on the other. Unlike a board it is append-mostly and nobody
 * edits an old line, so last-writer-wins on the file is enough.
 */
class CalcHistory {
  state = $state<CalcFile>(defaults());

  #writer = debouncedWriter(FILE, 600);
  #loaded = false;
  #users = 0;

  acquire(): UnSubscriber {
    this.#users++;
    if (this.#users === 1 && !this.#loaded) void this.#load();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users === 0) void this.#writer.flush();
    };
  }

  async #load(): Promise<void> {
    const loaded = await readJson<Partial<CalcFile>>(FILE, defaults());
    this.state = {
      version: 1,
      history: Array.isArray(loaded.history) ? loaded.history.slice(0, KEPT) : [],
      variables: loaded.variables && typeof loaded.variables === 'object' ? loaded.variables : {},
    };
    this.#loaded = true;
  }

  #save(): void {
    if (!this.#loaded) return;
    this.#writer.queue($state.snapshot(this.state));
  }

  record(expression: string, result: string, value: number, assigned: string | null): void {
    this.state.history.unshift({ id: newId('calc'), expression, result, value, at: Date.now() });
    if (this.state.history.length > KEPT) this.state.history.length = KEPT;
    if (Number.isFinite(value)) {
      this.state.variables.ans = value;
      if (assigned) this.state.variables[assigned] = value;
    }
    this.#save();
  }

  remove(id: string): void {
    this.state.history = this.state.history.filter((entry) => entry.id !== id);
    this.#save();
  }

  clear(): void {
    this.state.history = [];
    this.state.variables = {};
    this.#save();
  }
}

export const calcHistory = new CalcHistory();
