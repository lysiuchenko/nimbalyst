// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../../schema/validate';
import { referencesByNode } from '../references';
import { applyTemplate, FLOW_TEMPLATES } from '../templates';

describe('FLOW_TEMPLATES', () => {
  it('offers a starting point rather than a blank canvas', () => {
    expect(FLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(FLOW_TEMPLATES.map((t) => [t.id, t] as const))('%s is a valid flow', (_id, template) => {
    const result = validateFlow(template.build('my-flow'));

    expect(result.valid).toBe(true);
  });

  it.each(FLOW_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s only references inputs that are actually upstream',
    (_id, template) => {
      const flow = template.build('my-flow');
      const available = referencesByNode(flow);

      for (const node of flow.nodes) {
        const text = JSON.stringify(node);
        for (const [, reference] of text.matchAll(/\{\{\s*([^{}\s"]+)\s*\}\}/g)) {
          expect(available[node.id]).toContain(reference);
        }
      }
    }
  );

  it('gives every template a distinct id and a human title', () => {
    expect(new Set(FLOW_TEMPLATES.map((t) => t.id)).size).toBe(FLOW_TEMPLATES.length);
    expect(FLOW_TEMPLATES.every((t) => t.title.length > 0 && t.description.length > 0)).toBe(true);
  });

  it('names each template flow after the file it is being created in', () => {
    expect(FLOW_TEMPLATES[0].build('release-check').name).toBe('release-check');
  });

  it('lays every node out, so a template never opens as a pile at the origin', () => {
    for (const template of FLOW_TEMPLATES) {
      expect(template.build('x').nodes.every((node) => node.position !== undefined)).toBe(true);
    }
  });

  it('puts a human gate before anything that executes, in every template that runs commands', () => {
    for (const template of FLOW_TEMPLATES) {
      const flow = template.build('x');
      const shellIds = flow.nodes.filter((n) => n.type === 'shell').map((n) => n.id);
      if (shellIds.length === 0) continue;

      const gateIds = new Set(flow.nodes.filter((n) => n.type === 'human-gate').map((n) => n.id));
      // Every shell node must have a gate somewhere upstream of it.
      for (const id of shellIds) {
        const upstream = ancestors(flow.edges, id);
        expect([...upstream].some((node) => gateIds.has(node))).toBe(true);
      }
    }
  });
});

function ancestors(edges: { from: string; to: string }[], nodeId: string): Set<string> {
  const seen = new Set<string>();
  const queue = edges.filter((e) => e.to === nodeId).map((e) => e.from);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...edges.filter((e) => e.to === id).map((e) => e.from));
  }
  return seen;
}

describe('applyTemplate', () => {
  it('replaces an empty canvas with the template', () => {
    const graph = applyTemplate(FLOW_TEMPLATES[0], 'my-flow');

    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('produces canvas nodes carrying the flow node, ready to edit', () => {
    const graph = applyTemplate(FLOW_TEMPLATES[0], 'my-flow');

    expect(graph.nodes[0].data.node.id).toBe(graph.nodes[0].id);
    expect(graph.nodes[0].type).toBe(graph.nodes[0].data.node.type);
  });
});
