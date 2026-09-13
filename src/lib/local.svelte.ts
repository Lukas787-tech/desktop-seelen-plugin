import { noteAction, noteError } from './diagnostics';
import { OLLAMA_DEFAULT_HOST, trimUrl } from './providers';
import { SeelenCommand, invoke } from './seelen';

/**
 * The model servers running on this machine: what they have, what is loaded,
 * and whether this widget is allowed to talk to them at all.
 *
 * That last question is the one that decided whether the local model worked.
 * Ollama answers any origin it does not recognise with 403 - measured against
 * `http://tauri.localhost`, which is where a Seelen widget is served from, on
 * `/api/tags`, `/api/chat` and the OpenAI shim alike - and a browser cannot
 * tell a 403 without CORS headers from a server that is not there. Both reject
 * with the same opaque `TypeError`.
 *
 * A `no-cors` request can: it resolves with an opaque response whenever
 * anything answered, and rejects only when nothing did. So a failed read
 * followed by a `no-cors` probe separates "Ollama is refusing this widget"
 * from "Ollama is not running", and the panel can offer the right fix for each.
 */

export type ServerState = 'unknown' | 'ready' | 'refused' | 'offline';

export interface LocalModel {
  name: string;
  /** Bytes on disk. */
  size: number;
  family: string;
  parameters: string;
  quantization: string;
}

export interface RunningModel {
  name: string;
  size: number;
  sizeVram: number;
  expiresAt: string;
  contextLength: number | null;
}

export interface ModelInfo {
  /** Ollama's own list: `completion`, `tools`, `thinking`, `vision`, `embedding`... */
  capabilities: string[];
  contextLength: number | null;
}

export interface PullState {
  status: string;
  completed: number;
  total: number;
  error?: string;
  done: boolean;
}

export type OpenAIServer = 'lmstudio' | 'custom';

async function getJson(url: string, ms: number, init?: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

/** True when anything at all answers at this address, readable or not. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** PowerShell's `-EncodedCommand` takes UTF-16LE base64, which sidesteps every quoting rule. */
export function encodePowerShell(script: string): string {
  let binary = '';
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
}

async function runPowerShell(script: string): Promise<void> {
  await invoke(SeelenCommand.Run, {
    program: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(script)],
    workingDir: null,
    elevated: false,
  });
}

const OLLAMA_APP = `$app = Join-Path $env:LOCALAPPDATA 'Programs\\Ollama\\ollama app.exe'
if (Test-Path $app) { Start-Process -FilePath $app } else { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden }`;

class LocalServers {
  host = $state(OLLAMA_DEFAULT_HOST);
  state = $state<ServerState>('unknown');
  version = $state<string | null>(null);
  models = $state<LocalModel[]>([]);
  running = $state<RunningModel[]>([]);
  info = $state<Record<string, ModelInfo>>({});
  pulls = $state<Record<string, PullState>>({});
  /** True while the origin fix or a start is waiting for Ollama to come back. */
  fixing = $state(false);

  servers = $state<Record<OpenAIServer, { state: ServerState; models: string[] }>>({
    lmstudio: { state: 'unknown', models: [] },
    custom: { state: 'unknown', models: [] },
  });

  #pullAborts = new Map<string, AbortController>();

  get names(): string[] {
    return this.models.map((m) => m.name);
  }

  setHost(host: string): void {
    const next = trimUrl(host) || OLLAMA_DEFAULT_HOST;
    if (next === this.host) return;
    this.host = next;
    this.info = {};
    void this.refresh();
  }

  /** Reads the installed models, which doubles as the reachability check. */
  async refresh(): Promise<void> {
    const host = this.host;
    try {
      const [tags, version] = await Promise.all([
        getJson(`${host}/api/tags`, 2500),
        getJson(`${host}/api/version`, 2500).catch(() => null),
      ]);
      if (host !== this.host) return;
      this.models = (tags?.models ?? []).map((m: any) => ({
        name: String(m.name ?? m.model ?? ''),
        size: Number(m.size) || 0,
        family: m.details?.family ?? '',
        parameters: m.details?.parameter_size ?? '',
        quantization: m.details?.quantization_level ?? '',
      }));
      this.version = version?.version ?? null;
      this.state = 'ready';
      void this.refreshRunning();
      for (const model of this.models) void this.modelInfo(model.name);
    } catch {
      if (host !== this.host) return;
      this.models = [];
      this.running = [];
      this.state = (await answers(`${host}/api/version`)) ? 'refused' : 'offline';
    }
  }

  async refreshRunning(): Promise<void> {
    try {
      const payload = await getJson(`${this.host}/api/ps`, 2500);
      this.running = (payload?.models ?? []).map((m: any) => ({
        name: String(m.name ?? m.model ?? ''),
        size: Number(m.size) || 0,
        sizeVram: Number(m.size_vram) || 0,
        expiresAt: String(m.expires_at ?? ''),
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
      }));
    } catch {
      this.running = [];
    }
  }

