// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Flow } from '../types';
import { validateFlow } from '../validate';

/**
 * Credential-shaped strings are assembled at runtime rather than written as
 * literals, so this file never contains anything a secret scanner would flag.
 */
const ANTHROPIC = `sk-ant-api03-${'A'.repeat(44)}`;
const OPENAI = `sk-proj-${'B'.repeat(40)}`;
const GITHUB = `ghp_${'C'.repeat(36)}`;
const AWS_KEY_ID = `AKIA${'D'.repeat(16)}`;

function flowWith(overrides: Partial<Flow>): Flow {
  return {
    version: 1,
    name: 'credentials',
    nodes: [{ id: 'a', type: 'agent', prompt: 'do it' }],
    edges: [],
    variables: {},
    ...overrides,
  } as Flow;
}

describe('validateFlow — credentials never belong in a flow file', () => {
  it.each([
    ['an Anthropic key', ANTHROPIC],
    ['an OpenAI key', OPENAI],
    ['a GitHub token', GITHUB],
    ['an AWS access key id', AWS_KEY_ID],
  ])('rejects %s in a variable', (_label, credential) => {
    const result = validateFlow(flowWith({ variables: { token: credential } }));

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors[0]).toMatchObject({ path: 'variables.token' });
    expect(!result.valid && result.errors[0].message).toMatch(/looks like a credential/);
  });

  it('rejects a credential pasted into a node prompt', () => {
    const result = validateFlow(
      flowWith({
        nodes: [{ id: 'a', type: 'agent', prompt: `call the API with ${ANTHROPIC}` }],
      })
    );

    expect(!result.valid && result.errors[0].path).toBe('nodes[0].prompt');
  });

  it('rejects a credential in a shell command', () => {
    const result = validateFlow(
      flowWith({ nodes: [{ id: 's', type: 'shell', run: `deploy --token ${GITHUB}` }] })
    );

    expect(!result.valid && result.errors[0].path).toBe('nodes[0].run');
  });

  it('never echoes the value back in the error message', () => {
    const result = validateFlow(flowWith({ variables: { token: ANTHROPIC } }));

    expect(!result.valid && result.errors[0].message).not.toContain(ANTHROPIC);
  });

  it('accepts an env-var reference, which is how a flow names a credential', () => {
    const result = validateFlow(
      flowWith({
        variables: { token: '${env:ANTHROPIC_API_KEY}' },
        nodes: [{ id: 'a', type: 'agent', prompt: 'use ${env:GITHUB_TOKEN}' }],
      })
    );

    expect(result.valid).toBe(true);
  });

  it('accepts ordinary prose that merely mentions a key', () => {
    const result = validateFlow(
      flowWith({ nodes: [{ id: 'a', type: 'agent', prompt: 'Rotate the API key and update the docs' }] })
    );

    expect(result.valid).toBe(true);
  });
});
