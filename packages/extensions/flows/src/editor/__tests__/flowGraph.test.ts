// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Flow } from '../../schema/types';
import { validateFlow } from '../../schema/validate';
import { flowToGraph, graphToFlow, placeNewNode } from '../flowGraph';

const pipeline: Flow = {
  version: 1,
  name: 'review-pipeline',
  nodes: [
    { id: 'plan', type: 'agent', label: 'Draft plan', prompt: 'plan it', output: 'plan_md' },
    { id: 'impl', type: 'agent', prompt: 'build it' },
    { id: 'gate', type: 'human-gate', message: 'Ship it?' },
  ],
  edges: [
    { from: 'plan', to: 'impl', port: 'plan_md' },
    { from: 'impl', to: 'gate' },
  ],
  variables: {},
};

describe('flowToGraph', () => {
  it('maps every flow node to a canvas node carrying its type and data', () => {
    const graph = flowToGraph(pipeline);

    expect(graph.nodes.map((n) => [n.id, n.type])).toEqual([
      ['plan', 'agent'],
      ['impl', 'agent'],
      ['gate', 'human-gate'],
    ]);
    expect(graph.nodes[0].data.node).toEqual(pipeline.nodes[0]);
  });

  it('maps every flow edge, keeping the port as the edge label', () => {
    const graph = flowToGraph(pipeline);

    expect(graph.edges).toEqual([
      { id: 'plan->impl', source: 'plan', target: 'impl', label: 'plan_md' },
      { id: 'impl->gate', source: 'impl', target: 'gate' },
    ]);
  });

  it('keeps positions that the file already specifies', () => {
    const flow: Flow = {
      ...pipeline,
      nodes: [{ id: 'a', type: 'agent', prompt: 'p', position: { x: 42, y: -7 } }],
      edges: [],
    };

    expect(flowToGraph(flow).nodes[0].position).toEqual({ x: 42, y: -7 });
  });

  it('lays unpositioned nodes out by depth, so a chain reads left to right', () => {
    const graph = flowToGraph(pipeline);
    const x = graph.nodes.map((n) => n.position.x);

    expect(x[0]).toBeLessThan(x[1]);
    expect(x[1]).toBeLessThan(x[2]);
  });

  it('places independent roots on separate rows at the same depth', () => {
    const flow: Flow = {
      version: 1,
      name: 'two-roots',
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p' },
        { id: 'b', type: 'agent', prompt: 'q' },
      ],
      edges: [],
      variables: {},
    };
    const [a, b] = flowToGraph(flow).nodes;

    expect(a.position.x).toBe(b.position.x);
    expect(a.position.y).not.toBe(b.position.y);
  });

  it('is deterministic — the same flow lays out identically every time', () => {
    expect(flowToGraph(pipeline)).toEqual(flowToGraph(pipeline));
  });
});

describe('graphToFlow', () => {
  it('round-trips a flow, filling in the positions the layout assigned', () => {
    const graph = flowToGraph(pipeline);
    const back = graphToFlow(pipeline, graph);

    expect(back.name).toBe(pipeline.name);
    expect(back.edges).toEqual(pipeline.edges);
    expect(back.nodes.map(({ position: _p, ...rest }) => rest)).toEqual(pipeline.nodes);
    expect(back.nodes.every((n) => n.position !== undefined)).toBe(true);
  });

  it('round-trips a flow that already has positions without changing them', () => {
    const positioned: Flow = {
      ...pipeline,
      nodes: pipeline.nodes.map((node, i) => ({ ...node, position: { x: i * 10, y: i * 5 } })),
    };

    expect(graphToFlow(positioned, flowToGraph(positioned))).toEqual(positioned);
  });

  it('preserves type-specific fields through the canvas', () => {
    const flow: Flow = {
      version: 1,
      name: 'rich',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          label: 'A',
          prompt: 'p',
          model: null,
          tools: ['Read', 'Bash'],
          worktree: true,
          output: 'out',
        },
        { id: 'b', type: 'shell', run: 'npm test', cwd: 'packages/x' },
      ],
      edges: [{ from: 'a', to: 'b', port: 'out' }],
      variables: { input: 'src/' },
    };

    const back = graphToFlow(flow, flowToGraph(flow));

    expect(back.nodes[0]).toMatchObject({ model: null, tools: ['Read', 'Bash'], worktree: true });
    expect(back.nodes[1]).toMatchObject({ run: 'npm test', cwd: 'packages/x' });
    expect(back.variables).toEqual({ input: 'src/' });
  });

  it('captures nodes the user dragged to a new position', () => {
    const graph = flowToGraph(pipeline);
    const moved = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'impl' ? { ...n, position: { x: 999, y: 111 } } : n)),
    };

    const back = graphToFlow(pipeline, moved);

    expect(back.nodes.find((n) => n.id === 'impl')?.position).toEqual({ x: 999, y: 111 });
  });

  it('captures an edge the user drew on the canvas', () => {
    const graph = flowToGraph(pipeline);
    const connected = {
      ...graph,
      edges: [...graph.edges, { id: 'plan->gate', source: 'plan', target: 'gate' }],
    };

    const back = graphToFlow(pipeline, connected);

    expect(back.edges).toContainEqual({ from: 'plan', to: 'gate' });
  });

  it('drops an edge the user deleted on the canvas', () => {
    const graph = flowToGraph(pipeline);
    const trimmed = { ...graph, edges: graph.edges.filter((e) => e.id !== 'impl->gate') };

    expect(graphToFlow(pipeline, trimmed).edges).toEqual([
      { from: 'plan', to: 'impl', port: 'plan_md' },
    ]);
  });

  it('collapses duplicate connections between the same two nodes', () => {
    const graph = flowToGraph(pipeline);
    graph.edges.push({ id: 'xy-edge__plan-impl', source: 'plan', target: 'impl' });

    expect(graphToFlow(pipeline, graph).edges).toEqual(pipeline.edges);
  });

  it('produces a flow that still validates', () => {
    const back = graphToFlow(pipeline, flowToGraph(pipeline));

    expect(validateFlow(back).valid).toBe(true);
  });
});

