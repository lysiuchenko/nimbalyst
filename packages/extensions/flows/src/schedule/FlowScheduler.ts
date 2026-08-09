import { decideNextAction } from './decide';
import { nextRun } from './nextRun';
import type { FlowSchedule, ScheduleState } from './types';

/** A flow that has asked to run on its own. */
export interface ScheduledFlow {
  flowPath: string;
  schedule: FlowSchedule;
}

export interface FlowSchedulerDeps {
  /** Every flow in the workspace carrying an enabled schedule. */
  listScheduled: () => Promise<ScheduledFlow[]>;
  readState: (flowPath: string) => Promise<ScheduleState>;
  writeState: (flowPath: string, state: ScheduleState) => Promise<void>;
  /** Runs the flow and reports how it went. */
  runFlow: (flowPath: string) => Promise<{ runId: string; status: 'done' | 'failed' }>;
  /** Whether a run of this flow is already in flight anywhere in the app. */
  isRunning: (flowPath: string) => boolean;
  now?: () => number;
  /** How often to re-scan. Long enough to be cheap, short enough to be prompt. */
  intervalMs?: number;
}

const DEFAULT_SCAN_MS = 30_000;

/**
 * Fires scheduled flows while the app is open.
 *
 * A chain of timeouts rather than an interval, so a slow scan cannot overlap
 * the next one — the same shape the automations extension settled on. Every
 * decision worth arguing about lives in `decideNextAction`, which is pure; this
 * class only does the parts that touch the clock and the disk.
 */
export class FlowScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;

  constructor(private readonly deps: FlowSchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    const loop = () => {
      void this.tick().finally(() => {
        this.timer = setTimeout(loop, this.deps.intervalMs ?? DEFAULT_SCAN_MS);
      });
    };
    this.timer = setTimeout(loop, this.deps.intervalMs ?? DEFAULT_SCAN_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One pass over every scheduled flow. Safe to call directly, and in tests. */
  async tick(): Promise<void> {
    // A scan that overruns its interval must not run twice at once, or a flow
    // could be started by both passes.
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.deps.now?.() ?? Date.now();
      for (const flow of await this.deps.listScheduled()) {
        await this.considerOne(flow, now);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async considerOne(flow: ScheduledFlow, now: number): Promise<void> {
    const state = await this.deps.readState(flow.flowPath);
    const action = decideNextAction(flow.schedule, state, this.deps.isRunning(flow.flowPath), now);

    if (action.kind === 'idle') return;

    if (action.kind === 'wait') {
      // Write the deadline down the first time it is worked out. Without this
      // every scan recomputes `now + interval` and the schedule walks away from
      // itself, never arriving.
      if (state.dueAt === undefined) {
        await this.deps.writeState(flow.flowPath, { ...state, dueAt: action.until });
      }
      return;
    }

    if (action.kind === 'busy') {
      await this.deps.writeState(flow.flowPath, {
        ...state,
        dueAt: action.next ?? undefined,
        lastOutcome: 'skipped',
      });
      return;
    }

    if (action.kind === 'skip') {
      await this.deps.writeState(flow.flowPath, {
        ...state,
        dueAt: action.next ?? undefined,
        lastOutcome: 'missed',
      });
      return;
    }

    // A flow that throws must not take the scheduler down with it.
    let outcome: ScheduleState['lastOutcome'] = 'failed';
    let runId: string | undefined;
    try {
      const result = await this.deps.runFlow(flow.flowPath);
      outcome = result.status === 'done' ? 'done' : 'failed';
      runId = result.runId;
    } catch {
      outcome = 'failed';
    }

    await this.deps.writeState(flow.flowPath, {
      ...state,
      dueAt: nextRun(flow.schedule, this.deps.now?.() ?? Date.now()) ?? undefined,
      lastRunAt: now,
      ...(runId ? { lastRunId: runId } : {}),
      lastOutcome: outcome,
    });
  }
}
