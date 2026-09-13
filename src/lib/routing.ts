import type { Provider, ProviderId } from './providers';
import type { Privacy } from './assistant-state';

/**
 * Picking which model answers, and what to fall back to when it will not.
 *
 * The rules are deliberately legible rather than clever. Every choice this
 * makes is shown to the user with the sentence that justified it, so a
 * surprising answer can be traced to a rule and the rule argued with. A
 * learned router would be better at the margins and impossible to explain in a
 * panel this size, which is the wrong trade for something that quietly spends
 * the user's money and sends their desktop's state to a third party.
 *
 * Three rules earn their place over "just use the configured service":
 *
 * - **Local first for anything about this machine.** If the question needs the
 *   PC tools and a local model is running, it answers. What is open and how
 *   much battery is left should not leave the machine to answer "am I charging".
 * - **Local first for small talk.** A one-line question does not need a
 *   frontier model, and the local one is free.
 * - **Local only, when asked.** With privacy set to local-only nothing is ever
 *   queued behind a cloud service, whatever else is configured.
 */

export interface Candidate {
  provider: ProviderId;
  model: string;
  /** Why this one, in a few words, for the panel to show. */
  reason: string;
}

export interface RouteInput {
  prompt: string;
  /** The service the user picked. */
  configured: ProviderId;
  /** Their model, blank to follow the service's default. */
  configuredModel: string;
  providers: readonly Provider[];
  /** True when a service can actually be called right now. */
  usable: (id: ProviderId) => boolean;
  /** True when a service runs on this machine or network. */
  isLocal: (id: ProviderId) => boolean;
  /** The model a local service should use when none is named. */
  localModel: (id: ProviderId) => string | null;
  /** True when the PC tools or the status summary are switched on. */
  pcEnabled: boolean;
  /** Off: the configured service alone, with no failover. */
  routing: boolean;
  privacy: Privacy;
}

/** Questions that read as being about this machine rather than the world. */
const ABOUT_THIS_PC =
  /\b(my|this)\s+(pc|computer|machine|laptop|desktop|system|screen|files?|folders?|downloads|clipboard|notes?|todos?)\b|\b(cpu|ram|memory|battery|charging|disk|drive|storage|volume|brightness|recycle bin|bluetooth|wi-?fi|network|ip address|workspace|notification)s?\b|\b(what('| i)?s|whats)\s+(playing|open|running)\b|\b(launch|open|start|close|focus|minimi[sz]e|mute|unmute|pause|skip|lock|remind me)\b/i;

/** Work that rewards a bigger model. */
const HEAVY =
  /```|\b(refactor|debug|algorithm|architecture|prove|derive|analy[sz]e|optimi[sz]e|trade-?offs?|step by step|why does|explain how|design a|write a (program|script|function|class|essay|report)|research|compare|plan)\b/i;

export function classify(prompt: string): { aboutThisPc: boolean; heavy: boolean; light: boolean } {
  const heavy = HEAVY.test(prompt) || prompt.length > 280;
  return { aboutThisPc: ABOUT_THIS_PC.test(prompt), heavy, light: !heavy && prompt.length < 80 };
}

/**
 * The ordered list of attempts for one message.
 *
 * Returns at least one candidate when anything allowed is usable at all; the
 * caller walks it until a request succeeds.
 */
export function planRoute(input: RouteInput): Candidate[] {
  const { prompt, configured, configuredModel, providers, usable, isLocal, localModel } = input;
  const localOnly = input.privacy === 'local-only';
  const candidates: Candidate[] = [];
  const seen = new Set<ProviderId>();

  function modelFor(provider: Provider, tier: 'fast' | 'strong', explicit?: string): string | null {
    if (explicit?.trim()) return explicit.trim();
    if (isLocal(provider.id)) return localModel(provider.id);
    return (tier === 'strong' ? provider.strongModel : provider.fastModel) || provider.defaultModel || null;
  }

  function add(id: ProviderId, tier: 'fast' | 'strong', reason: string, explicit?: string): void {
    if (seen.has(id) || !usable(id)) return;
    if (localOnly && !isLocal(id)) return;
    const provider = providers.find((p) => p.id === id);
    if (!provider) return;
    const model = modelFor(provider, tier, explicit);
    if (!model) return;
    seen.add(id);
    candidates.push({ provider: id, model, reason });
  }

  if (!input.routing) {
    add(configured, 'fast', localOnly && !isLocal(configured) ? '' : 'your default', configuredModel);
    return candidates;
  }

  const { aboutThisPc, heavy, light } = classify(prompt);
  const tier = heavy ? 'strong' : 'fast';

  // The configured service when it is itself local, else the first local one
  // that is running - so "local first" means the local model the user chose.
  const localIds = [configured, ...providers.map((p) => p.id)].filter((id) => isLocal(id) && usable(id));
  const firstLocal = localIds[0];
  const explicitFor = (id: ProviderId) => (id === configured ? configuredModel : undefined);

  if (firstLocal && input.pcEnabled && aboutThisPc) {
    add(firstLocal, 'strong', 'about this PC, so it stays on this PC', explicitFor(firstLocal));
  } else if (firstLocal && light) {
    add(firstLocal, 'strong', 'short question, answered locally', explicitFor(firstLocal));
  }

  add(configured, tier, heavy ? 'the harder question' : 'your default', configuredModel);

  // Everything else, so a dead key or a rate limit is not the end of the turn.
  for (const provider of providers) add(provider.id, tier, localOnly ? 'another local model' : 'fallback');

  return candidates;
}

/**
 * Whether a failure should move on to the next candidate.
 *
 * Only availability failures fail over. A request this service rejected as
 * malformed would fail identically everywhere - retrying it just spends
 * another key for the same error.
 */
export function shouldFailOver(status: number | null, message: string): boolean {
  if (status === 401 || status === 403 || status === 404 || status === 429) return true;
  if (status !== null && status >= 500) return true;
  if (status !== null) return false;
  return /failed to fetch|network|load failed|connection|timed? out|not reachable/i.test(message);
}
