// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Flow } from '../../schema/types';
import { issuesByNode, referencesByNode } from '../references';

const flow: Flow = {
  version: 1,
  name: 'refs',
  nodes: [
    { id: 'plan', type: 'agent', prompt: 'p', output: 'plan_md' },
    { id: 'impl', type: 'agent', prompt: 'q', output: 'diff' },
    { id: 'review', type: 'agent', prompt: 'r' },
    { id: 'lonely', type: 'agent', prompt: 's' },
  ],
  edges: [
    { from: 'plan', to: 'impl' },
    { from: 'impl', to: 'review' },
  ],
  variables: { target: 'the API' },
};

describe('referencesByNode', () => {
  it('offers the flow variables to every node', () => {
    const refs = referencesByNode(flow);

    expect(refs.plan).toContain('target');
    expect(refs.lonely).toContain('target');
  });

  it('offers a node the outputs of everything upstream of it, not just its parent', () => {
    const refs = referencesByNode(flow);

    expect(refs.review).toEqual(expect.arrayContaining(['plan.plan_md', 'impl.diff', 'target']));
  });

  it('does not offer an output the node cannot have yet', () => {
    const refs = referencesByNode(flow);

    // `impl` runs before `review`, so its output is not available to `plan`.
    expect(refs.plan).not.toContain('impl.diff');
    expect(refs.lonely).not.toContain('plan.plan_md');
  });

  it('does not offer a node its own output', () => {
    expect(referencesByNode(flow).impl).not.toContain('impl.diff');
  });

  it('ignores upstream nodes that publish nothing', () => {
    const refs = referencesByNode({
      ...flow,
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p' },
        { id: 'b', type: 'agent', prompt: 'q' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    expect(refs.b).toEqual(['target']);
  });
});

describe('issuesByNode', () => {
  it('attaches each validation error to the node it belongs to', () => {
    const broken: Flow = {
      ...flow,
      nodes: [
        { id: 'plan', type: 'agent', prompt: '' },
        { id: 'gate', type: 'human-gate', message: '' },
      ],
      edges: [],
    };

    const issues = issuesByNode(broken);

    expect(issues.plan?.[0]).toContain('non-empty prompt');
    expect(issues.gate?.[0]).toContain('non-empty message');
  });

  it('reports a reference that can never resolve, on the node that uses it', () => {
    const issues = issuesByNode({
      ...flow,
      nodes: [{ id: 'plan', type: 'agent', prompt: 'use {{nope}} and {{plan.self}}' }],
      edges: [],
    });

    expect(issues.plan?.join(' ')).toContain('{{nope}}');
  });

  it('reports an upstream output that is not actually upstream', () => {
    const issues = issuesByNode({
      ...flow,
      nodes: [
        { id: 'a', type: 'agent', prompt: 'uses {{b.out}}' },
        { id: 'b', type: 'agent', prompt: 'q', output: 'out' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    });

    expect(issues.a?.join(' ')).toMatch(/not available|upstream/i);
  });

  it('says nothing about a healthy flow', () => {
    expect(issuesByNode(flow)).toEqual({});
  });

  it('keeps cycle and other flow-level errors out of the per-node map', () => {
    const cyclic: Flow = {
      ...flow,
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p' },
        { id: 'b', type: 'agent', prompt: 'q' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };

    expect(issuesByNode(cyclic)).toEqual({});
  });
});
