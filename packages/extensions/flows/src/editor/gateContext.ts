import type { Flow } from '../schema/types';
import type { NodeExecution } from '../runner/types';

/**
 * What a pending gate is actually gating.
 *
 * A gate exists so a person can review work before it proceeds — but the
 * approval card used to show only the gate's own message, so the person
 * approved blind or went digging through sessions mid-run. This selects the
 * gate's direct parents' outputs from the live run state: the work, put in
 * front of the decision.
 *
 * Direct parents only. Transitive ancestors fed *into* the parents; what the
 * gate guards is what arrives at it.
 */
export interface GateContextEntry {
  nodeId: string;
  label: string;
  output: string;
}

export function gateContext(
  flow: Flow,
  gateId: string,
  nodes: Record<string, NodeExecution | undefined>
): GateContextEntry[] {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));

  return flow.edges
    .filter((edge) => edge.to === gateId)
    .flatMap((edge) => {
      const execution = nodes[edge.from];
      // Skipped rather than shown empty: a parent still running has nothing to
      // review yet, and an empty panel reads as "the work is blank".
      if (!execution?.output) return [];
      const node = byId.get(edge.from);
      return [
        {
          nodeId: edge.from,
          label: node?.label ?? edge.from,
          output: execution.output,
        },
      ];
    });
}
