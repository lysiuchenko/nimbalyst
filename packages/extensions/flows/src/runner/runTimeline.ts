import type { ChildProgress, NodeExecution, NodeStatus, RunState } from './types';
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

/** Project a node execution onto a timeline frame (status/output/children only). */
export function nodeFrame(execution: NodeExecution, at: number): TimelineFrame {
  const frame: TimelineFrame = { at, nodeId: execution.nodeId, status: execution.status };
  if (execution.output !== undefined) frame.output = execution.output;
  if (execution.children) frame.children = execution.children.map((c) => ({ label: c.label, status: c.status }));
  return frame;
}

function childrenEqual(a: TimelineFrame['children'], b: TimelineFrame['children']): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((child, i) => child.label === b[i].label && child.status === b[i].status);
}

/** True when the meaningful slice changed (ignores `at`). */
export function frameChanged(prev: TimelineFrame | undefined, next: TimelineFrame): boolean {
  if (!prev) return true;
  return prev.status !== next.status || prev.output !== next.output || !childrenEqual(prev.children, next.children);
}

/**
 * Record a frame for every node whose slice changed since its last frame.
 * `flowPath` is passed in — `RunState` carries no flowPath (`types.ts:116-128`);
 * the run's path is known at the call site in `flowRun.ts`. Mutates `lastFrame`.
 */
export function recordStateFrames(
  timeline: TimelineWriter,
  lastFrame: Record<string, TimelineFrame>,
  state: RunState,
  flowPath: string,
  at: number,
): void {
  for (const execution of Object.values(state.nodes)) {
    const frame = nodeFrame(execution, at);
    if (frameChanged(lastFrame[execution.nodeId], frame)) {
      lastFrame[execution.nodeId] = frame;
      timeline.record(state.runId, flowPath, frame);
    }
  }
}
