import { listReferences, referenceArms } from '../runner/interpolate';
import type { Flow, FlowNode, NodeType } from '../schema/types';
import { validateFlow } from '../schema/validate';

/** Text fields per node type — mirrors the executor's TEXT_FIELDS. */
const TEXT_FIELDS: Record<NodeType, readonly string[]> = {
  agent: ['prompt'],
  'fan-out': ['prompt', 'over'],
  'slash-command': ['command', 'args'],
  skill: ['skill', 'input'],
  'human-gate': ['message'],
  shell: ['run', 'cwd'],
  'write-file': ['path', 'content'],
};

/** Every node id that can run before `nodeId`. */
function ancestorsOf(flow: Flow, nodeId: string): Set<string> {
  const parents = new Map<string, string[]>();
  for (const edge of flow.edges) {
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
  }

  const seen = new Set<string>();
  const queue = [...(parents.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(parents.get(id) ?? []));
  }
  return seen;
}

/**
 * The `{{…}}` references each node may legally use.
 *
 * Only genuinely upstream outputs are offered: a reference to a node that runs
 * later can never resolve, so suggesting it would be a trap.
 */
export function referencesByNode(flow: Flow): Record<string, string[]> {
  const variables = Object.keys(flow.variables);
  const outputOf = new Map(flow.nodes.filter((n) => n.output).map((n) => [n.id, n.output!]));

  // A failure edge's handler reads what went wrong: `error` is an implicit
  // port every node publishes when it fails, so a handler may reference
  // `{{parent.error}}` for any parent it is wired to by a failure edge.
  const failureParents = new Map<string, string[]>();
  for (const edge of flow.edges) {
    if (edge.on !== 'failure') continue;
    failureParents.set(edge.to, [...(failureParents.get(edge.to) ?? []), edge.from]);
  }

  return Object.fromEntries(
    flow.nodes.map((node) => {
      const upstream = [...ancestorsOf(flow, node.id)]
        .filter((id) => outputOf.has(id))
        .map((id) => `${id}.${outputOf.get(id)}`);
      const errors = (failureParents.get(node.id) ?? []).map((id) => `${id}.error`);
      // A fan-out's prompt is written for one sub-agent, so `item` is a real
      // input there even though it exists nowhere else in the flow.
      const own = node.type === 'fan-out' ? ['item'] : [];
      return [node.id, [...own, ...errors, ...upstream, ...variables]];
    })
  );
}

/**
 * Validation errors grouped by the node they belong to, so the canvas can show
 * a problem on the node that has it instead of only in a banner.
 *
 * Flow-level errors (cycles, document shape) are deliberately excluded — they
 * belong to no single node and the banner already reports them.
 */
export function issuesByNode(flow: Flow): Record<string, string[]> {
  const issues: Record<string, string[]> = {};
  const add = (nodeId: string, message: string) => {
    issues[nodeId] = [...(issues[nodeId] ?? []), message];
  };

  const result = validateFlow(flow);
  if (!result.valid) {
    for (const error of result.errors) {
      const match = /^nodes\[(\d+)]/.exec(error.path);
      if (!match) continue;
      const node = flow.nodes[Number(match[1])];
      if (node?.id) add(node.id, error.message);
    }
  }

  const available = referencesByNode(flow);
  for (const node of flow.nodes) {
    for (const field of TEXT_FIELDS[node.type] ?? []) {
      const value = (node as unknown as Record<string, unknown>)[field];
      if (typeof value !== 'string') continue;

      for (const expression of listReferences(value)) {
        // A fallback chain needs only one satisfiable arm — that is the point
        // of writing one. A literal arm satisfies it outright.
        const { references: arms, literal } = referenceArms(expression);
        if (literal !== undefined) continue;
        if (arms.some((arm) => available[node.id]?.includes(arm))) continue;
        add(
          node.id,
          expression.includes('.')
            ? `{{${expression}}} is not available here — that output is not upstream of this node`
            : `{{${expression}}} is not a flow variable`
        );
      }
    }
  }

  return issues;
}

/** Convenience for the inspector: the node's own text fields. */
export function textFieldsOf(node: FlowNode): readonly string[] {
  return TEXT_FIELDS[node.type] ?? [];
}
