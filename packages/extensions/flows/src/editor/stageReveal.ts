import type { Flow } from '../schema/types';
import { flowToGraph, revealOrder, type FlowGraph } from './flowGraph';

export interface RevealApi {
  setNodes(nodes: FlowGraph['nodes']): void;
  setEdges(edges: FlowGraph['edges']): void;
  addNodes(node: FlowGraph['nodes'][number]): void;
}

/** Milliseconds between revealed nodes — short enough to read as one motion. */
export const STEP_MS = 120;

/**
 * Reveal a validated flow on the canvas one node at a time, roots first, so
 * the pipeline visibly assembles. The canvas is cleared first — nodes AND
 * edges — so a redraft over an existing graph (`editFlow` reuses node ids)
 * never leaves a prior draft's edge connected to a new node mid-reveal. The
 * real edges then land once, after the last node. `schedule` is injected for
 * testing (real callers pass `window.setTimeout`).
 */
export function stageReveal(
  flow: Flow,
  api: RevealApi,
  schedule: (fn: () => void, ms: number) => void
): void {
  const graph = flowToGraph(flow);
  const order = revealOrder(graph.nodes, graph.edges);
  // Clear the canvas — nodes AND edges — so no stale edge from a prior draft
  // stays connected to the new nodes during the reveal (redraft/editFlow reuses
  // node ids). The real edges then land exactly once, after the last node.
  api.setNodes([]);
  api.setEdges([]);
  order.forEach((node, index) => {
    schedule(() => {
      api.addNodes(node);
      if (index === order.length - 1) api.setEdges(graph.edges);
    }, index * STEP_MS);
  });
}
