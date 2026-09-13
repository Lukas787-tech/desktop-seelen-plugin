import { newId } from './ids';
import { debouncedWriter, readJson } from './persist';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface NotesState {
  version: 1;
  note: string;
  todos: TodoItem[];
}

const FILE = 'notes.json';

function defaults(): NotesState {
  return { version: 1, note: '', todos: [] };
}

/**
 * Notes and checklist content.
 *
 * Deliberately not per-monitor: the same notes should appear on every display.
 * Stored as plain JSON in the widget's data directory so it can be edited or
 * backed up outside the app.
 */
class NotesStore {
  state = $state<NotesState>(defaults());

  #writer = debouncedWriter(FILE, 800);
  #loaded = false;

  async load(): Promise<void> {
    const loaded = await readJson<NotesState>(FILE, defaults());
    this.state = { ...defaults(), ...loaded };
    this.#loaded = true;
  }

  save(): void {
    if (!this.#loaded) return;
    this.#writer.queue($state.snapshot(this.state));
  }

  flush(): Promise<void> {
    return this.#writer.flush();
  }

  addTodo(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.state.todos.push({ id: newId('todo'), text: trimmed, done: false });
    this.save();
  }

  toggleTodo(id: string): void {
    const todo = this.state.todos.find((t) => t.id === id);
    if (!todo) return;
    todo.done = !todo.done;
    this.save();
  }

  removeTodo(id: string): void {
    this.state.todos = this.state.todos.filter((t) => t.id !== id);
    this.save();
  }

  clearCompleted(): void {
    this.state.todos = this.state.todos.filter((t) => !t.done);
    this.save();
  }
}

export const notes = new NotesStore();
