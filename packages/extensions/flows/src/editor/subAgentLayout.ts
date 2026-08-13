/** Card geometry, in flow coordinates. */
export const SUBAGENT_CARD = {
  width: 170,
  // Two rows: label, then one clamped line of what the sub-agent produced.
  height: 48,
  gap: 8,
  /** Clear space between the parent's right edge and the stack. */
  offset: 40,
} as const;

export interface ParentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node's box, using its measured size once xyflow has one. */
export function boxFor(node: {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
}): ParentBox {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? 260,
    height: node.measured?.height ?? 140,
  };
}

/** The smallest box covering all of them, or null when there are none. */
export function unionOf(boxes: ParentBox[]): ParentBox | null {
  if (boxes.length === 0) return null;

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface SubAgentCard {
  x: number;
  y: number;
  /** Where the connector leaves the parent. */
  from: { x: number; y: number };
  /** Where it meets this card. */
  to: { x: number; y: number };
}

/**
 * Lay a fan-out node's sub-agents out as a stack to its right.
 *
 * Positions are derived rather than stored: sub-agents exist only while a run
 * is in flight, so putting them in the document would persist run state into
 * `.flow.json` and mark the file dirty. The stack is centred on the parent so
 * the connectors read as a fan whatever the item count.
 */
export function layoutSubAgents(parent: ParentBox, count: number): SubAgentCard[] {
  if (count <= 0) return [];

  const pitch = SUBAGENT_CARD.height + SUBAGENT_CARD.gap;
  const stackHeight = count * pitch - SUBAGENT_CARD.gap;
  const centre = parent.y + parent.height / 2;
  const x = parent.x + parent.width + SUBAGENT_CARD.offset;
  const from = { x: parent.x + parent.width, y: centre };

  return Array.from({ length: count }, (_, index) => {
    const y = centre - stackHeight / 2 + index * pitch;
    return { x, y, from, to: { x, y: y + SUBAGENT_CARD.height / 2 } };
  });
}
