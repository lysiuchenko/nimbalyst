import type { ExtensionContext } from '@nimbalyst/extension-sdk';
import { BackendShellClient } from '../host/backendShellClient';
import { NimbalystAgentClient } from '../host/nimbalystAgentClient';
import { parseFlowFile } from '../schema/validate';
import { runFlow } from '../runner/flowRun';
import { FlowScheduler, type ScheduledFlow } from './FlowScheduler';
import { readScheduleState, writeScheduleState } from './scheduleState';
import { scheduledGatePolicy } from './gatePolicy';

/** Executables a scheduled flow may run — the same list the editor uses. */
const SHELL_ALLOWLIST = ['npm', 'npx', 'node', 'git', 'echo', 'ls', 'pwd', 'cat'];

/**
 * Start firing scheduled flows for this workspace.
 *
 * Runs in the renderer from `activate()`, which is where the automations
 * extension puts its scheduler too: it is the only place with the host services
 * a flow needs, and agent nodes cannot run headlessly anyway.
 */
export function startScheduler(context: ExtensionContext): FlowScheduler | null {
  const services = context.services;
  if (!services?.ai || !services.filesystem) return null;

  const inFlight = new Set<string>();

  const scheduler = new FlowScheduler({
    listScheduled: async () => {
      // `findFiles` walks from the glob's *literal* prefix, so a leading `**/`
      // scans nothing at all — the same trap the run-history loader hit.
      const paths = (await services.filesystem.findFiles('*.flow.json')) ?? [];
      const found: ScheduledFlow[] = [];

      for (const flowPath of paths) {
        try {
          const parsed = parseFlowFile(await services.filesystem.readFile(flowPath));
          if (parsed.valid && parsed.flow.schedule?.enabled) {
            found.push({ flowPath, schedule: parsed.flow.schedule });
          }
        } catch {
          // A flow that will not parse cannot be scheduled; the editor is where
          // that gets reported, not a background scan.
        }
      }
      return found;
    },

    readState: (flowPath) => readScheduleState(services.filesystem, flowPath),
    writeState: (flowPath, state) =>
      writeScheduleState(
        { write: (path, content) => services.filesystem.writeFile(path, content) },
        flowPath,
        state
      ),

    isRunning: (flowPath) => inFlight.has(flowPath),

    runFlow: async (flowPath) => {
      const parsed = parseFlowFile(await services.filesystem.readFile(flowPath));
      if (!parsed.valid) throw new Error(`${flowPath} is not a valid flow`);

      const policy = scheduledGatePolicy(parsed.flow);
      if (policy.kind === 'needs-a-person') {
        services.ui?.showWarning(policy.reason);
        throw new Error(policy.reason);
      }

      inFlight.add(flowPath);
      try {
        const record = await runFlow(parsed.flow, flowPath, {
          // No session host: `ExtensionContext` carries no workspace path, and
          // worktree creation needs one. A `worktree: true` node therefore fails
          // loudly in a scheduled run rather than quietly editing the main tree.
          agent: new NimbalystAgentClient(services.ai!),
          shell: new BackendShellClient(services.ai!, SHELL_ALLOWLIST),
          // Only reached when the policy allowed it, which the validator only
          // permits for a flow that runs no commands.
          gate: { requestApproval: async () => 'approved' },
          writer: { write: (path, content) => services.filesystem.writeFile(path, content) },
          allowlist: SHELL_ALLOWLIST,
        });

        if (record.status === 'failed') {
          services.ui?.showWarning(`Scheduled run of ${parsed.flow.name} failed.`);
        }
        return { runId: record.runId, status: record.status === 'done' ? 'done' : 'failed' };
      } finally {
        inFlight.delete(flowPath);
      }
    },
  });

  console.log('[flows] scheduler started');
  scheduler.start();
  // Fire the first scan immediately so a schedule that came due while the app
  // was closed does not wait a whole interval to catch up.
  void scheduler.tick();
  return scheduler;
}
