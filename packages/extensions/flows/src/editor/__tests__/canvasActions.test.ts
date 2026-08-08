// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FlowNode } from '../../schema/types';
import { duplicateNode, renameVariable, uniqueNodeId, validVariableName } from '../canvasActions';
import type { FlowCanvasNode } from '../flowGraph';

function canvasNode(id: string, node: Partial<FlowNode> = {}): FlowCanvasNode {
  return {
    id,
    type: (node.type ?? 'agent') as string,
    position: { x: 10, y: 20 },
    data: { node: { id, type: 'agent', prompt: 'p', ...node } as FlowNode },
  };
}

describe('uniqueNodeId', () => {
  it('uses the plain name when it is free', () => {
    expect(uniqueNodeId('agent', new Set())).toBe('agent');
  });

  it('numbers a name that is taken', () => {
    expect(uniqueNodeId('agent', new Set(['agent']))).toBe('agent-2');
  });

  it('keeps counting past a gap rather than reusing a taken id', () => {
    expect(uniqueNodeId('agent', new Set(['agent', 'agent-2', 'agent-3']))).toBe('agent-4');
  });
});

describe('duplicateNode', () => {
  it('gives the copy a new id so the flow stays valid', () => {
    const copy = duplicateNode(canvasNode('plan'), [canvasNode('plan')]);

    expect(copy.id).toBe('plan-2');
    expect(copy.data.node.id).toBe('plan-2');
  });

  it('offsets the copy so it does not land exactly on the original', () => {
    const copy = duplicateNode(canvasNode('plan'), [canvasNode('plan')]);

    expect(copy.position).not.toEqual({ x: 10, y: 20 });
  });

  it('copies the work, which is the whole point of duplicating', () => {
    const original = canvasNode('plan', { prompt: 'a long prompt', tools: ['Read'] } as Partial<FlowNode>);

    const copy = duplicateNode(original, [original]);

    expect(copy.data.node).toMatchObject({ prompt: 'a long prompt', tools: ['Read'] });
  });

  it('does not copy the output port, since two nodes publishing the same name is ambiguous', () => {
    const original = canvasNode('plan', { output: 'plan_md' } as Partial<FlowNode>);

    const copy = duplicateNode(original, [original]);

    expect(copy.data.node.output).toBeUndefined();
  });

  it('keeps the same node type', () => {
    const original = canvasNode('gate', { type: 'human-gate', message: 'ok?' } as Partial<FlowNode>);

    expect(duplicateNode(original, [original]).type).toBe('human-gate');
  });
});

describe('validVariableName', () => {
  it.each([['task'], ['input_path'], ['a1']])('accepts %s', (name) => {
    expect(validVariableName(name)).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validVariableName('')).toMatch(/name/i);
  });

  it('rejects a name with a dot, which would look like a node output', () => {
    expect(validVariableName('plan.md')).toMatch(/letters|dot|invalid/i);
  });

  it('rejects spaces, which would break the {{…}} reference', () => {
    expect(validVariableName('my var')).toBeDefined();
  });
});

describe('renameVariable', () => {
  it('renames the variable and rewrites every reference to it', () => {
    const flow = {
      version: 1 as const,
      name: 'f',
      nodes: [
        { id: 'a', type: 'agent' as const, prompt: 'do {{task}} now' },
        { id: 'b', type: 'shell' as const, run: 'echo {{task}}' },
      ],
      edges: [],
      variables: { task: 'x' },
    };

    const next = renameVariable(flow, 'task', 'goal');

    expect(next.variables).toEqual({ goal: 'x' });
    expect(next.nodes[0]).toMatchObject({ prompt: 'do {{goal}} now' });
    expect(next.nodes[1]).toMatchObject({ run: 'echo {{goal}}' });
  });

  it('leaves a similarly-named reference alone', () => {
    const flow = {
      version: 1 as const,
      name: 'f',
      nodes: [{ id: 'a', type: 'agent' as const, prompt: '{{task}} and {{taskable}}' }],
      edges: [],
      variables: { task: 'x', taskable: 'y' },
    };

    expect(renameVariable(flow, 'task', 'goal').nodes[0]).toMatchObject({
      prompt: '{{goal}} and {{taskable}}',
    });
  });

  it('tolerates whitespace inside the braces', () => {
    const flow = {
      version: 1 as const,
      name: 'f',
      nodes: [{ id: 'a', type: 'agent' as const, prompt: '{{  task  }}' }],
      edges: [],
      variables: { task: 'x' },
    };

    expect(renameVariable(flow, 'task', 'goal').nodes[0]).toMatchObject({ prompt: '{{goal}}' });
  });
});
