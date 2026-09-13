import type { Wire } from './wire';

/**
 * Every service the assistant can talk to.
 *
 * Kept free of Svelte and the host so the router and `npm test` can read it.
 * Local servers carry no fixed address: where Ollama, LM Studio or a custom
 * endpoint listens is a preference (see `assistant-state.ts`), resolved by
 * `baseFor`.
 */

export type ProviderId =
  | 'ollama'
  | 'lmstudio'
  | 'custom'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'groq';

export interface Provider {
  id: ProviderId;
  label: string;
  wire: Wire;
  /** Everything before the per-wire path; blank where a preference supplies it. */
  base: string;
  /** Used when no model is chosen. Blank for local servers, which use what is installed. */
  defaultModel: string;
  /** The router's two tiers: cheap and quick, or slow and capable. */
  fastModel: string;
  strongModel: string;
  /** Offered in the picker; any other id can still be typed. */
  models: readonly string[];
  /** Runs on this machine, so nothing said to it leaves it. */
  local?: boolean;
  /** Needs no credential at all. */
  keyless?: boolean;
  /** Works without a key, and takes one if the server was set up to want it. */
  keyOptional?: boolean;
  keyHint?: string;
}

export const OLLAMA_DEFAULT_HOST = 'http://127.0.0.1:11434';
export const LMSTUDIO_DEFAULT_URL = 'http://127.0.0.1:1234/v1';

/** Also the fallback for an unknown id, so `providerFor` always returns one. */
const OLLAMA: Provider = {
  id: 'ollama',
  label: 'Ollama',
  wire: 'ollama',
  base: OLLAMA_DEFAULT_HOST,
  defaultModel: '',
  fastModel: '',
  strongModel: '',
  models: [],
  local: true,
  keyless: true,
};

export const PROVIDERS: readonly Provider[] = [
  OLLAMA,
  {
    id: 'lmstudio',
    label: 'LM Studio',
    wire: 'openai',
    base: LMSTUDIO_DEFAULT_URL,
    defaultModel: '',
    fastModel: '',
    strongModel: '',
    models: [],
    local: true,
    keyOptional: true,
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    wire: 'openai',
    base: '',
    defaultModel: '',
    fastModel: '',
    strongModel: '',
    models: [],
    keyOptional: true,
    keyHint: 'any OpenAI-compatible server: llama.cpp, vLLM, Jan, LocalAI...',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    wire: 'gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    fastModel: 'gemini-2.5-flash',
    strongModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    keyHint: 'aistudio.google.com/apikey',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    fastModel: 'gpt-4o-mini',
    strongModel: 'gpt-4o',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],
    keyHint: 'platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Claude',
    wire: 'anthropic',
    base: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-5',
    fastModel: 'claude-haiku-4-5',
    strongModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyHint: 'console.anthropic.com/settings/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    wire: 'openai',
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    fastModel: 'openai/gpt-4o-mini',
    strongModel: 'anthropic/claude-opus-5',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-5', 'google/gemini-2.5-flash'],
    keyHint: 'openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq',
    wire: 'openai',
    base: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    fastModel: 'llama-3.1-8b-instant',
    strongModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    keyHint: 'console.groq.com/keys',
  },
];

export const PROVIDER_IDS: readonly ProviderId[] = PROVIDERS.map((p) => p.id);

export function providerFor(id: ProviderId): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? OLLAMA;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Addresses that do not leave this machine or its network. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
