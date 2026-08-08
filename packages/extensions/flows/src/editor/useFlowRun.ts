import { useCallback, useRef, useState } from 'react';
import type { EditorHost } from '@nimbalyst/extension-sdk';
import { BackendShellClient } from '../host/backendShellClient';
import { getHostServices } from '../host/hostServices';
import { NimbalystAgentClient } from '../host/nimbalystAgentClient';
import type { Flow } from '../schema/types';
import { runFlow } from '../runner/flowRun';
import type { GateDecision } from '../runner/ports';
import type { RunFileWriter } from '../runner/runStore';
import type { NodeStatus, RunState } from '../runner/types';

export interface PendingGate {
  nodeId: string;
  message: string;
  decide(decision: GateDecision): void;
}

export interface FlowRunControls {
  isRunning: boolean;
  statuses: Record<string, NodeStatus>;
  runState: RunState | null;
  runError: string | null;
  pendingGate: PendingGate | null;
  start(flow: Flow): Promise<void>;
  cancel(): void;
}

/** Executables a flow may run. Deliberately short; see docs/flows-security.md. */
const SHELL_ALLOWLIST = ['npm', 'npx', 'node', 'git', 'echo', 'ls', 'pwd', 'cat'];

/**
 * Runs the flow on the canvas and reports progress back to it.
 *
 * The run is driven from the editor rather than the host, so cancelling, gate
 * approval and per-node status all stay next to the canvas the user is looking
 * at.
 */
export function useFlowRun(host: EditorHost): FlowRunControls {
  const [isRunning, setIsRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>({});
  const [runState, setRunState] = useState<RunState | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [pendingGate, setPendingGate] = useState<PendingGate | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setPendingGate((gate) => {
      gate?.decide('rejected');
      return null;
    });
  }, []);

  const start = useCallback(
    async (flow: Flow) => {
      const services = getHostServices();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsRunning(true);
      setRunError(null);
      setStatuses(Object.fromEntries(flow.nodes.map((node) => [node.id, 'queued' as NodeStatus])));

      const writer: RunFileWriter = {
        write: (path, content) => services.filesystem.writeFile(path, content),
      };

      try {
        const record = await runFlow(
          flow,
          host.filePath,
          {
            agent: new NimbalystAgentClient(services.ai!),
            shell: new BackendShellClient(services.ai!, SHELL_ALLOWLIST),
            gate: {
              requestApproval: (request) =>
                new Promise<GateDecision>((resolve) => {
                  setPendingGate({
                    nodeId: request.nodeId,
                    message: request.message,
                    decide: (decision) => {
                      setPendingGate(null);
                      resolve(decision);
                    },
                  });
                }),
            },
            writer,
            allowlist: SHELL_ALLOWLIST,
          },
          {
            signal: controller.signal,
            onStateChange: (state) => {
              setStatuses(
                Object.fromEntries(
                  Object.values(state.nodes).map((node) => [node.nodeId, node.status])
                )
              );
            },
          }
        );

        setRunState({ ...record, outputs: record.outputs } as RunState);
        if (record.status === 'failed') {
          const failed = Object.values(record.nodes).find((node) => node.status === 'failed');
          setRunError(failed ? `${failed.nodeId}: ${failed.error}` : 'the run failed');
        }
      } catch (error) {
        setRunError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsRunning(false);
        abortRef.current = null;
      }
    },
    [host]
  );

  return { isRunning, statuses, runState, runError, pendingGate, start, cancel };
}
