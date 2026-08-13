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
 */
export class TriggerEngine {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
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
          this.deps.runFlow(flowPath).catch((error) => {
            console.warn(`[flows] triggered run of ${flowPath} failed:`, error);
          });
        }, quiet)
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}
