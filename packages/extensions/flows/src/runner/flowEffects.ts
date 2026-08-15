import { interpolate, UnresolvedReferenceError } from './interpolate';
import type { StepProvider, Flow, FlowNode } from '../schema/types';

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

/** The leading literal token of a command, or null when it begins with a reference. */
function leadingLiteralToken(raw: string): string | null {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{{')) return null;
  const token = trimmed.split(/\s+/)[0] ?? '';
  if (token === '' || token.includes('{{')) return null;
  return token;
}

function agentProvider(node: FlowNode): StepProvider {
  return 'provider' in node && node.provider ? node.provider : 'claude-code';
}

export function flowEffects(
  flow: Flow,
  options: { shellAllowlist: readonly string[] }
): FlowEffectSummary {
  const files: FileEffect[] = [];
  const shell: ShellEffect[] = [];
  const agents: AgentEffect[] = [];
  const variables = flow.variables;

  for (const node of flow.nodes) {
    const label = node.label ?? node.id;
    switch (node.type) {
      case 'write-file':
        files.push({ nodeId: node.id, label, path: resolveTemplate(node.path, variables) });
        break;
      case 'shell': {
        const command = resolveTemplate(node.run, variables);
        const leadingToken = command.resolved
          ? (command.text.trim().split(/\s+/)[0] ?? null) || null
          : leadingLiteralToken(node.run);
        const inAllowlist = leadingToken === null ? null : options.shellAllowlist.includes(leadingToken);
        shell.push({ nodeId: node.id, label, command, leadingToken, inAllowlist });
        break;
      }
      case 'agent':
      case 'fan-out':
      case 'slash-command':
      case 'skill':
        agents.push({
          nodeId: node.id,
          label,
          kind: node.type,
          provider: agentProvider(node),
          ...('tools' in node && node.tools ? { tools: node.tools } : {}),
          worktree: 'worktree' in node ? node.worktree === true : false,
          ...(node.type === 'fan-out' ? { over: resolveTemplate(node.over, variables) } : {}),
        });
        break;
      // human-gate has no side effect.
    }
  }

  return {
    files,
    shell,
    agents,
    empty: files.length === 0 && shell.length === 0 && agents.length === 0,
  };
}
