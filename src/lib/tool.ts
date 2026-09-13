import type { Autonomy, ToolGroup } from './assistant-state';
import type { ToolSchema, ToolSpec } from './wire';

/**
 * The shape of one thing the assistant can do, and the rule for when it has to
 * ask first.
 *
 * Kept apart from the tools themselves so the rule can be tested without a
 * host, and so web tools (which need no host) and PC tools (which do) share it.
 */

/**
 * - `read`: looks, changes nothing.
 * - `act`: changes something a person can put back in a click - opening an
 *   app, pausing music, switching a desktop.
 * - `danger`: cannot be put back, or throws away work - emptying the bin,
 *   shutting down, closing a window with an unsaved document in it.
 */
export type Risk = 'read' | 'act' | 'danger';

export interface ToolContext {
  signal: AbortSignal;
  /** True when the model reading the result runs on this machine. */
  local: boolean;
}

export interface ToolDefinition extends ToolSpec {
  group: ToolGroup;
  risk: Risk | ((args: Record<string, unknown>) => Risk);
  /**
   * Hands over something personal - clipboard contents, file names - which
   * matters when the model reading it is a cloud service.
   */
  sensitive?: boolean;
  /**
   * Brings text from outside into the conversation. A web page can contain
   * instructions aimed at the model, so once one has been read, nothing
   * dangerous runs in that turn without the user seeing it first.
   */
  untrusted?: boolean;
  /** What a pending or finished call does, in a few plain words. */
  summarise: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export function riskOf(tool: ToolDefinition, args: Record<string, unknown>): Risk {
  return typeof tool.risk === 'function' ? tool.risk(args) : tool.risk;
}

export interface ApprovalInput {
  risk: Risk;
  autonomy: Autonomy;
  /** The user picked "always allow" for this tool. */
  alwaysAllowed: boolean;
  sensitive: boolean;
  local: boolean;
  /** Untrusted text has entered this turn. */
  tainted: boolean;
}

/**
 * Whether a call waits for the user.
 *
 * "Never ask" and "always allow" still stop for a dangerous action once a web
 * page has been read in the same turn: that is exactly the combination a
 * prompt injection needs, and one extra click is a small price for closing it.
 */
export function needsApproval(i: ApprovalInput): boolean {
  if (i.risk === 'danger' && i.tainted) return true;
  if (i.autonomy === 'auto' || i.alwaysAllowed) return false;
  if (i.sensitive && !i.local) return true;
  if (i.autonomy === 'ask-all') return i.risk !== 'read';
  return i.risk === 'danger';
}

export function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function num(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function bool(args: Record<string, unknown>, key: string): boolean | null {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'on' || value === 1) return true;
  if (value === 'false' || value === 'off' || value === 0) return false;
  return null;
}

/** Shorthand for a schema, since most tools take one or two strings. */
export function schema(properties: Record<string, unknown>, required: string[] = []): ToolSchema {
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

export function toSpec(tool: ToolDefinition): ToolSpec {
  return { name: tool.name, description: tool.description, ...(tool.parameters ? { parameters: tool.parameters } : {}) };
}
