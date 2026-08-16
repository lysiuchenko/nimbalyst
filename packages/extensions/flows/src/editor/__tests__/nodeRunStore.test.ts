// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ChildProgress, NodeExecution } from '../../runner/types';
import { createNodeRunStore } from '../nodeRunStore';

const exec = (nodeId: string, output: string): NodeExecution => ({
  nodeId,
  status: 'done',
  output,
});

describe('NodeRunStore', () => {
  it('notifies only the id whose status changed; others stay referentially stable', () => {
    const store = createNodeRunStore();
    store.setStatuses({ a: 'queued', b: 'queued', c: 'queued' });
    const aBefore = store.getStatus('a');
    const spyA = vi.fn();
    const spyB = vi.fn();
    store.subscribe('status', 'a', spyA);
    store.subscribe('status', 'b', spyB);

    store.setStatuses({ a: 'queued', b: 'running', c: 'queued' });

    expect(spyB).toHaveBeenCalledTimes(1);
    expect(spyA).not.toHaveBeenCalled();
    expect(store.getStatus('b')).toBe('running');
    expect(store.getStatus('a')).toBe(aBefore);
  });

  it('does not wake a card when results are deep-equal but freshly spread (the trap)', () => {
    const store = createNodeRunStore();
    store.setResults({ a: exec('a', 'hi'), b: exec('b', 'yo') });
    const aRef = store.getResult('a');
    const spyA = vi.fn();
    store.subscribe('result', 'a', spyA);

    // Same shape as useFlowRun: a brand-new { ...node } object every tick.
    store.setResults({ a: exec('a', 'hi'), b: exec('b', 'CHANGED') });

    expect(spyA).not.toHaveBeenCalled();
    expect(store.getResult('a')).toBe(aRef);
  });

  it('does not wake a card when a children array is unchanged in content', () => {
    const store = createNodeRunStore();
    const kid = (label: string): ChildProgress => ({ label, status: 'running' });
    store.setChildren({ a: [kid('one'), kid('two')] });
    const spyA = vi.fn();
    store.subscribe('children', 'a', spyA);

    store.setChildren({ a: [kid('one'), kid('two')] }); // fresh array, same content

    expect(spyA).not.toHaveBeenCalled();
  });

  it('drops an id to undefined and notifies its listener', () => {
    const store = createNodeRunStore();
    store.setStatuses({ a: 'running' });
    const spyA = vi.fn();
    store.subscribe('status', 'a', spyA);

    store.setStatuses({});

    expect(spyA).toHaveBeenCalledTimes(1);
    expect(store.getStatus('a')).toBeUndefined();
  });

  it('returns one shared frozen empty array for an absent children slice', () => {
    const store = createNodeRunStore();
    expect(store.getChildren('missing')).toEqual([]);
    expect(store.getChildren('missing')).toBe(store.getChildren('other'));
  });
});
