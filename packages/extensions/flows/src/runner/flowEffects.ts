import { interpolate, UnresolvedReferenceError } from './interpolate';
import type { StepProvider } from '../schema/types';

/** A field resolved concrete, or left as its raw template when it can only resolve at run time. */
export interface Resolved {
  text: string;
  resolved: boolean;
}

export interface FileEffect {
  nodeId: string;
  label: string;
  path: Resolved;
}

export interface ShellEffect {
  nodeId: string;
  label: string;
  command: Resolved;
  /** The command's leading token, or null when it is itself a `{{ref}}`. */
  leadingToken: string | null;
  /** Whether the leading token is in the allowlist; null when the token is unknown pre-run. */
  inAllowlist: boolean | null;
}

export interface AgentEffect {
  nodeId: string;
  label: string;
  kind: 'agent' | 'fan-out' | 'slash-command' | 'skill';
  provider: StepProvider;
  /** Absent means the project default, NOT "no tools". */
  tools?: string[];
  /** false means the step runs in the main working tree. */
  worktree: boolean;
  /** fan-out only: the list it fans over; the item count is runtime-only. */
  over?: Resolved;
}

export interface FlowEffectSummary {
  files: FileEffect[];
  shell: ShellEffect[];
  agents: AgentEffect[];
  /** true when nothing is side-effectful — the caller skips the gate. */
  empty: boolean;
}

/**
 * Resolve a field as far as is honest pre-run: variables and literals become
 * concrete text; a `{{node.port}}` (whose value does not exist until the node
 * runs) is left as its raw template and flagged unresolved. Reuses the real
 * interpolator so this never drifts from run behavior.
 */
export function resolveTemplate(template: string, variables: Record<string, string>): Resolved {
  try {
    return { text: interpolate(template, { variables, outputs: {} }), resolved: true };
  } catch (error) {
    if (error instanceof UnresolvedReferenceError) return { text: template, resolved: false };
    throw error;
  }
}
