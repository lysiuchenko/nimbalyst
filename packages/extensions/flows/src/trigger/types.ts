/** A flow-level trigger: run the flow when the workspace changes. */
export interface FlowTrigger {
  type: 'file-change';
  /** Workspace-relative glob; `**` spans directories, `*` stays in a segment. */
  glob: string;
  /** Quiet period before firing — saves arrive in bursts. Default 10. */
  debounceSeconds?: number;
  /** Same meaning as a schedule's: a triggered run is just as unattended. */
  onGate?: 'pause' | 'skip';
  enabled: boolean;
}

export const DEFAULT_DEBOUNCE_SECONDS = 10;
