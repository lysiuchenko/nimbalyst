import type { Flow, FlowNode, NodeType } from '../schema/types';
import { validateFlow } from '../schema/validate';
import { interpolate, listReferences, UnresolvedReferenceError } from './interpolate';
import type {
  DagFlowRunnerConfig,
  FlowRunner,
  NodeExecution,
  NodeExecutor,
  RunEvent,
  RunOptions,
  RunState,
  RunStatus,
  TokenUsage,
} from './types';

/** Fields carrying user text, and therefore `{{…}}` references, per node type. */
const TEXT_FIELDS: Record<NodeType, readonly string[]> = {
  agent: ['prompt'],
  'fan-out': ['prompt', 'over'],
  'slash-command': ['command', 'args'],
  skill: ['skill', 'input'],
  shell: ['run', 'cwd'],
  'human-gate': ['message'],
};

const DEFAULT_CONCURRENCY = 4;

/**
 * In-process DAG executor.
 *
 * Nodes run as soon as their own dependencies are satisfied — not in lockstep
 * levels — so a short branch never waits on a long one. Node execution itself
 * is injected, which keeps this file free of any SDK and makes the whole
 * scheduler testable with fakes.
 */
export class DagFlowRunner implements FlowRunner {
  constructor(private readonly config: DagFlowRunnerConfig) {}

