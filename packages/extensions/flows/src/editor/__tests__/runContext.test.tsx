import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRunStore } from '../nodeRunStore';
import { NodeRunStoreContext, useNodeStatus } from '../runContext';

const renders: Record<string, number> = {};

function Probe({ id }: { id: string }) {
  useNodeStatus(id);
  renders[id] = (renders[id] ?? 0) + 1;
  return null;
}

describe('per-node run hooks', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const key of Object.keys(renders)) delete renders[key];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('re-renders only the card whose slice changed', async () => {
    const store = createNodeRunStore();
    store.setStatuses({ a: 'queued', b: 'queued', c: 'queued' });

    await act(async () => {
      root.render(
        <NodeRunStoreContext.Provider value={store}>
          <Probe id="a" />
          <Probe id="b" />
          <Probe id="c" />
        </NodeRunStoreContext.Provider>
      );
    });

    const before = { ...renders };

    await act(async () => {
      store.setStatuses({ a: 'queued', b: 'running', c: 'queued' });
    });

    expect(renders.b).toBe(before.b + 1);
    expect(renders.a).toBe(before.a);
    expect(renders.c).toBe(before.c);
  });
});
