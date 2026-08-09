import { classifyDue, needsTheApp, type ScheduledEntry } from '../schedule/dueFlows';
import { nextRun } from '../schedule/nextRun';
import { readScheduleState, writeScheduleState } from '../schedule/scheduleState';
import { parseFlowFile } from '../schema/validate';
import type { ScheduleAction } from './cli';

export interface ScheduleDeps {
  /** Flow files in the workspace, relative to it. */
  listFlows(): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** Runs one flow headlessly and reports whether it worked. */
  runFlow(flowPath: string): Promise<boolean>;
  /** Writes or removes the OS-level agent. `print` only describes the plan. */
  installAgent(everyMinutes: number, print: boolean): Promise<string>;
  uninstallAgent(print: boolean): Promise<string>;
  log(message: string): void;
  now?: () => number;
}

function whenText(at: number | null | undefined): string {
  return at ? new Date(at).toLocaleString() : 'never';
}

/** Load every scheduled flow in the workspace, skipping ones that will not parse. */
async function collect(deps: ScheduleDeps): Promise<ScheduledEntry[]> {
  const entries: ScheduledEntry[] = [];

  for (const flowPath of await deps.listFlows()) {
    try {
      const parsed = parseFlowFile(await deps.readFile(flowPath));
      if (!parsed.valid || !parsed.flow.schedule) continue;
      entries.push({
        flowPath,
        flow: parsed.flow,
        state: await readScheduleState({ readFile: deps.readFile } as never, flowPath),
      });
    } catch {
      // A flow that cannot be read is the editor's problem to report, not the
      // scheduler's to crash on.
    }
  }
  return entries;
}

/**
 * `schedule` — the app-closed half of scheduling.
 *
 * Shell and gate flows run here directly. Agent flows are reported rather than
 * attempted, because the credentials and binary resolution they need live in
 * the app; saying so is more use than a failed run at 2am.
 */
export async function runScheduleCommand(
  action: ScheduleAction,
  everyMinutes: number,
  deps: ScheduleDeps,
  print = false
): Promise<number> {
  const now = deps.now?.() ?? Date.now();

  if (action === 'install') {
    deps.log(await deps.installAgent(everyMinutes, print));
    return 0;
  }
  if (action === 'uninstall') {
    deps.log(await deps.uninstallAgent(print));
    return 0;
  }

  const entries = await collect(deps);
  if (entries.length === 0) {
    deps.log('No flow in this workspace has a schedule.');
    return 0;
  }

  const due = classifyDue(entries, now);

  if (action === 'list') {
    for (const entry of entries) {
      const at = entry.state.dueAt ?? nextRun(entry.flow.schedule!, now);
      // Asked of the flow, not of the due list: whether a flow can run out here
      // is a property of its steps, and worth knowing before it comes due.
      const blocked = needsTheApp(entry.flow);
      deps.log(`${entry.flow.name}  next ${whenText(at)}${blocked ? '  (needs the app)' : ''}`);
    }
    return 0;
  }

  // Anchor the first due time. Without this every invocation recomputes
  // `now + interval`, the deadline walks away, and nothing ever runs — the same
  // trap the in-app scheduler hit.
  for (const entry of due.waiting) {
    if (entry.state.dueAt !== undefined) continue;
    const at = nextRun(entry.flow.schedule!, now);
    if (at === null) continue;
    await writeScheduleState({ write: deps.writeFile }, entry.flowPath, {
      ...entry.state,
      dueAt: at,
    });
  }

  for (const entry of due.missed) {
    deps.log(`${entry.flow.name}: missed — due ${whenText(entry.due)}, too old to run now`);
    await writeScheduleState({ write: deps.writeFile }, entry.flowPath, {
      ...entry.state,
      dueAt: nextRun(entry.flow.schedule!, now) ?? undefined,
      lastOutcome: 'missed',
    });
  }

  for (const entry of due.needsApp) {
    deps.log(`${entry.flow.name}: skipped — ${entry.reason}`);
  }

  let failures = 0;
  for (const entry of due.runnable) {
    deps.log(`${entry.flow.name}: running`);
    let ok = false;
    try {
      ok = await deps.runFlow(entry.flowPath);
    } catch (error) {
      deps.log(`${entry.flow.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!ok) failures += 1;

    await writeScheduleState({ write: deps.writeFile }, entry.flowPath, {
      ...entry.state,
      dueAt: nextRun(entry.flow.schedule!, deps.now?.() ?? Date.now()) ?? undefined,
      lastRunAt: now,
      lastOutcome: ok ? 'done' : 'failed',
    });
  }

  if (due.runnable.length === 0) deps.log('Nothing is due.');
  return failures > 0 ? 1 : 0;
}
