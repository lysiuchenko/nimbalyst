// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { stageReveal, type RevealApi } from '../stageReveal';
import type { Flow } from '../../schema/types';

const flow: Flow = {
  version: 1,
  name: 'chain',
  nodes: [
    { id: 'save', type: 'write-file', path: 'OUT.md', content: '{{draft.notes}}' },
    { id: 'draft', type: 'agent', prompt: 'from {{log.log}}', output: 'notes' },
    { id: 'log', type: 'shell', run: 'git log', output: 'log' },
  ],
  edges: [
    { from: 'log', to: 'draft', port: 'log' },
    { from: 'draft', to: 'save' },
  ],
  variables: {},
};

function fakeApi() {
  const added: string[] = [];
  const edgeCounts: number[] = [];
  const api: RevealApi = {
    setNodes: () => {},
    setEdges: (edges) => { edgeCounts.push(edges.length); },
    addNodes: (node) => { added.push(node.id); },
  };
  return { api, added, edgeCounts };
}

describe('stageReveal', () => {
  it('reveals every node, roots before dependents', () => {
    const { api, added, edgeCounts } = fakeApi();
    stageReveal(flow, api, (fn) => fn()); // synchronous schedule
    expect(added).toEqual(['log', 'draft', 'save']); // topological, not input order
    // Edges cleared to empty up front (no stale edge lingers), then the real
    // edges land exactly once, after the last node.
    expect(edgeCounts).toEqual([0, 2]);
  });

  it('drops no node even if the graph has a cycle', () => {
    const cyclic: Flow = {
      ...flow,
      edges: [
        { from: 'log', to: 'draft' },
        { from: 'draft', to: 'log' },
      ],
    };
    const { api, added } = fakeApi();
    stageReveal(cyclic, api, (fn) => fn());
    expect(new Set(added)).toEqual(new Set(['log', 'draft', 'save']));
  });
});
