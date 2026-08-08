/**
 * `.flow.json` schema v1.
 *
 * A flow is a DAG of nodes. Each node is one unit of work handed to the Claude
 * Code CLI (or the shell, or a human), and each edge carries control — plus
 * optionally one named output — from an upstream node to a downstream one.
 */

export const NODE_TYPES = [
  'agent',
  'fan-out',
  'slash-command',
  'skill',
  'shell',
  'human-gate',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export interface NodePosition {
  x: number;
  y: number;
}

interface FlowNodeCommon {
  /** Unique within the flow. Referenced by edges and by `{{id.port}}`. */
  id: string;
  /** Display name on the canvas. Falls back to `id` when absent. */
  label?: string;
  /** Names this node's result so downstream nodes can read `{{id.output}}`. */
  output?: string;
  /** Canvas coordinates. Absent in hand-authored files; the editor lays those out. */
  position?: NodePosition;
}

export interface AgentNode extends FlowNodeCommon {
  type: 'agent';
  prompt: string;
  /** `null` means "let the host pick the model". */
  model?: string | null;
  tools?: string[];
  worktree?: boolean;
}

/**
 * Runs the same prompt once per item, as concurrent sub-agents.
 *
 * `over` resolves to a list — one line per item — so the number of sub-agents
 * is decided at run time by upstream output rather than fixed when the flow is
 * authored. Each sub-agent sees its item as `{{item}}`.
 */
export interface FanOutNode extends FlowNodeCommon {
  type: 'fan-out';
  prompt: string;
  /** A `{{reference}}` or literal list; one item per line. */
  over: string;
  /** How many sub-agents run at once. Defaults to the runner's limit. */
  concurrency?: number;
  model?: string | null;
  tools?: string[];
}

export interface SlashCommandNode extends FlowNodeCommon {
  type: 'slash-command';
  /** Must start with `/`, e.g. `/review`. */
  command: string;
  args?: string;
}

export interface SkillNode extends FlowNodeCommon {
  type: 'skill';
  skill: string;
  input?: string;
}

export interface ShellNode extends FlowNodeCommon {
  type: 'shell';
  /** Shell command line. Named `run` so `command` always means a slash command. */
  run: string;
  cwd?: string;
}

export interface HumanGateNode extends FlowNodeCommon {
  type: 'human-gate';
  message: string;
}

export type FlowNode =
  | AgentNode
  | FanOutNode
  | SlashCommandNode
  | SkillNode
  | ShellNode
  | HumanGateNode;

export interface FlowEdge {
  from: string;
  to: string;
  /** Must match the `output` declared by the `from` node. */
  port?: string;
}

export interface Flow {
  version: 1;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: Record<string, string>;
}

export interface ValidationError {
  /** JSON-ish path to the offending value, e.g. `nodes[2].prompt`. Empty for the root. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; flow: Flow }
  | { valid: false; errors: ValidationError[] };
