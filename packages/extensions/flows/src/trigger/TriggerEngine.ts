import { matchesGlob } from './matcher';
import { DEFAULT_DEBOUNCE_SECONDS, type FlowTrigger } from './types';

export interface TriggeredFlow {
  flowPath: string;
  trigger: FlowTrigger;
}

interface TriggerEngineDeps {
  /** The flows whose trigger is enabled, re-queried when a flow file changes. */
  listTriggered(): Promise<TriggeredFlow[]>;
  /** Whether this flow already has a run in flight — a fire is dropped, not queued. */
  isRunning(flowPath: string): boolean;
  runFlow(flowPath: string): Promise<void>;
}

/**
 * Turns a stream of file-change events into debounced flow runs.
 *
 * Saves arrive in bursts, so each matching event resets the flow's timer and
 * only silence fires. Self-noise — run records, schedule state, the flow files
 * themselves — never triggers: a flow that ran because it wrote its own record
 * would loop forever. A flow-file change refreshes the trigger list instead,
 * so editing a trigger takes effect without a restart.
 *
 * Metadata files are not the only echo. A run that writes a *content* file
 * matching its own trigger glob gets that change back from the watcher after it
 * ends — past the in-flight drop, which only covers events whose timer fires
 * while the run is still going. So each completion opens a settle window: a
 * matching event that happened at or before the run finished is that run's own
 * echo and is dropped, while a genuine edit made after it still fires.
 */
export class TriggerEngine {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private completedAt = new Map<string, number>();
  private flows: TriggeredFlow[] | null = null;
  private disposed = false;

  constructor(private deps: TriggerEngineDeps) {}

  async fileChanged(path: string): Promise<void> {
    if (this.disposed) return;
    if (path.includes('/.flow-runs/')) return;
    if (path.endsWith('.schedule.json')) return;
    if (path.endsWith('.flow.json')) {
      this.flows = null;
      return;
    }

    this.flows ??= await this.deps.listTriggered();
    if (this.disposed) return;

    for (const { flowPath, trigger } of this.flows) {
      if (!matchesGlob(trigger.glob, path)) continue;

      clearTimeout(this.pending.get(flowPath));
      const quiet = (trigger.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS) * 1000;
      this.pending.set(
        flowPath,
        setTimeout(() => {
          this.pending.delete(flowPath);
          if (this.deps.isRunning(flowPath)) return;
          // This fire was armed `quiet` ago, so the event happened at
          // `now - quiet`. If that is at or before the last run's completion,
          // the event is that run's own echo — swallow it instead of looping.
          const settledAt = this.completedAt.get(flowPath);
          if (settledAt !== undefined && Date.now() - quiet <= settledAt) return;
          void this.deps
            .runFlow(flowPath)
            .catch((error) => {
              console.warn(`[flows] triggered run of ${flowPath} failed:`, error);
            })
            .finally(() => {
              this.completedAt.set(flowPath, Date.now());
            });
        }, quiet)
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.completedAt.clear();
  }
}
