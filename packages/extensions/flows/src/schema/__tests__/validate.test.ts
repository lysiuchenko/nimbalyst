// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Flow } from '../types';
import { parseFlowFile, serializeFlow, validateFlow } from '../validate';

/** Smallest flow that must validate. */
function minimalFlow(): Flow {
  return {
    version: 1,
    name: 'minimal',
    nodes: [{ id: 'a', type: 'agent', prompt: 'do the thing' }],
    edges: [],
    variables: {},
  };
}

/** Every error path reported for `input`, sorted for stable assertions. */
function errorPaths(input: unknown): string[] {
  const result = validateFlow(input);
  return result.valid ? [] : result.errors.map((e) => e.path).sort();
}

function messagesFor(input: unknown, path: string): string[] {
  const result = validateFlow(input);
  return result.valid ? [] : result.errors.filter((e) => e.path === path).map((e) => e.message);
}

describe('validateFlow — accepts', () => {
  it('accepts a minimal single-node flow', () => {
    const result = validateFlow(minimalFlow());
    expect(result).toEqual({ valid: true, flow: minimalFlow() });
  });

  it('accepts the build-plan example flow', () => {
    const flow = {
      version: 1,
      name: 'review-pipeline',
      nodes: [
        {
          id: 'plan',
          type: 'agent',
          label: 'Draft plan',
          prompt: 'Create an implementation plan for {{input}}',
          model: null,
          tools: ['Read', 'Write', 'Bash'],
          worktree: true,
          output: 'plan_md',
        },
        { id: 'implement', type: 'agent', prompt: 'Implement {{plan.plan_md}}' },
      ],
      edges: [{ from: 'plan', to: 'implement', port: 'plan_md' }],
      variables: {},
    };

    expect(validateFlow(flow).valid).toBe(true);
  });

  it('accepts one node of every node type', () => {
    const flow = {
      version: 1,
      name: 'all-types',
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p' },
        { id: 'c', type: 'slash-command', command: '/review' },
        { id: 's', type: 'skill', skill: 'brainstorming' },
        { id: 'sh', type: 'shell', run: 'npm test' },
        { id: 'g', type: 'human-gate', message: 'Approve?' },
      ],
      edges: [
        { from: 'a', to: 'c' },
        { from: 'c', to: 's' },
        { from: 's', to: 'sh' },
        { from: 'sh', to: 'g' },
      ],
      variables: { input: 'src/' },
    };

    expect(validateFlow(flow).valid).toBe(true);
  });

  it('accepts a diamond — parallel branches that rejoin are not a cycle', () => {
    const flow = {
      version: 1,
      name: 'diamond',
      nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'agent' as const, prompt: 'p' })),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ],
      variables: {},
    };

    expect(validateFlow(flow).valid).toBe(true);
  });

  it('treats a missing variables map as empty', () => {
    const { variables: _omitted, ...withoutVariables } = minimalFlow();
    const result = validateFlow(withoutVariables);

    expect(result.valid && result.flow.variables).toEqual({});
  });

  it('keeps node positions so the canvas can round-trip', () => {
    const flow = {
      ...minimalFlow(),
      nodes: [{ id: 'a', type: 'agent' as const, prompt: 'p', position: { x: 12.5, y: -30 } }],
    };
    const result = validateFlow(flow);

    expect(result.valid && result.flow.nodes[0].position).toEqual({ x: 12.5, y: -30 });
  });
});

describe('validateFlow — document shape', () => {
  it.each([
    ['null', null],
    ['a string', 'not a flow'],
    ['an array', []],
  ])('rejects %s as the document root', (_label, input) => {
    expect(errorPaths(input)).toEqual(['']);
  });

  it('rejects an unsupported schema version', () => {
    expect(messagesFor({ ...minimalFlow(), version: 2 }, 'version')).toEqual([
      'version must be 1, got 2',
    ]);
  });

  it('rejects an empty name', () => {
    expect(errorPaths({ ...minimalFlow(), name: '  ' })).toEqual(['name']);
  });

  it('rejects nodes that are not an array', () => {
    expect(errorPaths({ ...minimalFlow(), nodes: {} })).toEqual(['nodes']);
  });

  it('rejects edges that are not an array', () => {
    expect(errorPaths({ ...minimalFlow(), edges: 'none' })).toEqual(['edges']);
  });
});

