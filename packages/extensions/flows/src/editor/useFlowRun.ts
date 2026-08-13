import { useCallback, useRef, useState } from 'react';
import type { EditorHost } from '@nimbalyst/extension-sdk';
import { BackendShellClient } from '../host/backendShellClient';
import { getHostServices } from '../host/hostServices';
import { NimbalystAgentClient } from '../host/nimbalystAgentClient';
import { NimbalystSessionHost, type HostIpc } from '../host/nimbalystSessionHost';
import type { Flow } from '../schema/types';
import { runFlow } from '../runner/flowRun';
import type { GateDecision } from '../runner/ports';
import type { RunFileWriter, RunRecord } from '../runner/runStore';
import type { ChildProgress, NodeExecution, NodeStatus, RunState } from '../runner/types';
import { gateNotification, runNotification } from './runNotifications';

export interface PendingGate {
  nodeId: string;
  message: string;
  decide(decision: GateDecision): void;
}

export interface FlowRunControls {
  isRunning: boolean;
  statuses: Record<string, NodeStatus>;
  /**
   * The run's node executions as they happen, output included — what lets a
   * pending gate show the work it is gating instead of asking for blind
   * approval.
   */
  liveNodes: Record<string, NodeExecution>;
  /** Live sub-agents, keyed by the fan-out node that spawned them. */
  children: Record<string, ChildProgress[]>;
  runState: RunState | null;
  runError: string | null;
  pendingGate: PendingGate | null;
  /**
   * Run the flow. With `resumeFrom`, a failed run's finished steps are carried
   * over instead of re-executed — agents do not re-bill and gates do not
   * re-ask for work that already succeeded.
   */
  start(flow: Flow, resumeFrom?: RunRecord): Promise<void>;
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
  const [liveNodes, setLiveNodes] = useState<Record<string, NodeExecution>>({});
  const [children, setChildren] = useState<Record<string, ChildProgress[]>>({});
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
    async (flow: Flow, resumeFrom?: RunRecord) => {
      const services = getHostServices();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsRunning(true);
      setRunError(null);
      setStatuses(Object.fromEntries(flow.nodes.map((node) => [node.id, 'queued' as NodeStatus])));
      setLiveNodes({});
      setChildren({});

      const writer: RunFileWriter = {
        write: (path, content) => services.filesystem.writeFile(path, content),
      };

      // Gates and failures are the two moments a run needs the user back, and
      // the canvas may not be the visible tab — so they go through the host's
      // own notifications rather than only rendering in the editor.
      // Gives isolated nodes their own checkout and reads token usage back off
      // the sessions the run creates. Absent only if the host exposes no IPC,
      // in which case a `worktree: true` node fails instead of running loose.
      const ipc = (window as unknown as { electronAPI?: HostIpc }).electronAPI;
      const workspacePath =
        host.workspaceId ?? host.filePath.slice(0, Math.max(host.filePath.lastIndexOf('/'), 0));
      const sessionHost =
        ipc && workspacePath ? new NimbalystSessionHost(ipc, workspacePath) : undefined;

      const notify = services.ui;

      // Native, run-level notifications. The host gates these on its own
      // settings and window focus, so they surface exactly when the app is in
      // the background — the case the in-app toasts cannot cover. Per-step
      // "Response Ready" noise is suppressed on the sessions themselves.
      const notifyNative = (copy: { title: string; body: string }) => {
        void (window as unknown as { electronAPI?: HostIpc }).electronAPI
          ?.invoke('notifications:show', { ...copy, workspacePath })
          .catch(() => {
            // Never let a notification failure touch the run.
          });
      };

      try {
        const record = await runFlow(
          flow,
          host.filePath,
          {
            agent: new NimbalystAgentClient(services.ai!, sessionHost, sessionHost),
            shell: new BackendShellClient(services.ai!, SHELL_ALLOWLIST),
            gate: {
              requestApproval: (request) =>
                new Promise<GateDecision>((resolve) => {
                  notify.showWarning(`Flow paused: ${request.message}`);
                  notifyNative(gateNotification(flow.name, request.nodeId, request.message));
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
            ...(resumeFrom ? { resumeFrom } : {}),
            signal: controller.signal,
            onStateChange: (state) => {
              setStatuses(
                Object.fromEntries(
                  Object.values(state.nodes).map((node) => [node.nodeId, node.status])
                )
              );
              // Shallow copies: the runner mutates its state object in place,
              // and React must see a fresh reference to re-render.
              setLiveNodes(
                Object.fromEntries(
                  Object.values(state.nodes).map((node) => [node.nodeId, { ...node }])
                )
              );
              setChildren(
                Object.fromEntries(
                  Object.values(state.nodes)
                    .filter((node) => node.children !== undefined)
                    .map((node) => [node.nodeId, node.children!])
                )
              );
            },
          }
        );

        setRunState({ ...record, outputs: record.outputs } as RunState);
        notifyNative(runNotification(record));
        if (record.status === 'failed') {
          const failed = Object.values(record.nodes).find((node) => node.status === 'failed');
          const reason = failed ? `${failed.nodeId}: ${failed.error}` : 'the run failed';
          setRunError(reason);
          notify.showError(`Flow "${record.flowName}" failed — ${reason}`);
        } else if (record.status === 'done') {
          notify.showInfo(`Flow "${record.flowName}" finished.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRunError(message);
        notify.showError(`Flow could not run — ${message}`);
      } finally {
        setIsRunning(false);
        abortRef.current = null;
      }
    },
    [host]
  );

  return { isRunning, statuses, liveNodes, children, runState, runError, pendingGate, start, cancel };
}
