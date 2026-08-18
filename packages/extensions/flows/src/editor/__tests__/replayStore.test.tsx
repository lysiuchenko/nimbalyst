import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRunStore } from '../nodeRunStore';
import { NodeRunStoreContext, useNodeResult } from '../runContext';
import { replayState } from '../replay';
import type { RunTimeline } from '../../runner/runTimeline';

const timeline: RunTimeline = {
  runId: 'r', flowPath: '/w/f.flow.json',
  frames: [
    { at: 0, nodeId: 'a', status: 'running', output: 'a0' },
    { at: 0, nodeId: 'b', status: 'running', output: 'b0' },
    { at: 100, nodeId: 'a', status: 'done', output: 'a1' }, // only A changes at t=100
  ],
};

const renders: Record<string, number> = {};
const outputs: Record<string, string | undefined> = {};
function Probe({ id }: { id: string }) {
  const result = useNodeResult(id);
  renders[id] = (renders[id] ?? 0) + 1;
  outputs[id] = result?.output;
  return null;
}

describe('replay drives the per-id store', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    for (const k of Object.keys(renders)) delete renders[k];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('re-renders only the node whose replayed slice changed', async () => {
    const store = createNodeRunStore();
    store.setResults(replayState(timeline, 0).results);
    await act(async () => root.render(
      <NodeRunStoreContext.Provider value={store}>
        <Probe id="a" /><Probe id="b" />
      </NodeRunStoreContext.Provider>,
    ));
    const before = { a: renders.a, b: renders.b };
    await act(async () => { store.setResults(replayState(timeline, 100).results); });
    expect(outputs.a).toBe('a1');      // A got the replayed content
    expect(renders.a).toBe(before.a + 1);
    expect(renders.b).toBe(before.b);  // B untouched — budget preserved
  });
});