describe('validateFlow — nodes', () => {
  it('rejects duplicate node ids', () => {
    const flow = {
      ...minimalFlow(),
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p' },
        { id: 'a', type: 'agent', prompt: 'q' },
      ],
    };

    expect(messagesFor(flow, 'nodes[1].id')).toEqual(['duplicate node id "a"']);
  });

  it('rejects an empty node id', () => {
    const flow = { ...minimalFlow(), nodes: [{ id: '', type: 'agent', prompt: 'p' }] };

    expect(errorPaths(flow)).toEqual(['nodes[0].id']);
  });

  it('rejects an unknown node type and lists the valid ones', () => {
    const flow = { ...minimalFlow(), nodes: [{ id: 'a', type: 'wizard', prompt: 'p' }] };

    expect(messagesFor(flow, 'nodes[0].type')).toEqual([
      'unknown node type "wizard", expected one of: agent, slash-command, skill, shell, human-gate',
    ]);
  });

  it.each([
    ['agent', { id: 'n', type: 'agent' }, 'nodes[0].prompt'],
    ['slash-command', { id: 'n', type: 'slash-command' }, 'nodes[0].command'],
    ['skill', { id: 'n', type: 'skill' }, 'nodes[0].skill'],
    ['shell', { id: 'n', type: 'shell' }, 'nodes[0].run'],
    ['human-gate', { id: 'n', type: 'human-gate' }, 'nodes[0].message'],
  ])('rejects a %s node missing its required field', (_type, node, path) => {
    expect(errorPaths({ ...minimalFlow(), nodes: [node] })).toEqual([path]);
  });

  it('rejects a slash command that does not start with a slash', () => {
    const flow = { ...minimalFlow(), nodes: [{ id: 'n', type: 'slash-command', command: 'review' }] };

    expect(messagesFor(flow, 'nodes[0].command')).toEqual([
      'slash command must start with "/", got "review"',
    ]);
  });

  it('rejects agent tools that are not a string array', () => {
    const flow = { ...minimalFlow(), nodes: [{ id: 'n', type: 'agent', prompt: 'p', tools: 'Read' }] };

    expect(errorPaths(flow)).toEqual(['nodes[0].tools']);
  });
});

describe('validateFlow — edges', () => {
  it('rejects an edge whose source does not exist', () => {
    const flow = { ...minimalFlow(), edges: [{ from: 'ghost', to: 'a' }] };

    expect(messagesFor(flow, 'edges[0].from')).toEqual(['edge references unknown node "ghost"']);
  });

  it('rejects an edge whose target does not exist', () => {
    const flow = { ...minimalFlow(), edges: [{ from: 'a', to: 'ghost' }] };

    expect(messagesFor(flow, 'edges[0].to')).toEqual(['edge references unknown node "ghost"']);
  });

  it('rejects a self-edge', () => {
    const flow = { ...minimalFlow(), edges: [{ from: 'a', to: 'a' }] };

    expect(messagesFor(flow, 'edges[0]')).toEqual(['node "a" cannot connect to itself']);
  });

  it('rejects a port that the source node does not output', () => {
    const flow = {
      version: 1,
      name: 'ports',
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p', output: 'plan_md' },
        { id: 'b', type: 'agent', prompt: 'q' },
      ],
      edges: [{ from: 'a', to: 'b', port: 'diff' }],
      variables: {},
    };

    expect(messagesFor(flow, 'edges[0].port')).toEqual([
      'node "a" does not declare an output named "diff"',
    ]);
  });
});

