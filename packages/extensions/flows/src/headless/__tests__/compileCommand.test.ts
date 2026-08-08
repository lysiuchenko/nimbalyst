// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Flow } from '../../schema/types';
import { commandPathFor, compileToSlashCommand } from '../compileCommand';

const flow: Flow = {
  version: 1,
  name: 'review-pipeline',
  nodes: [
    { id: 'plan', type: 'agent', label: 'Draft plan', prompt: 'Plan {{target}}', output: 'plan_md' },
    { id: 'impl', type: 'agent', prompt: 'Build {{plan.plan_md}}' },
    { id: 'gate', type: 'human-gate', message: 'Ship it?' },
    { id: 'verify', type: 'shell', run: 'npm test' },
  ],
  edges: [
    { from: 'plan', to: 'impl', port: 'plan_md' },
    { from: 'impl', to: 'gate' },
    { from: 'gate', to: 'verify' },
  ],
  variables: { target: 'the API' },
};

describe('commandPathFor', () => {
  it('writes into .claude/commands, named after the flow', () => {
    expect(commandPathFor(flow.name)).toBe('.claude/commands/flow-review-pipeline.md');
  });

  it('slugs a name that would not be a usable filename', () => {
    expect(commandPathFor('Review & Ship!')).toBe('.claude/commands/flow-review-ship.md');
  });
});

describe('compileToSlashCommand', () => {
  it('starts with frontmatter naming the flow', () => {
    const text = compileToSlashCommand(flow, 'pipelines/review.flow.json');

    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('description: Run the review-pipeline flow');
  });

  it('lists the steps in dependency order so the agent runs them in order', () => {
    const text = compileToSlashCommand(flow, 'review.flow.json');
    const order = ['plan', 'impl', 'gate', 'verify'].map((id) => text.indexOf(`### ${id}`));

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index > 0)).toBe(true);
  });

  it('spells out what each node type should do', () => {
    const text = compileToSlashCommand(flow, 'review.flow.json');

    expect(text).toContain('Plan {{target}}');
    expect(text).toContain('npm test');
    expect(text).toContain('Ship it?');
  });

  it('tells the agent to stop at a human gate rather than deciding for itself', () => {
    const text = compileToSlashCommand(flow, 'review.flow.json');

    expect(text).toMatch(/stop and ask/i);
  });

  it('records which upstream output each step depends on', () => {
    const text = compileToSlashCommand(flow, 'review.flow.json');

    expect(text).toContain('{{plan.plan_md}}');
    expect(text).toContain('after: plan');
  });

  it('documents the flow variables and their defaults', () => {
    const text = compileToSlashCommand(flow, 'review.flow.json');

    expect(text).toContain('target');
    expect(text).toContain('the API');
  });

  it('points back at the flow file it came from, and says it is generated', () => {
    const text = compileToSlashCommand(flow, 'pipelines/review.flow.json');

    expect(text).toContain('pipelines/review.flow.json');
    expect(text).toMatch(/generated/i);
  });

  it('refuses to compile a flow the validator rejects', () => {
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

    expect(() => compileToSlashCommand(cyclic, 'x.flow.json')).toThrow('cycle');
  });
});
