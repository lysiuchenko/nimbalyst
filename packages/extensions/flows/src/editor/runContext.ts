import { createContext, useContext } from 'react';
import type { NodeStatus } from '../runner/types';

/**
 * Per-node run status, published to the node components.
 *
 * Kept out of the xyflow store on purpose: writing status into node data would
 * look like a document edit, mark the file dirty, and put run state into the
 * saved `.flow.json`.
 */
export const RunStatusContext = createContext<Record<string, NodeStatus>>({});

export function useNodeStatus(nodeId: string): NodeStatus | undefined {
  return useContext(RunStatusContext)[nodeId];
}