describe('validateFlow — cycles', () => {
  it('rejects a two-node cycle', () => {
    const flow = {
      version: 1,
      name: 'cycle',
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p' },
        { id: 'b', type: 'agent', prompt: 'q' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      variables: {},
    };

    expect(messagesFor(flow, 'edges')).toEqual(['flow contains a cycle: a -> b -> a']);
  });

  it('rejects a three-node cycle', () => {
    const flow = {
      version: 1,
      name: 'cycle3',
      nodes: ['a', 'b', 'c'].map((id) => ({ id, type: 'agent' as const, prompt: 'p' })),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
      variables: {},
    };

    expect(messagesFor(flow, 'edges')).toEqual(['flow contains a cycle: a -> b -> c -> a']);
  });
});

describe('validateFlow — error reporting', () => {
  it('reports every problem at once rather than stopping at the first', () => {
    const flow = {
      version: 3,
      name: '',
      nodes: [
        { id: 'a', type: 'agent' },
        { id: 'a', type: 'shell' },
      ],
      edges: [{ from: 'a', to: 'ghost' }],
    };

    expect(errorPaths(flow)).toEqual([
      'edges[0].to',
      'name',
      'nodes[0].prompt',
      'nodes[1].id',
      'nodes[1].run',
      'version',
    ]);
  });
});

describe('parseFlowFile', () => {
  it('parses a valid flow file', () => {
    const result = parseFlowFile(JSON.stringify(minimalFlow()));

    expect(result.valid && result.flow.name).toBe('minimal');
  });

  it('reports malformed JSON without throwing', () => {
    const result = parseFlowFile('{ "version": 1, ');

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors[0].path).toBe('');
    expect(!result.valid && result.errors[0].message).toMatch(/^not valid JSON: /);
  });
});

describe('serializeFlow', () => {
  it('round-trips a flow without losing data', () => {
    const flow: Flow = {
      version: 1,
      name: 'round-trip',
      nodes: [
        {
          id: 'plan',
          type: 'agent',
          label: 'Draft plan',
          prompt: 'p',
          model: null,
          tools: ['Read'],
          worktree: true,
          output: 'plan_md',
          position: { x: 1, y: 2 },
        },
        { id: 'gate', type: 'human-gate', message: 'Approve?', position: { x: 3, y: 4 } },
      ],
      edges: [{ from: 'plan', to: 'gate', port: 'plan_md' }],
      variables: { input: 'src/' },
    };

    const parsed = parseFlowFile(serializeFlow(flow));

    expect(parsed.valid && parsed.flow).toEqual(flow);
  });

  it('is canonical — key insertion order does not change the output', () => {
    const shuffled = {
      variables: {},
      edges: [{ to: 'b', from: 'a' }],
      nodes: [
        { prompt: 'p', type: 'agent', label: 'A', id: 'a' },
        { message: 'ok?', type: 'human-gate', id: 'b' },
      ],
      name: 'canonical',
      version: 1,
    } as unknown as Flow;

    expect(serializeFlow(shuffled)).toBe(
      [
        '{',
        '  "version": 1,',
        '  "name": "canonical",',
        '  "nodes": [',
        '    {',
        '      "id": "a",',
        '      "type": "agent",',
        '      "label": "A",',
        '      "prompt": "p"',
        '    },',
        '    {',
        '      "id": "b",',
        '      "type": "human-gate",',
        '      "message": "ok?"',
        '    }',
        '  ],',
        '  "edges": [',
        '    {',
        '      "from": "a",',
        '      "to": "b"',
        '    }',
        '  ],',
        '  "variables": {}',
        '}',
        '',
      ].join('\n')
    );
  });

  it('ends with a newline so the file is diff-friendly', () => {
    expect(serializeFlow(minimalFlow()).endsWith('\n')).toBe(true);
  });
});
