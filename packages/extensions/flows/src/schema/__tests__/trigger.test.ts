// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { serializeFlow, validateFlow } from '../validate';

const base = {
  version: 1,
  name: 'triggered',
  nodes: [{ id: 'a', type: 'agent', prompt: 'go' }],
  edges: [],
  variables: {},
};

const withTrigger = (trigger: unknown, nodes: unknown[] = base.nodes) => ({
  ...base,
  nodes,
  trigger,
});

const errorPaths = (input: unknown): string[] => {
  const result = validateFlow(input);
  return result.valid ? [] : result.errors.map((error) => error.path);
};

describe('trigger validation', () => {
  it('accepts a file-change trigger and keeps it through a round trip', () => {
    const trigger = { type: 'file-change', glob: 'notes/*.md', debounceSeconds: 5, enabled: true };
    const result = validateFlow(withTrigger(trigger));

    expect(result.valid && result.flow.trigger).toEqual(trigger);
    if (!result.valid) throw new Error('expected a valid flow');
    expect(JSON.parse(serializeFlow(result.flow)).trigger).toEqual(trigger);
  });

  it('requires the known type, a non-empty glob, and an enabled flag', () => {
    expect(errorPaths(withTrigger({ type: 'webhook', glob: 'x', enabled: true }))).toContain(
      'trigger.type'
    );
    expect(errorPaths(withTrigger({ type: 'file-change', glob: '', enabled: true }))).toContain(
      'trigger.glob'
    );
    expect(errorPaths(withTrigger({ type: 'file-change', glob: 'x' }))).toContain(
      'trigger.enabled'
    );
  });

  it('bounds the debounce to whole seconds between 1 and 600', () => {
    for (const debounceSeconds of [0, 601, 1.5]) {
      expect(
        errorPaths(
          withTrigger({ type: 'file-change', glob: 'x', debounceSeconds, enabled: true })
        )
      ).toContain('trigger.debounceSeconds');
    }
  });

  it('refuses onGate "skip" where a shell command hides behind the gate', () => {
    const nodes = [
      { id: 'gate', type: 'human-gate', message: 'ok?' },
      { id: 'sh', type: 'shell', run: 'echo hi' },
    ];
    expect(
      errorPaths(
        withTrigger({ type: 'file-change', glob: 'x', onGate: 'skip', enabled: true }, nodes)
      )
    ).toContain('trigger.onGate');
    // pause stays allowed — it declines the unattended run instead.
    expect(
      errorPaths(
        withTrigger({ type: 'file-change', glob: 'x', onGate: 'pause', enabled: true }, nodes)
      )
    ).toEqual([]);
  });
});
