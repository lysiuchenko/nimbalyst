// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SUBAGENT_CARD, boxFor, layoutSubAgents, unionOf } from '../subAgentLayout';

const parent = { x: 100, y: 200, width: 240, height: 120 };

describe('layoutSubAgents', () => {
  it('places one card per sub-agent, stacked to the right of its parent', () => {
    const cards = layoutSubAgents(parent, 3);

    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.x === cards[0].x)).toBe(true);
    expect(cards[0].x).toBeGreaterThan(parent.x + parent.width);
    expect(cards[1].y - cards[0].y).toBe(SUBAGENT_CARD.height + SUBAGENT_CARD.gap);
  });

  it('centres the stack on the parent so the fan reads symmetrically', () => {
    const [single] = layoutSubAgents(parent, 1);

    expect(single.y + SUBAGENT_CARD.height / 2).toBe(parent.y + parent.height / 2);
  });

  it('draws a connector from the parent edge to each card', () => {
    const cards = layoutSubAgents(parent, 2);

    for (const card of cards) {
      expect(card.from).toEqual({ x: parent.x + parent.width, y: parent.y + parent.height / 2 });
      expect(card.to).toEqual({ x: card.x, y: card.y + SUBAGENT_CARD.height / 2 });
    }
  });

  it('has nothing to lay out for a parent with no sub-agents', () => {
    expect(layoutSubAgents(parent, 0)).toEqual([]);
  });
});

describe('boxFor', () => {
  it('reads a measured node', () => {
    expect(boxFor({ position: { x: 5, y: 6 }, measured: { width: 200, height: 90 } })).toEqual({
      x: 5,
      y: 6,
      width: 200,
      height: 90,
    });
  });

  it('falls back to a card-sized box before the node has been measured', () => {
    const box = boxFor({ position: { x: 5, y: 6 } });

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe('unionOf', () => {
  it('covers every box it is given', () => {
    expect(
      unionOf([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 90, y: 40, width: 10, height: 10 },
      ])
    ).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('has no bounds to fit when there is nothing on the canvas', () => {
    expect(unionOf([])).toBeNull();
  });
});
