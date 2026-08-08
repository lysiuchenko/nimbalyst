// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Flow } from '../../schema/types';
import { parseFlowFile } from '../../schema/validate';
import { flowToGraph } from '../flowGraph';
import { prepareSave } from '../saveFlow';

const flow: Flow = {
  version: 1,
  name: 'pipeline',
  nodes: [
    { id: 'a', type: 'agent', prompt: 'p' },
    { id: 'b', type: 'human-gate', message: 'ok?' },
  ],
  edges: [{ from: 'a', to: 'b' }],
  variables: {},
};

describe('prepareSave', () => {
  it('returns the canonical text for a valid canvas', () => {
    const result = prepareSave(flow, flowToGraph(flow));

    expect(result.ok).toBe(true);
    expect(result.ok && parseFlowFile(result.text).valid).toBe(true);
  });

  it('writes the positions the canvas is showing', () => {
    const graph = flowToGraph(flow);
    graph.nodes[0].position = { x: 7, y: 9 };

    const result = prepareSave(flow, graph);
    const written = result.ok ? parseFlowFile(result.text) : null;

    expect(written?.valid && written.flow.nodes[0].position).toEqual({ x: 7, y: 9 });
  });

  it('refuses to save a canvas the user has cycled', () => {
    const graph = flowToGraph(flow);
    graph.edges.push({ id: 'b->a', source: 'b', target: 'a' });

    const result = prepareSave(flow, graph);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.message)).toEqual([
      'flow contains a cycle: a -> b -> a',
    ]);
  });

  it('refuses to save a node whose required field was cleared', () => {
    const graph = flowToGraph(flow);
    graph.nodes[0].data = { node: { id: 'a', type: 'agent', prompt: '' } };

    const result = prepareSave(flow, graph);

    expect(!result.ok && result.errors.map((e) => e.path)).toEqual(['nodes[0].prompt']);
  });

  it('summarizes errors into a single line for the host error toast', () => {
    const graph = flowToGraph(flow);
    graph.nodes[0].data = { node: { id: 'a', type: 'agent', prompt: '' } };

    const result = prepareSave(flow, graph);

    expect(!result.ok && result.summary).toBe(
      'Flow is invalid and was not saved: nodes[0].prompt: agent node requires a non-empty prompt'
    );
  });

  it('lists at most three errors in the summary and counts the rest', () => {
    const graph = flowToGraph(flow);
    graph.nodes = ['w', 'x', 'y', 'z'].map((id, i) => ({
      id,
      type: 'agent',
      position: { x: i, y: i },
      data: { node: { id, type: 'agent', prompt: '' } },
    }));
    graph.edges = [];

    const result = prepareSave(flow, graph);

    expect(!result.ok && result.summary).toMatch(/\(and 1 more\)$/);
  });
});
