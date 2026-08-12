import type { Flow, FlowNode, NodeType } from '../schema/types';

export type NodeStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * `interrupted` is never written by the runner. It is applied afterwards to a
 * record whose run died with the app — see `staleRuns.ts`.
 */
export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

/** A checkout a node ran in — the review surface after the run. */
export interface WorktreeRef {
  id: string;
  branch: string;
  path: string;
}

export interface NodeExecutorResult {
  /** Published under the node's declared `output` port for downstream nodes. */
  output?: string;
  usage?: TokenUsage;
  /** Nimbalyst session this node ran in, when it ran as one (Goal 3.3). */
  sessionId?: string;
  /** Sessions this node's sub-agents ran in, so a fan-out's work is reachable. */
  childSessionIds?: string[];
  /** The checkout this node ran in, when it asked for isolation. */
  worktree?: WorktreeRef;
}

/** One sub-agent inside a fan-out node, as the canvas shows it. */
export interface ChildProgress {
  /** The item this sub-agent was given. */
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  sessionId?: string;
  error?: string;
  /** The isolated checkout this sub-agent worked in, when it got one. */
  worktree?: WorktreeRef;
}

export interface NodeExecutorContext {
  node: FlowNode;
  /** The node's own text fields with every `{{…}}` reference resolved. */
  resolved: Record<string, string>;
  variables: Record<string, string>;
  /** Aborted when the caller cancels the run. */
  signal: AbortSignal;
  /**
   * Publish sub-agent progress. A fan-out node decides how many sub-agents it
   * needs at run time, so the canvas cannot know them ahead of time — this is
   * how they become visible while they run.
   */
  reportChildren?: (children: ChildProgress[]) => void;
}

export type NodeExecutor = (context: NodeExecutorContext) => Promise<NodeExecutorResult>;

export interface NodeExecution {
  nodeId: string;
  /**
   * Fingerprint of the node definition that produced this result, so a later
   * resume can tell a still-valid result from one the author has edited past.
   */
  definitionHash?: string;
  /**
   * Carried over from an earlier run rather than executed in this one.
   * Reused executions keep their output but not their timings or usage —
   * the work cost this run nothing.
   */
  reused?: boolean;
  /**
   * What kind of node this was.
   *
   * Recorded because a run record outlives the flow that produced it: telling
   * agent time from time a person spent at a gate needs the type, and reading
   * it back off the flow file would be wrong the moment the flow is edited.
   */
  type?: NodeType;
  status: NodeStatus;
  /**
   * Something worth knowing about a node that still succeeded — chiefly a
   * declared output that came back empty, which downstream nodes would
   * otherwise interpolate as an empty string without anyone noticing.
   */
  warning?: string;
  /** Sessions this node's sub-agents ran in. */
  childSessionIds?: string[];
  /** Sub-agents spawned by this node, when it fans out. */
  children?: ChildProgress[];
  output?: string;
  error?: string;
  sessionId?: string;
  usage?: TokenUsage;
  /** The isolated checkout this node ran in, when it asked for one. */
  worktree?: WorktreeRef;
  startedAt?: number;
  finishedAt?: number;
}

export interface RunState {
  runId: string;
  flowName: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  nodes: Record<string, NodeExecution>;
  /** Published outputs, keyed by node id then port name. */
  outputs: Record<string, Record<string, string>>;
  usage: TokenUsage;
  /** Set when this run reused results from an earlier, failed run. */
  resumedFrom?: string;
}

export type RunEvent =
  | { type: 'run-started'; runId: string; flowName: string; at: number }
  | { type: 'node-started'; runId: string; nodeId: string; at: number }
  | { type: 'node-finished'; runId: string; nodeId: string; at: number; output?: string }
  | { type: 'node-failed'; runId: string; nodeId: string; at: number; error: string }
  | { type: 'run-finished'; runId: string; status: RunStatus; at: number };

/** Results carried in from an earlier run instead of being re-executed. */
export interface ResumeSeed {
  resumedFrom: string;
  executions: Record<string, NodeExecution>;
  outputs: Record<string, Record<string, string>>;
}

export interface RunOptions {
  /** Merged over the flow's own `variables`. */
  variables?: Record<string, string>;
  /** Pre-completed nodes from a failed run; see `planResume`. */
  seed?: ResumeSeed;
  concurrency?: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /**
   * Called whenever a node changes state. Lets the run record be written as the
   * run progresses, so an interrupted run still leaves a usable record.
   */
  onStateChange?: (state: RunState) => void;
  runId?: string;
  /** Injected clock, so timings are assertable without faking timers. */
  now?: () => number;
}

/**
 * The single seam between a flow and whatever executes it.
 *
 * Everything above this interface (UI, run state, cost reporting) is unaware of
 * how nodes actually run, so the in-process DAG executor can later be swapped
 * for a durable engine without touching callers.
 */
export interface FlowRunner {
  run(flow: Flow, options?: RunOptions): Promise<RunState>;
}

export interface DagFlowRunnerConfig {
  /** Per-node-type executors. Anything absent falls back to `defaultExecutor`. */
  executors?: Partial<Record<NodeType, NodeExecutor>>;
  defaultExecutor: NodeExecutor;
}
