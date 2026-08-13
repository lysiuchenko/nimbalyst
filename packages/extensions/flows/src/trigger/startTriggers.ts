import type { ExtensionContext } from '@nimbalyst/extension-sdk';
import { BackendShellClient } from '../host/backendShellClient';
import { NimbalystAgentClient } from '../host/nimbalystAgentClient';
import { onFileChangedOnDisk } from '../host/rendererEvents';
import { parseFlowFile } from '../schema/validate';
import { runFlow } from '../runner/flowRun';
import { unattendedGatePolicy } from '../schedule/gatePolicy';
import { TriggerEngine, type TriggeredFlow } from './TriggerEngine';

/** The same allowlist the editor and the scheduler use. */
const SHELL_ALLOWLIST = ['npm', 'npx', 'node', 'git', 'echo', 'ls', 'pwd', 'cat'];

/**
 * Start firing file-change triggers for this workspace.
 *
 * Lives in `activate()` beside the scheduler for the same reason it does:
 * this is the only place with the host services a flow needs, and agent nodes
 * cannot run headlessly anyway.
 */
export function startTriggers(context: ExtensionContext): { dispose(): void } | null {
  const services = context.services;
  if (!services?.ai || !services.filesystem) return null;

  const inFlight = new Set<string>();

  const engine = new TriggerEngine({
    listTriggered: async () => {
      const paths = (await services.filesystem.findFiles('*.flow.json')) ?? [];
      const found: TriggeredFlow[] = [];
      for (const flowPath of paths) {
        try {
          const parsed = parseFlowFile(await services.filesystem.readFile(flowPath));
          if (parsed.valid && parsed.flow.trigger?.enabled) {
            found.push({ flowPath, trigger: parsed.flow.trigger });
          }
        } catch {
          // A flow that will not parse cannot trigger; the editor is where
          // that gets reported, not a background listener.
        }
      }
      return found;
    },

    isRunning: (flowPath) => inFlight.has(flowPath),

    runFlow: async (flowPath) => {
      const parsed = parseFlowFile(await services.filesystem.readFile(flowPath));
      if (!parsed.valid) throw new Error(`${flowPath} is not a valid flow`);

      const policy = unattendedGatePolicy(parsed.flow, parsed.flow.trigger?.onGate, 'triggered');
      if (policy.kind === 'needs-a-person') {
        services.ui?.showWarning(policy.reason);
        return;
      }

      inFlight.add(flowPath);
      try {
        const record = await runFlow(parsed.flow, flowPath, {
          // No session host, exactly like a scheduled run: `ExtensionContext`
          // carries no workspace path, so a `worktree: true` node fails loudly
          // rather than quietly editing the main tree.
          agent: new NimbalystAgentClient(services.ai!),
          shell: new BackendShellClient(services.ai!, SHELL_ALLOWLIST),
          // Only reached when the policy allowed it.
          gate: { requestApproval: async () => 'approved' },
          writer: { write: (path, content) => services.filesystem.writeFile(path, content) },
          allowlist: SHELL_ALLOWLIST,
        });

        if (record.status === 'failed') {
          services.ui?.showWarning(`Triggered run of ${parsed.flow.name} failed.`);
        }
      } finally {
        inFlight.delete(flowPath);
      }
    },
  });

  const unsubscribe = onFileChangedOnDisk((path) => void engine.fileChanged(path));
  console.log('[flows] file-change triggers armed');

  return {
    dispose() {
      unsubscribe();
      engine.dispose();
    },
  };
}
