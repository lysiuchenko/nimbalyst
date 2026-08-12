import type { Flow, FlowEdge, FlowNode, NodeType } from '../schema/types';
import { validateFlow } from '../schema/validate';
import { nodeDefinitionHash } from './resume';
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
  // The path is resolved too, so a flow can compute where it writes.
  'write-file': ['path', 'content'],
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
    // Nodes carried in from a failed run start finished; see `planResume` for
    // the rule that decides which results are still trustworthy.
    const seed = options.seed;
    const state: RunState = {
      runId,
      flowName: resolvedFlow.name,
      status: 'running',
      startedAt,
      nodes: Object.fromEntries(
        resolvedFlow.nodes.map((node) => [
          node.id,
          seed?.executions[node.id] ??
            ({
              nodeId: node.id,
              type: node.type,
              status: 'queued',
              // Stamped now so a future resume can tell whether this node has
              // been edited since it produced its result.
              definitionHash: nodeDefinitionHash(node),
            } as NodeExecution),
        ])
      ),
      outputs: { ...seed?.outputs },
      usage: { inputTokens: 0, outputTokens: 0 },
      ...(seed ? { resumedFrom: seed.resumedFrom } : {}),
    };

    const notifyState = () => options.onStateChange?.(state);

    emit({ type: 'run-started', runId, flowName: resolvedFlow.name, at: startedAt });
    notifyState();

    const byId = new Map(resolvedFlow.nodes.map((node) => [node.id, node]));
    // Whole edges, not just target ids: which way a completion routes depends
    // on each edge's condition.
    const childEdges = new Map<string, FlowEdge[]>();
    const pending = new Map<string, number>();
    for (const node of resolvedFlow.nodes) {
      childEdges.set(node.id, []);
      pending.set(node.id, 0);
    }
    for (const edge of resolvedFlow.edges) {
      childEdges.get(edge.from)!.push(edge);
      pending.set(edge.to, (pending.get(edge.to) ?? 0) + 1);
    }

    // How many incoming edges could still fire, per node. An `all` join dies
    // with its first dead edge; an `any` join dies only when this hits zero.
    const liveIncoming = new Map<string, number>();
    for (const node of resolvedFlow.nodes) liveIncoming.set(node.id, 0);
    for (const edge of resolvedFlow.edges) {
      liveIncoming.set(edge.to, (liveIncoming.get(edge.to) ?? 0) + 1);
    }

    const joinOf = (nodeId: string) => byId.get(nodeId)?.join ?? 'all';

    const ready: string[] = [];
    const running = new Map<string, Promise<void>>();
    let failed = false;

    // A skipped node can neither succeed nor fail, so every edge out of it is
    // dead, whatever its condition.
    const skipNode = (nodeId: string) => {
      const execution = state.nodes[nodeId];
      if (execution.status !== 'queued') return;
      execution.status = 'skipped';
      for (const edge of childEdges.get(nodeId) ?? []) killEdge(edge.to);
    };

    /** One incoming edge of `nodeId` can no longer fire. */
    const killEdge = (nodeId: string) => {
      liveIncoming.set(nodeId, (liveIncoming.get(nodeId) ?? 1) - 1);
      if (state.nodes[nodeId].status !== 'queued') return;
      // An AND-join with a dead edge is unreachable outright; an any-join
      // survives until its last edge dies.
      if (joinOf(nodeId) === 'all' || liveIncoming.get(nodeId) === 0) {
        skipNode(nodeId);
      }
    };

    /** Fire the edges matching an outcome; the rest are dead ends. */
    const routeCompletion = (nodeId: string, outcome: 'success' | 'failure') => {
      for (const edge of childEdges.get(nodeId) ?? []) {
        const matches = (edge.on ?? 'success') === outcome;
        if (!matches) {
          killEdge(edge.to);
          continue;
        }
        pending.set(edge.to, (pending.get(edge.to) ?? 1) - 1);
        if (state.nodes[edge.to].status !== 'queued') continue;
        // `any` dispatches on its first live edge; `all` when the last arrives.
        // The scheduler re-checks status at pop, so a double push cannot run a
        // node twice.
        if (joinOf(edge.to) === 'any' || pending.get(edge.to) === 0) {
          ready.push(edge.to);
        }
      }
    };

    // A seeded node is already finished: route its completion before the loop
    // starts, exactly as if it had just run. Seeds are always successes
    // (`planResume` reuses only done nodes), so their failure edges die here.
    for (const node of resolvedFlow.nodes) {
      if (seed?.executions[node.id]) routeCompletion(node.id, 'success');
    }
    for (const node of resolvedFlow.nodes) {
      const hasParents = resolvedFlow.edges.some((edge) => edge.to === node.id);
      if (!hasParents && !seed?.executions[node.id] && !ready.includes(node.id)) {
        ready.push(node.id);
      }
    }

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
        execution.childSessionIds = result.childSessionIds;
        execution.usage = result.usage;
        // Onto the record: a checkout that is not written down is unfindable
        // the moment the run panel closes.
        if (result.worktree) execution.worktree = result.worktree;
        addUsage(state.usage, result.usage);

        if (node.output !== undefined && result.output !== undefined) {
          if (result.output.trim() === '') {
            execution.warning =
              `published an empty ${node.output} — downstream nodes will read "" from ` +
              `{{${nodeId}.${node.output}}}`;
          }
          state.outputs[nodeId] = { ...state.outputs[nodeId], [node.output]: result.output };
        }

        emit({ type: 'node-finished', runId, nodeId, at: finishedAt, output: result.output });
        notifyState();

        routeCompletion(nodeId, 'success');
      } catch (error) {
        const finishedAt = now();
        const message = error instanceof Error ? error.message : String(error);
        execution.status = 'failed';
        execution.finishedAt = finishedAt;
        execution.error = message;

        // A failure with a handler is a branch taken, not a run lost. The node
        // still records `failed` — that is what happened — but only a failure
        // nothing catches marks the run itself failed.
        const handled = (childEdges.get(nodeId) ?? []).some((edge) => edge.on === 'failure');
        if (!handled) failed = true;

        // The handler's one input is what went wrong, published as the
        // implicit `error` port so it can read {{node.error}}.
        state.outputs[nodeId] = { ...state.outputs[nodeId], error: message };

        emit({ type: 'node-failed', runId, nodeId, at: finishedAt, error: message });
        routeCompletion(nodeId, 'failure');
        notifyState();
      }
    };

    while (true) {
      if (signal?.aborted) break;

      while (running.size < concurrency && ready.length > 0) {
        const nodeId = ready.shift()!;
        // An any-join can be pushed by more than one parent; only the first
        // dispatch finds it still queued.
        if (state.nodes[nodeId].status !== 'queued') continue;
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
    // `error` is a port every node has: a failure publishes its message there,
    // which is what a failure-edge handler reads via {{node.error}}.
    outputsByNode[node.id] = { error: '', ...(node.output !== undefined ? { [node.output]: '' } : {}) };
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
