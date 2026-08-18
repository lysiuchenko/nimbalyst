import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { SubAgentLayer } from '../SubAgentLayer';
import type { ChildProgress } from '../../runner/types';

// jsdom has no ResizeObserver; @xyflow/react needs one to mount at all.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const withWorktree: ChildProgress = {
  label: 'review[2]', status: 'done',
  worktree: { id: 'w2', branch: 'worktree/review-2', path: '/wt/review-2' },
};
const noWorktree: ChildProgress = { label: 'plain', status: 'done' };

function mount(subAgents: Record<string, ChildProgress[]>, onInspectDiff = vi.fn(), winners = {}) {
  act(() => {
    root.render(
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodes={[{ id: 'fan', position: { x: 0, y: 0 }, data: {} }]} edges={[]}>
            <SubAgentLayer subAgents={subAgents} onInspectDiff={onInspectDiff} winners={winners} />
          </ReactFlow>
        </div>
      </ReactFlowProvider>,
    );
  });
  return onInspectDiff;
}

describe('SubAgentLayer diff affordance', () => {
  it('shows a diff button for a completed child with a worktree and calls onInspectDiff', () => {
    const onInspect = mount({ fan: [withWorktree] });
    const btn = container.querySelector<HTMLButtonElement>('[data-subagent-diff="review[2]"]');
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(onInspect).toHaveBeenCalledWith('fan', expect.objectContaining({ label: 'review[2]' }));
  });

  it('shows no diff button for a child without a worktree', () => {
    mount({ fan: [noWorktree] });
    expect(container.querySelector('[data-subagent-diff="plain"]')).toBeNull();
  });

  it('marks the winning child', () => {
    mount({ fan: [withWorktree] }, vi.fn(), { fan: 'review[2]' });
    expect(container.querySelector('[data-subagent-of="fan"][data-winner="yes"]')).not.toBeNull();
  });
});
