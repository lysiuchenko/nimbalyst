// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildSchemaGuide, draftFlow, editFlow, extractJson } from '../aiDraft';
import type { Flow } from '../../schema/types';

const validFlow = {
  version: 1,
  name: 'drafted',
  nodes: [
    { id: 'collect', type: 'shell', run: 'git log --oneline -20', output: 'log' },
    { id: 'draft', type: 'agent', prompt: 'Summarise {{collect.log}}' },
  ],
  edges: [{ from: 'collect', to: 'draft', port: 'log' }],
  variables: {},
};

const invalidFlow = { ...validFlow, nodes: [{ id: 'a', type: 'shell' }] };

function model(responses: string[]) {
  let call = 0;
  const prompts: string[] = [];
  return {
    prompts,
    sendPrompt: vi.fn(async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      return { sessionId: 's', response: responses[Math.min(call++, responses.length - 1)] };
    }),
  };
}

describe('extractJson', () => {
  it('takes bare JSON', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('takes fenced JSON, with or without a language tag', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nEnjoy')).toBe('{"a":1}');
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('finds the outermost object in surrounding prose', () => {
    expect(extractJson('Sure! {"a":{"b":2}} — done.')).toBe('{"a":{"b":2}}');
  });
});

describe('draftFlow', () => {
  it('lands a valid first draft', async () => {
    const ai = model([JSON.stringify(validFlow)]);

    const result = await draftFlow(ai, 'summarise recent commits');

    expect('flow' in result && result.flow.name).toBe('drafted');
    expect(ai.sendPrompt).toHaveBeenCalledTimes(1);
    // The prompt teaches the schema and carries the ask.
    expect(ai.prompts[0]).toContain('summarise recent commits');
    expect(ai.prompts[0]).toContain('write-file');
    expect(ai.prompts[0]).toContain('${env:');
  });

  it('feeds validator errors back for one repair', async () => {
    const ai = model([JSON.stringify(invalidFlow), JSON.stringify(validFlow)]);

    const result = await draftFlow(ai, 'x');

    expect('flow' in result).toBe(true);
    expect(ai.sendPrompt).toHaveBeenCalledTimes(2);
    expect(ai.prompts[1]).toContain('nodes[0].run');
  });

  it('after a failed repair, returns the errors and touches nothing', async () => {
    const ai = model([JSON.stringify(invalidFlow)]);

    const result = await draftFlow(ai, 'x');

    expect('errors' in result && result.errors[0].path).toBe('nodes[0].run');
    expect(ai.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('treats a non-JSON reply as a validation failure, not a crash', async () => {
    const ai = model(['I cannot help with that.']);

    const result = await draftFlow(ai, 'x');

    expect('errors' in result).toBe(true);
  });
});

describe('editFlow', () => {
  it('sends the current flow and the instruction, returns the revision', async () => {
    const revised = { ...validFlow, name: 'revised' };
    const ai = model([JSON.stringify(revised)]);

    const result = await editFlow(ai, validFlow as unknown as Flow, 'rename it to revised');

    expect('flow' in result && result.flow.name).toBe('revised');
    expect(ai.prompts[0]).toContain('"name": "drafted"');
    expect(ai.prompts[0]).toContain('rename it to revised');
  });
});

describe('buildSchemaGuide', () => {
  it('names every palette type and each type\'s required fields', () => {
    const guide = buildSchemaGuide();
    const NODE_TYPES = [
      'agent',
      'fan-out',
      'slash-command',
      'skill',
      'shell',
      'human-gate',
      'write-file',
    ];
    for (const type of NODE_TYPES) {
      expect(guide).toContain(type);
    }
    // Check required fields for each type
    expect(guide).toContain('prompt'); // agent, fan-out
    expect(guide).toContain('over'); // fan-out
    expect(guide).toContain('command'); // slash-command
    expect(guide).toContain('skill'); // skill
    expect(guide).toContain('run'); // shell
    expect(guide).toContain('message'); // human-gate
    expect(guide).toContain('path'); // write-file
    expect(guide).toContain('content'); // write-file
  });

  it('states the no-secrets and declared-id rules', () => {
    const guide = buildSchemaGuide();
    expect(guide).toContain('${env:');
    expect(guide.toLowerCase()).toContain('edge');
  });

  it('includes the shell run allowlist restriction', () => {
    const guide = buildSchemaGuide();
    expect(guide).toContain('npm');
    expect(guide).toContain('npx');
    expect(guide).toContain('no pipes');
  });

  it('populates few-shot examples from the library', () => {
    const guide = buildSchemaGuide();
    // pr-review's first node is 'scope'; if the few-shot example was populated,
    // the serialized flow will contain this id.
    expect(guide).toContain('"scope"');
  });
});