  async run(flow: Flow, options: RunOptions = {}): Promise<RunState> {
    const validated = validateFlow(flow);
    if (!validated.valid) {
      throw new Error(
        `cannot run an invalid flow: ${validated.errors
          .map((error) => (error.path ? `${error.path}: ${error.message}` : error.message))
          .join('; ')}`
      );
    }

    const resolvedFlow = validated.flow;
    const variables = { ...resolvedFlow.variables, ...options.variables };
    const now = options.now ?? Date.now;
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    const signal = options.signal;
    const emit = (event: RunEvent) => options.onEvent?.(event);

    preflight(resolvedFlow, variables);

    const startedAt = now();
    const runId = options.runId ?? `run-${crypto.randomUUID()}`;
    const state: RunState = {
      runId,
      flowName: resolvedFlow.name,
      status: 'running',
      startedAt,
      nodes: Object.fromEntries(
        resolvedFlow.nodes.map((node) => [node.id, { nodeId: node.id, status: 'queued' } as NodeExecution])
      ),
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    const notifyState = () => options.onStateChange?.(state);

    emit({ type: 'run-started', runId, flowName: resolvedFlow.name, at: startedAt });
    notifyState();

    const byId = new Map(resolvedFlow.nodes.map((node) => [node.id, node]));
    const children = new Map<string, string[]>();
    const pending = new Map<string, number>();
    for (const node of resolvedFlow.nodes) {
      children.set(node.id, []);
      pending.set(node.id, 0);
    }
    for (const edge of resolvedFlow.edges) {
      children.get(edge.from)!.push(edge.to);
      pending.set(edge.to, (pending.get(edge.to) ?? 0) + 1);
    }

    const ready = resolvedFlow.nodes.filter((node) => pending.get(node.id) === 0).map((node) => node.id);
    const running = new Map<string, Promise<void>>();
    let failed = false;

    const skipDescendants = (nodeId: string) => {
      const queue = [...(children.get(nodeId) ?? [])];
      while (queue.length > 0) {
        const id = queue.shift()!;
        const execution = state.nodes[id];
        if (execution.status !== 'queued') continue;
        execution.status = 'skipped';
        queue.push(...(children.get(id) ?? []));
      }
    };

    const runNode = async (nodeId: string): Promise<void> => {
      const node = byId.get(nodeId)!;
      const execution = state.nodes[nodeId];
      const at = now();
      execution.status = 'running';
      execution.startedAt = at;
      emit({ type: 'node-started', runId, nodeId, at });
      notifyState();

      try {
        const resolved = resolveFields(node, { variables, outputs: state.outputs });
        const result = await this.executorFor(node.type)({
          node,
          resolved,
          variables,
          signal: signal ?? new AbortController().signal,
          // Sub-agents appear while the node runs, so each report is pushed
          // straight through as a state change rather than waiting for the node.
          reportChildren: (children) => {
            execution.children = children;
            notifyState();
          },
        });

        const finishedAt = now();
        execution.status = 'done';
        execution.finishedAt = finishedAt;
        execution.output = result.output;
        execution.sessionId = result.sessionId;
        execution.usage = result.usage;
        addUsage(state.usage, result.usage);

        if (node.output !== undefined && result.output !== undefined) {
          state.outputs[nodeId] = { ...state.outputs[nodeId], [node.output]: result.output };
        }

        emit({ type: 'node-finished', runId, nodeId, at: finishedAt, output: result.output });
        notifyState();

        for (const child of children.get(nodeId) ?? []) {
          pending.set(child, (pending.get(child) ?? 1) - 1);
          if (pending.get(child) === 0) ready.push(child);
        }
      } catch (error) {
        const finishedAt = now();
        const message = error instanceof Error ? error.message : String(error);
        failed = true;
        execution.status = 'failed';
        execution.finishedAt = finishedAt;
        execution.error = message;
        emit({ type: 'node-failed', runId, nodeId, at: finishedAt, error: message });
        skipDescendants(nodeId);
        notifyState();
      }
    };

    while (true) {
      if (signal?.aborted) break;

      while (running.size < concurrency && ready.length > 0) {
        const nodeId = ready.shift()!;
        const promise = runNode(nodeId).finally(() => running.delete(nodeId));
        running.set(nodeId, promise);
      }

      if (running.size === 0) break;
      await Promise.race(running.values());
    }

    await Promise.allSettled(running.values());

    for (const execution of Object.values(state.nodes)) {
      if (execution.status === 'queued') execution.status = 'skipped';
    }

    state.status = resolveStatus(signal?.aborted === true, failed);
    state.finishedAt = now();
    emit({ type: 'run-finished', runId, status: state.status, at: state.finishedAt });
    notifyState();

    return state;
  }

  private executorFor(type: NodeType): NodeExecutor {
    return this.config.executors?.[type] ?? this.config.defaultExecutor;
  }
}

function resolveStatus(aborted: boolean, failed: boolean): RunStatus {
  if (aborted) return 'cancelled';
  return failed ? 'failed' : 'done';
}

/**
 * `{{item}}` belongs to a fan-out's sub-agents, not to the node.
 *
 * It has no value until the list is split, so it resolves to itself here and
 * the fan-out executor substitutes the real item per sub-agent. Without this,
 * preflight would reject a perfectly good fan-out prompt.
 */
function scopeFor(
  node: FlowNode,
  scope: { variables: Record<string, string>; outputs: Record<string, Record<string, string>> }
) {
  return node.type === 'fan-out'
    ? { ...scope, variables: { ...scope.variables, item: '{{item}}' } }
    : scope;
}

function resolveFields(
  node: FlowNode,
  outerScope: { variables: Record<string, string>; outputs: Record<string, Record<string, string>> }
): Record<string, string> {
  const scope = scopeFor(node, outerScope);
  const resolved: Record<string, string> = {};
  for (const field of TEXT_FIELDS[node.type]) {
    const value = (node as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string') resolved[field] = interpolate(value, scope);
  }
  return resolved;
}

function addUsage(total: TokenUsage, usage?: TokenUsage): void {
  if (!usage) return;
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  if (usage.costUsd !== undefined) {
    total.costUsd = Number(((total.costUsd ?? 0) + usage.costUsd).toFixed(10));
  }
}

/**
 * Fail a run before it starts if any reference can never resolve.
 *
 * A reference that only breaks once half the flow has run has already spent
 * tokens and touched the working tree, so this check is worth doing up front.
 */
function preflight(flow: Flow, variables: Record<string, string>): void {
  const outputsByNode: Record<string, Record<string, string>> = {};
  for (const node of flow.nodes) {
    if (node.output !== undefined) outputsByNode[node.id] = { [node.output]: '' };
  }

  for (const node of flow.nodes) {
    for (const field of TEXT_FIELDS[node.type]) {
      const value = (node as unknown as Record<string, unknown>)[field];
      if (typeof value !== 'string') continue;

      const scope = scopeFor(node, { variables, outputs: outputsByNode });
      for (const reference of listReferences(value)) {
        try {
          interpolate(`{{${reference}}}`, scope);
        } catch (error) {
          if (error instanceof UnresolvedReferenceError) {
            const reason = error.message.slice(error.message.indexOf(': ') + 2);
            throw new UnresolvedReferenceError(
              reference,
              `${reason} (node ${JSON.stringify(node.id)}, field ${field})`
            );
          }
          throw error;
        }
      }
    }
  }
}
