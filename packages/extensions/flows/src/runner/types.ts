import type { Flow, FlowNode, NodeType } from '../schema/types';

export type NodeStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface NodeExecutorResult {
  /** Published under the node's declared `output` port for downstream nodes. */
  output?: string;
  usage?: TokenUsage;
  /** Nimbalyst session this node ran in, when it ran as one (Goal 3.3). */
  sessionId?: string;
}

export interface NodeExecutorContext {
  node: FlowNode;
  /** The node's own text fields with every `{{…}}` reference resolved. */
  resolved: Record<string, string>;
  variables: Record<string, string>;
  /** Aborted when the caller cancels the run. */
  signal: AbortSignal;
}

export type NodeExecutor = (context: NodeExecutorContext) => Promise<NodeExecutorResult>;

export interface NodeExecution {
  nodeId: string;
  status: NodeStatus;
  output?: string;
  error?: string;
  sessionId?: string;
  usage?: TokenUsage;
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
}

export type RunEvent =
  | { type: 'run-started'; runId: string; flowName: string; at: number }
  | { type: 'node-started'; runId: string; nodeId: string; at: number }
  | { type: 'node-finished'; runId: string; nodeId: string; at: number; output?: string }
  | { type: 'node-failed'; runId: string; nodeId: string; at: number; error: string }
  | { type: 'run-finished'; runId: string; status: RunStatus; at: number };

export interface RunOptions {
  /** Merged over the flow's own `variables`. */
  variables?: Record<string, string>;
  concurrency?: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
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
