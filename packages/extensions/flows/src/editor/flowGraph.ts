import type { Edge, Node } from '@xyflow/react';
import type { Flow, FlowEdge, FlowNode, NodePosition } from '../schema/types';

/** Payload every canvas node carries: the flow node it stands for. */
export interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode;
}

export type FlowCanvasNode = Node<FlowNodeData>;
export type FlowCanvasEdge = Edge;

export interface FlowGraph {
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
}

/** Layout grid for nodes whose file has no `position` yet. */
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 140;

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Project a flow onto the canvas.
 *
 * Nodes without a stored position get a deterministic layered layout — column
 * by longest path from a root, row by order within that column — so a
 * hand-authored flow opens as a readable left-to-right pipeline instead of a
 * pile at the origin.
 */
export function flowToGraph(flow: Flow): FlowGraph {
  const positions = layoutPositions(flow);

  return {
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position ?? positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node },
    })),
    edges: flow.edges.map((edge) => {
      const canvasEdge: FlowCanvasEdge = {
        id: edgeId(edge.from, edge.to),
        source: edge.from,
        target: edge.to,
      };
      if (edge.port !== undefined) canvasEdge.label = edge.port;
      return canvasEdge;
    }),
  };
}

function layoutPositions(flow: Flow): Map<string, NodePosition> {
  const depth = new Map<string, number>();
  for (const node of flow.nodes) depth.set(node.id, 0);

  // Relax depths until stable. The flow is a validated DAG, so |nodes| passes
  // is always enough and a malformed graph still terminates.
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let changed = false;
    for (const edge of flow.edges) {
      const next = (depth.get(edge.from) ?? 0) + 1;
      if (next > (depth.get(edge.to) ?? 0)) {
        depth.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const rowsUsed = new Map<number, number>();
  const positions = new Map<string, NodePosition>();
  for (const node of flow.nodes) {
    const column = depth.get(node.id) ?? 0;
    const row = rowsUsed.get(column) ?? 0;
    rowsUsed.set(column, row + 1);
    positions.set(node.id, { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT });
  }
  return positions;
}

/**
 * Read the canvas back into a flow.
 *
 * `base` supplies the document-level fields the canvas does not own (name,
 * variables); everything else comes from the live graph, so nodes the user
 * moved, added, or deleted and edges they drew or cut are all captured.
 */
export function graphToFlow(base: Flow, graph: FlowGraph): Flow {
  const nodes: FlowNode[] = graph.nodes.map((canvasNode) => ({
    ...canvasNode.data.node,
    position: canvasNode.position,
  }));

  const portByEdge = new Map(base.edges.map((edge) => [edgeId(edge.from, edge.to), edge.port]));

  // A connection can end up in the canvas store more than once (xyflow adds the
  // edge itself on connect, and a re-drawn link repeats the pair). The file
  // records one edge per node pair.
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();

  for (const canvasEdge of graph.edges) {
    const key = edgeId(canvasEdge.source, canvasEdge.target);
    if (seen.has(key)) continue;
    seen.add(key);

    const edge: FlowEdge = { from: canvasEdge.source, to: canvasEdge.target };
    const port = typeof canvasEdge.label === 'string' ? canvasEdge.label : portByEdge.get(key);
    if (port !== undefined) edge.port = port;
    edges.push(edge);
  }

  return { version: 1, name: base.name, nodes, edges, variables: base.variables };
}

/** Roughly a node's footprint, used to decide whether a spot is free. */
const NODE_WIDTH = 260;
const NODE_HEIGHT = 200;

/**
 * Find free space for a node the user just added.
 *
 * Dropping every new node at a fixed offset buries them in a pile the user then
 * has to drag apart, which is exactly the friction the canvas is meant to
 * remove. Search right first, then wrap to the next row.
 */
export function placeNewNode(
  existing: { position: NodePosition }[],
  preferred: NodePosition
): NodePosition {
  const occupied = (spot: NodePosition) =>
    existing.some(
      (node) =>
        Math.abs(node.position.x - spot.x) < NODE_WIDTH &&
        Math.abs(node.position.y - spot.y) < NODE_HEIGHT
    );

  for (let row = 0; row < 50; row++) {
    for (let column = 0; column < 10; column++) {
      const spot = {
        x: preferred.x + column * NODE_WIDTH,
        y: preferred.y + row * NODE_HEIGHT,
      };
      if (!occupied(spot)) return spot;
    }
  }
  return preferred;
}
