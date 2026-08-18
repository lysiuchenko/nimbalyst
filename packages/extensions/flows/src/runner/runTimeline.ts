import type { ChildProgress, NodeStatus } from './types';
import type { RunFileWriter } from './runStore';

/** Max chars kept per frame `output`. Matches CHILD_PREVIEW_LIMIT (executors.ts). */
export const FRAME_PREVIEW_LIMIT = 400;
/** Hard cap on frames per timeline; a run can emit thousands of ticks. */
export const MAX_TIMELINE_FRAMES = 2000;

/** One node's slice at one state transition. */
export interface TimelineFrame {
  at: number;
  nodeId: string;
  status: NodeStatus;
  output?: string;
  children?: Array<Pick<ChildProgress, 'label' | 'status'>>;
}

export interface RunTimeline {
  runId: string;
  flowPath: string;
  frames: TimelineFrame[];
}

export interface TimelineWriter {
  record(runId: string, flowPath: string, frame: TimelineFrame): void;
  flush(): Promise<void>;
}

function cap(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/**
 * Buffers timeline frames and writes them as one JSON blob on flush. Enforces
 * the per-frame output cap on record and the MAX_TIMELINE_FRAMES bound by
 * dropping the oldest frame whose node has a newer one — so every node keeps
 * its last frame and dense middles thin out.
 */
export function createTimelineWriter(
  writer: RunFileWriter,
  pathFor: (runId: string) => string,
): TimelineWriter {
  const frames: TimelineFrame[] = [];
  let runId = '';
  let flowPath = '';

  const dropOldestWithSuccessor = () => {
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        if (frames[j].nodeId === frames[i].nodeId) {
          frames.splice(i, 1);
          return;
        }
      }
    }
  };

  return {
    record(nextRunId, nextFlowPath, frame) {
      runId = nextRunId;
      flowPath = nextFlowPath;
      frames.push(
        frame.output !== undefined ? { ...frame, output: cap(frame.output, FRAME_PREVIEW_LIMIT) } : frame,
      );
      if (frames.length > MAX_TIMELINE_FRAMES) dropOldestWithSuccessor();
    },
    async flush() {
      if (frames.length === 0) return;
      const timeline: RunTimeline = { runId, flowPath, frames };
      await writer.write(pathFor(runId), `${JSON.stringify(timeline, null, 2)}\n`);
    },
  };
}
