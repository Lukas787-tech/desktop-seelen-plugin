import type { DesktopConfig } from './config.svelte';
import { readJson, writeJson } from './persist';

/**
 * Appearances the user kept: saved by hand from the Looks tab, or designed by
 * the AI and kept. Shown beside the built-in looks and in the right-click menu.
 *
 * A plain JSON file in the widget's data directory, so a preset survives a
 * reinstall of the widget's settings and can be copied between PCs by hand.
 */

export interface SavedPreset {
  id: string;
  label: string;
  description: string;
  createdAt: number;
  /** Desktop settings, spelled out in full when saved. */
  values: Partial<DesktopConfig>;
  /** The theme's settings in their stored form - only those a person sets. */
  shell: Record<string, string>;
  source: 'saved' | 'ai';
  /** The words an AI design was made from. */
  prompt?: string;
}

interface PresetFile {
  version: 1;
  presets: SavedPreset[];
}

const FILE = 'appearance-presets.json';

function valid(entry: unknown): entry is SavedPreset {
  const p = entry as SavedPreset;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.label === 'string' &&
    !!p.values &&
    typeof p.values === 'object' &&
    (p.shell === undefined || typeof p.shell === 'object')
  );
}

class PresetStore {
  list = $state<SavedPreset[]>([]);
  #loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.#loading ??= readJson<Partial<PresetFile>>(FILE, { version: 1, presets: [] }).then((file) => {
      this.list = (Array.isArray(file.presets) ? file.presets.filter(valid) : []).map((p) => ({
        ...p,
        description: typeof p.description === 'string' ? p.description : '',
        shell: p.shell ?? {},
        source: p.source === 'ai' ? 'ai' : 'saved',
      }));
    });
    return this.#loading;
  }

  add(preset: Omit<SavedPreset, 'id' | 'createdAt'>): SavedPreset {
    const saved: SavedPreset = { ...preset, id: crypto.randomUUID(), createdAt: Date.now() };
    this.list = [saved, ...this.list];
    this.#save();
    return saved;
  }

  rename(id: string, label: string): void {
    const clean = label.trim().slice(0, 40);
    if (!clean) return;
    this.list = this.list.map((p) => (p.id === id ? { ...p, label: clean } : p));
    this.#save();
  }

  remove(id: string): void {
    this.list = this.list.filter((p) => p.id !== id);
    this.#save();
  }

  #save(): void {
    const file: PresetFile = { version: 1, presets: $state.snapshot(this.list) as SavedPreset[] };
    void writeJson(FILE, file).catch((err) => console.error('[presets] could not save', err));
  }
}

export const presets = new PresetStore();
