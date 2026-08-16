import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { ChildProgress, NodeExecution, NodeStatus } from '../runner/types';
import type { NodeRunStore, Reliability } from './nodeRunStore';

/**
 * The per-node run store. One subscription per card slice, so a node update
 * wakes only that node's card — never the whole canvas.
 *
 * Kept out of the xyflow store on purpose: run state must never look like a
 * document edit, mark the file dirty, or land in the saved `.flow.json`.
 */
export const NodeRunStoreContext = createContext<NodeRunStore | null>(null);

function useNodeRunStore(): NodeRunStore {
  const store = useContext(NodeRunStoreContext);
  if (!store) throw new Error('NodeRunStoreContext is missing a provider');
  return store;
}

export function useNodeStatus(nodeId: string): NodeStatus | undefined {
  const store = useNodeRunStore();
  const subscribe = useCallback(
    (cb: () => void) => store.subscribe('status', nodeId, cb),
    [store, nodeId]
  );
  return useSyncExternalStore(subscribe, () => store.getStatus(nodeId));
}

export function useNodeChildren(nodeId: string): readonly ChildProgress[] {
  const store = useNodeRunStore();
  const subscribe = useCallback(
    (cb: () => void) => store.subscribe('children', nodeId, cb),
    [store, nodeId]
  );
  return useSyncExternalStore(subscribe, () => store.getChildren(nodeId));
}

export function useNodeResult(nodeId: string): NodeExecution | undefined {
  const store = useNodeRunStore();
  const subscribe = useCallback(
    (cb: () => void) => store.subscribe('result', nodeId, cb),
    [store, nodeId]
  );
  return useSyncExternalStore(subscribe, () => store.getResult(nodeId));
}

export function useLiveTail(nodeId: string): string | undefined {
  const store = useNodeRunStore();
  const subscribe = useCallback(
    (cb: () => void) => store.subscribe('tail', nodeId, cb),
    [store, nodeId]
  );
  return useSyncExternalStore(subscribe, () => store.getTail(nodeId));
}

export function useNodeReliability(nodeId: string): Reliability | undefined {
  const store = useNodeRunStore();
  const subscribe = useCallback(
    (cb: () => void) => store.subscribe('reliability', nodeId, cb),
    [store, nodeId]
  );
  return useSyncExternalStore(subscribe, () => store.getReliability(nodeId));
}

/**
 * Run-from-here, when it is available: a callback while the editor has a past
 * record to seed from and no run in flight; null otherwise, and the cards hide
 * the button rather than offering a dead control.
 */
export const RunFromContext = createContext<((nodeId: string) => void) | null>(null);

export function useRunFrom(): ((nodeId: string) => void) | null {
  return useContext(RunFromContext);
}