  /** What a model can do, read once per model from `/api/show`. */
  async modelInfo(name: string): Promise<ModelInfo | null> {
    if (!name) return null;
    const cached = this.info[name];
    if (cached) return cached;
    try {
      const payload = await getJson(`${this.host}/api/show`, 5000, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: name }),
      });
      const entry = Object.entries(payload?.model_info ?? {}).find(([k]) => k.endsWith('.context_length'));
      const info: ModelInfo = {
        capabilities: Array.isArray(payload?.capabilities) ? payload.capabilities : [],
        contextLength: typeof entry?.[1] === 'number' ? entry[1] : null,
      };
      this.info = { ...this.info, [name]: info };
      return info;
    } catch {
      return null;
    }
  }

  /** `null` when it is not known yet, which callers treat as "try it". */
  supports(name: string, capability: string): boolean | null {
    const info = this.info[name];
    return info ? info.capabilities.includes(capability) : null;
  }

  /** Remembers a capability learned the hard way, from a 400 naming it. */
  markUnsupported(name: string, capability: string): void {
    const info = this.info[name] ?? { capabilities: ['completion', 'tools', 'thinking'], contextLength: null };
    this.info = { ...this.info, [name]: { ...info, capabilities: info.capabilities.filter((c) => c !== capability) } };
  }

  async pull(name: string): Promise<void> {
    const model = name.trim();
    if (!model || this.#pullAborts.has(model)) return;
    const abort = new AbortController();
    this.#pullAborts.set(model, abort);
    const set = (patch: Partial<PullState>) => {
      const prev = this.pulls[model] ?? { status: 'starting', completed: 0, total: 0, done: false };
      this.pulls = { ...this.pulls, [model]: { ...prev, ...patch } };
    };
    set({ status: 'starting', completed: 0, total: 0, done: false, error: undefined });
    try {
      const response = await fetch(`${this.host}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Pull failed (${response.status}).`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const frame = JSON.parse(line);
          if (frame.error) throw new Error(frame.error);
          set({
            status: frame.status ?? '',
            ...(frame.total ? { total: frame.total, completed: frame.completed ?? 0 } : {}),
          });
        }
      }
      set({ status: 'done', done: true });
      noteAction(`assistant: pulled ${model}`);
      await this.refresh();
    } catch (err) {
      const message = abort.signal.aborted ? 'Cancelled.' : err instanceof Error ? err.message : String(err);
      set({ error: message, done: true });
      if (!abort.signal.aborted) noteError(`assistant: pull ${model} ${message}`);
    } finally {
      this.#pullAborts.delete(model);
    }
  }

  cancelPull(name: string): void {
    this.#pullAborts.get(name)?.abort();
  }

  clearPull(name: string): void {
    const next = { ...this.pulls };
    delete next[name];
    this.pulls = next;
  }

  async remove(name: string): Promise<void> {
    const response = await fetch(`${this.host}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    if (!response.ok) throw new Error(`Delete failed (${response.status}).`);
    noteAction(`assistant: deleted ${name}`);
    await this.refresh();
  }

  /** Loads a model ahead of the first question, which is where the 12 seconds go. */
  async load(name: string, keepAlive: string, numCtx: number): Promise<void> {
    await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, keep_alive: keepAlive || '30m', options: { num_ctx: numCtx } }),
    });
    await this.refreshRunning();
  }

  async unload(name: string): Promise<void> {
    await fetch(`${this.host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, keep_alive: 0 }),
    });
    await this.refreshRunning();
  }

  /** Lists an OpenAI-compatible server's models, and whether it can be reached. */
  async refreshServer(id: OpenAIServer, base: string, key: string): Promise<void> {
    const url = trimUrl(base);
    if (!url) {
      this.servers = { ...this.servers, [id]: { state: 'unknown', models: [] } };
      return;
    }
    try {
      const payload = await getJson(`${url}/models`, 3000, key ? { headers: { authorization: `Bearer ${key}` } } : undefined);
      const models = (payload?.data ?? []).map((m: any) => String(m.id ?? '')).filter(Boolean);
      this.servers = { ...this.servers, [id]: { state: 'ready', models } };
    } catch {
      const state = (await answers(`${url}/models`)) ? 'refused' : 'offline';
      this.servers = { ...this.servers, [id]: { state, models: [] } };
    }
  }

  /**
   * Adds this widget's origin to `OLLAMA_ORIGINS` for the user, then restarts
   * Ollama so it reads the new value.
   *
   * User-scope only, appended rather than replaced (an existing list is kept),
   * and reversible from Windows' environment variable settings. Only ever run
   * from the button that says what it does.
   */
  async allowThisWidget(): Promise<void> {
    const origin = location.origin.replace(/[^\w:/.-]/g, '');
    this.fixing = true;
    try {
      await runPowerShell(`$origin = '${origin}'
$current = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS', 'User')
$list = @(($current -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (($list -notcontains $origin) -and ($list -notcontains '*')) { $list += $origin }
$value = $list -join ','
[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $value, 'User')
$env:OLLAMA_ORIGINS = $value
Get-Process -Name 'ollama app', 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 900
${OLLAMA_APP}`);
      noteAction(`assistant: added ${origin} to OLLAMA_ORIGINS and restarted Ollama`);
      await this.#waitForReady();
    } catch (err) {
      noteError(`assistant: allow origin ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.fixing = false;
    }
  }

  async startOllama(): Promise<void> {
    this.fixing = true;
    try {
      await runPowerShell(OLLAMA_APP);
      await this.#waitForReady();
    } catch (err) {
      noteError(`assistant: start ollama ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.fixing = false;
    }
  }

  async #waitForReady(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await new Promise((done) => setTimeout(done, 1500));
      await this.refresh();
      if (this.state === 'ready') return;
    }
  }
}

export const local = new LocalServers();
