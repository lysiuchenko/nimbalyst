// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { nodeDefinitionHash, planResume } from '../resume';
import type { Flow, FlowNode } from '../../schema/types';
import type { RunRecord } from '../runStore';

const flow = (nodes: FlowNode[], edges: Flow['edges']): Flow =>
  ({ version: 1, name: 'f', nodes, edges, variables: {} }) as Flow;

/** a -> b -> c, plus d hanging off a on its own branch. */
const diamond = () =>
  flow(
    [
      { id: 'a', type: 'shell', run: 'echo one', output: 'text' } as FlowNode,
      { id: 'b', type: 'agent', prompt: 'use {{a.text}}', output: 'notes' } as FlowNode,
      { id: 'c', type: 'write-file', path: 'out.md', content: '{{b.notes}}' } as FlowNode,
      { id: 'd', type: 'agent', prompt: 'independent of b and c' } as FlowNode,
    ],
    [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'd' },
    ]
  );

function recordFor(
  source: Flow,
  statuses: Record<string, 'done' | 'failed' | 'skipped'>,
  over: Partial<RunRecord> = {}
): RunRecord {
  return {
    runId: 'run-old',
    flowName: source.name,
    flowPath: 'f.flow.json',
    status: Object.values(statuses).includes('failed') ? 'failed' : 'done',
    startedAt: 1_000,
    finishedAt: 2_000,
    nodes: Object.fromEntries(
      source.nodes.map((node) => [
        node.id,
        {
          nodeId: node.id,
          type: node.type,
          status: statuses[node.id] ?? 'done',
          output: `${node.id}-output`,
          startedAt: 1_000,
          finishedAt: 1_500,
          definitionHash: nodeDefinitionHash(node),
        },
      ])
    ),
    outputs: { a: { text: 'one' }, b: { notes: 'draft' } },
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  } as RunRecord;
}

describe('nodeDefinitionHash', () => {
  test('ignores position and label, because moving a card is not an edit', () => {
    const node = { id: 'a', type: 'shell', run: 'echo x' } as FlowNode;
    const moved = { ...node, position: { x: 9, y: 9 }, label: 'Renamed' } as FlowNode;

    expect(nodeDefinitionHash(moved)).toBe(nodeDefinitionHash(node));
  });

  test('changes when any functional field changes', () => {
    const node = { id: 'a', type: 'shell', run: 'echo x' } as FlowNode;

    expect(nodeDefinitionHash({ ...node, run: 'echo y' } as FlowNode)).not.toBe(
      nodeDefinitionHash(node)
    );
  });

  test('is stable across key order', () => {
    const one = { id: 'a', type: 'shell', run: 'echo x', output: 'o' } as FlowNode;
    const two = { output: 'o', run: 'echo x', type: 'shell', id: 'a' } as unknown as FlowNode;

    expect(nodeDefinitionHash(one)).toBe(nodeDefinitionHash(two));
  });
});

describe('planResume', () => {
  test('reuses every finished node and re-runs the failed one and its descendants', () => {
    const source = diamond();
    const plan = planResume(source, recordFor(source, { b: 'failed', c: 'skipped' }));

    expect([...plan.reused.keys()].sort()).toEqual(['a', 'd']);
    expect(plan.reused.get('a')).toMatchObject({ status: 'done', output: 'a-output', reused: true });
  });

  test('seeds the interpolation outputs of reused nodes only', () => {
    const source = diamond();
    const plan = planResume(source, recordFor(source, { b: 'failed', c: 'skipped' }));

    expect(plan.outputs).toEqual({ a: { text: 'one' } });
  });

  test('an edited node re-runs even though it succeeded', () => {
    const source = diamond();
    const record = recordFor(source, { c: 'failed' });
    (source.nodes[0] as FlowNode & { run: string }).run = 'echo CHANGED';

    const plan = planResume(source, record);

    // a changed, so its descendants b and c cannot trust their inputs either.
    expect([...plan.reused.keys()]).toEqual([]);
  });

  test('an edit cascades to descendants but not to siblings', () => {
    const source = diamond();
    const record = recordFor(source, { c: 'failed' });
    (source.nodes[1] as FlowNode & { prompt: string }).prompt = 'CHANGED {{a.text}}';

    const plan = planResume(source, record);

    // b changed -> b and c re-run; a and d stand.
    expect([...plan.reused.keys()].sort()).toEqual(['a', 'd']);
  });

  test('moving and relabelling nodes invalidates nothing', () => {
    const source = diamond();
    const record = recordFor(source, { b: 'failed' });
    for (const node of source.nodes) {
      node.position = { x: 99, y: 99 };
      node.label = 'moved';
    }

    expect([...planResume(source, record).reused.keys()].sort()).toEqual(['a', 'd']);
  });

  test('a node added since the run simply runs', () => {
    const source = diamond();
    const record = recordFor(source, { b: 'failed' });
    source.nodes.push({ id: 'e', type: 'agent', prompt: 'new step' } as FlowNode);
    source.edges.push({ from: 'd', to: 'e' });

    const plan = planResume(source, record);

    expect(plan.reused.has('e')).toBe(false);
    expect(plan.reused.has('d')).toBe(true);
  });

  test('a record from before definition hashes reuses nothing', () => {
    const source = diamond();
    const record = recordFor(source, { b: 'failed' });
    for (const execution of Object.values(record.nodes)) {
      delete (execution as { definitionHash?: string }).definitionHash;
    }

    expect(planResume(source, record).reused.size).toBe(0);
  });

  test('reused executions drop their timings and carry the reused mark', () => {
    const source = diamond();
    const plan = planResume(source, recordFor(source, { b: 'failed' }));
    const reused = plan.reused.get('a')!;

    // The work cost this run nothing; old timings would double-count agent
    // time on the dashboard.
    expect(reused.startedAt).toBeUndefined();
    expect(reused.finishedAt).toBeUndefined();
    expect(reused.reused).toBe(true);
  });

  test('nothing to resume when every node finished', () => {
    const source = diamond();

    expect(planResume(source, recordFor(source, {})).reused.size).toBe(4);
  });
});