describe('placeNewNode', () => {
  const at = (x: number, y: number) => ({ id: `${x}-${y}`, position: { x, y } });

  it('drops the first node where the user is looking', () => {
    expect(placeNewNode([], { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it('does not stack a new node on top of an existing one', () => {
    const spot = placeNewNode([at(100, 50)], { x: 100, y: 50 });

    expect(spot).not.toEqual({ x: 100, y: 50 });
  });

  it('keeps looking until it finds free space', () => {
    const taken = [at(0, 0), at(300, 0), at(600, 0)];

    const spot = placeNewNode(taken, { x: 0, y: 0 });

    expect(taken.every((node) => node.position.x !== spot.x || node.position.y !== spot.y)).toBe(true);
  });

  it('is deterministic, so adding the same node twice lands in the same two places', () => {
    expect(placeNewNode([at(0, 0)], { x: 0, y: 0 })).toEqual(placeNewNode([at(0, 0)], { x: 0, y: 0 }));
  });

  it('carries document fields the canvas does not own through a round trip', () => {
    const base = {
      version: 1,
      name: 'f',
      nodes: [],
      edges: [],
      variables: {},
      schedule: { type: 'daily', time: '02:30', enabled: true },
    } as unknown as Flow;

    // Losing this on save meant a schedule set in the editor never reached disk.
    expect(graphToFlow(base, { nodes: [], edges: [] }).schedule).toEqual({
      type: 'daily',
      time: '02:30',
      enabled: true,
    });
  });
});

describe('conditional edges on the canvas', () => {
  const branching: Flow = {
    version: 1,
    name: 'routes',
    nodes: [
      { id: 'test', type: 'shell', run: 'npm test' },
      { id: 'fix', type: 'agent', prompt: 'fix {{test.error}}' },
    ],
    edges: [{ from: 'test', to: 'fix', on: 'failure' }],
    variables: {},
  } as Flow;

  it('marks a failure edge so the canvas can draw it differently', () => {
    const graph = flowToGraph(branching);

    expect(graph.edges[0].data).toMatchObject({ on: 'failure' });
    expect(graph.edges[0].className).toContain('flow-edge-failure');
    expect(graph.edges[0].label).toBe('on failure');
  });

  it('round-trips the condition back into the file', () => {
    const graph = flowToGraph(branching);

    expect(graphToFlow(branching, graph).edges).toEqual([
      { from: 'test', to: 'fix', on: 'failure' },
    ]);
  });

  it('leaves plain edges exactly as they were', () => {
    const plain: Flow = { ...branching, edges: [{ from: 'test', to: 'fix' }] } as Flow;

    expect(graphToFlow(plain, flowToGraph(plain)).edges).toEqual([{ from: 'test', to: 'fix' }]);
  });
});

describe('when conditions on the canvas', () => {
  const routed: Flow = {
    version: 1,
    name: 'routed',
    nodes: [
      { id: 'report', type: 'agent', prompt: 'p', output: 'verdict' },
      { id: 'publish', type: 'agent', prompt: 'q' },
    ],
    edges: [{ from: 'report', to: 'publish', when: '{{report.verdict}} contains "APPROVE"' }],
    variables: {},
  } as Flow;

  it('shows the condition as the edge label, without the reference noise', () => {
    const graph = flowToGraph(routed);

    expect(graph.edges[0].label).toBe('verdict contains "APPROVE"');
    expect(graph.edges[0].className).toContain('flow-edge-when');
    expect(graph.edges[0].data).toMatchObject({
      when: '{{report.verdict}} contains "APPROVE"',
    });
  });

  it('round-trips the condition back into the file', () => {
    const graph = flowToGraph(routed);

    expect(graphToFlow(routed, graph).edges).toEqual([
      { from: 'report', to: 'publish', when: '{{report.verdict}} contains "APPROVE"' },
    ]);
  });

  it('a failure edge with a condition keeps both', () => {
    const both: Flow = {
      ...routed,
      edges: [
        {
          from: 'report',
          to: 'publish',
          on: 'failure',
          when: '{{report.error}} contains "TIMEOUT"',
        },
      ],
    } as Flow;

    const roundTripped = graphToFlow(both, flowToGraph(both)).edges[0];
    expect(roundTripped).toEqual({
      from: 'report',
      to: 'publish',
      on: 'failure',
      when: '{{report.error}} contains "TIMEOUT"',
    });
  });
});
