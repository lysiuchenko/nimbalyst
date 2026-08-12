// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { gateContext } from '../gateContext';
import type { Flow, FlowNode } from '../../schema/types';
import type { NodeExecution } from '../../runner/types';

const flow: Flow = {
  version: 1,
  name: 'gated',
  nodes: [
    { id: 'draft', type: 'agent', prompt: 'p', label: 'Draft notes', output: 'notes' },
    { id: 'audit', type: 'skill', skill: 's', label: 'Security pass' },
    { id: 'other', type: 'agent', prompt: 'q' },
    { id: 'gate', type: 'human-gate', message: 'Publish?' },
    { id: 'later', type: 'agent', prompt: 'r' },
  ],
  edges: [
    { from: 'draft', to: 'gate' },
    { from: 'audit', to: 'gate' },
    { from: 'gate', to: 'later' },
    { from: 'other', to: 'later' },
  ],
  variables: {},
} as Flow;

const done = (nodeId: string, output: string): NodeExecution => ({
  nodeId,
  status: 'done',
  output,
});

describe('gateContext', () => {
  test('collects the direct parents, in edge order, with their labels', () => {
    const context = gateContext(flow, 'gate', {
      draft: done('draft', 'The report body'),
      audit: done('audit', 'No security findings.'),
    });

    expect(context).toEqual([
      { nodeId: 'draft', label: 'Draft notes', output: 'The report body' },
      { nodeId: 'audit', label: 'Security pass', output: 'No security findings.' },
    ]);
  });

  test('a node that is not a parent contributes nothing, however finished', () => {
    const context = gateContext(flow, 'gate', {
      draft: done('draft', 'x'),
      other: done('other', 'unrelated'),
      later: done('later', 'downstream'),
    });

    expect(context.map((entry) => entry.nodeId)).toEqual(['draft']);
  });

  test('a parent with no output yet is skipped rather than shown empty', () => {
    const context = gateContext(flow, 'gate', {
      draft: done('draft', 'x'),
      audit: { nodeId: 'audit', status: 'running' },
    });

    expect(context.map((entry) => entry.nodeId)).toEqual(['draft']);
  });

  test('falls back to the node id when there is no label', () => {
    const bare: Flow = {
      ...flow,
      nodes: flow.nodes.map((node) =>
        node.id === 'draft' ? ({ ...node, label: undefined } as FlowNode) : node
      ),
    } as Flow;

    expect(gateContext(bare, 'gate', { draft: done('draft', 'x') })[0].label).toBe('draft');
  });

  test('an unknown gate id yields nothing', () => {
    expect(gateContext(flow, 'missing', {})).toEqual([]);
  });
});
