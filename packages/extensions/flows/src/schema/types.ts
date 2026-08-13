import type { FlowSchedule } from '../schedule/types';

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
  'write-file',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export interface NodePosition {
  x: number;
  y: number;
}

interface FlowNodeCommon {
  /** Unique within the flow. Referenced by edges and by `{{id.port}}`. */
  id: string;
  /**
   * How incoming edges combine. `all` (the default, and the only meaning
   * before joins existed): wait for every edge. `any`: run on the first live
   * edge — what lets the two arms of a conditional fork meet again, since one
   * arm of a fork is always dead.
   */
  join?: 'all' | 'any';
  /**
   * Additional attempts after a failure — `2` means three tries in all.
   * Refused on `human-gate`: a rejection is a decision, not a flake.
   */
  retries?: number;
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
  /**
   * Give every sub-agent its own git worktree.
   *
   * Sub-agents run concurrently, so without this they all edit the same
   * checkout and can overwrite each other. Each one gets an isolated branch
   * whose diff is reviewable on its own.
   */
  worktree?: boolean;
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

/**
 * Write a file into the workspace — the step that makes a flow produce
 * something rather than leaving its result in a run record.
 */
export interface WriteFileNode extends FlowNodeCommon {
  type: 'write-file';
  /** Workspace-relative. Absolute paths, `..` escapes and `.git` are rejected. */
  path: string;
  /** Usually a `{{reference}}`. An empty string writes an empty file. */
  content: string;
}

export type FlowNode =
  | AgentNode
  | FanOutNode
  | SlashCommandNode
  | SkillNode
  | ShellNode
  | HumanGateNode
  | WriteFileNode;

export interface FlowEdge {
  from: string;
  to: string;
  /** Must match the `output` declared by the `from` node. */
  port?: string;
  /**
   * When this edge fires. Absent means `success` — the only meaning edges had
   * before conditions existed, so every existing flow keeps its behaviour.
   * `failure` routes a failed step (a rejected gate included) to a handler
   * instead of failing the run.
   */
  on?: 'success' | 'failure';
  /**
   * Data-driven routing: `{{from.port}} contains|==|!= "literal"`, evaluated
   * when `from` completes with the outcome `on` selects. False or
   * unresolvable means the edge is dead. The reference must name this edge's
   * own `from` node.
   */
  when?: string;
}

export interface Flow {
  version: 1;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables: Record<string, string>;
  /** When this flow runs on its own. Absent means only when someone presses Run. */
  schedule?: FlowSchedule;
  /**
   * How long this work takes a person by hand, in minutes.
   *
   * The one number no run record can know. Supplied by the flow's author so the
   * dashboard can show time saved as *their* estimate rather than one invented
   * by a multiplier. Absent means the figure is simply not shown.
   */
  manualBaselineMinutes?: number;
}

export interface ValidationError {
  /** JSON-ish path to the offending value, e.g. `nodes[2].prompt`. Empty for the root. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; flow: Flow }
  | { valid: false; errors: ValidationError[] };
