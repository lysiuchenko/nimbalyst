# Full-fidelity run replay (time-travel scrubber)

**Date:** 2026-08-18
**Status:** design
**Scope:** `packages/extensions/flows` only. No core files. Builds on the NodeRunStore landed in `2026-08-16-flows-canvas-render-storm-design.md`.

## Problem — what exists, what's missing

A replay primitive already ships, but it is status-dots only:

- `src/editor/replay.ts` — `replayDuration(record)` and `replayStatuses(record, atMs)` derive each node's `NodeStatus` from the finished record's coarse `startedAt`/`finishedAt` deltas.
- `FlowEditor.tsx` holds `replay: { record: RunRecord; atMs: number } | null` (~`:810`), swaps canvas statuses to `replayStatuses(...)` when `replayActive`, and renders a range-input scrubber (`data-testid="flow-replay"`, `flow-replay-slider`, `flow-replay-time`, `flow-replay-close`), triggered by a per-history-row "replay" button.

Two gaps make it a dot animation, not time-travel:

1. **It replays only `status`.** A scrubbed node shows queued/running/done but not the `output` it had produced, not fan-out `children`, not the live tail. The demo wow — "watch exactly what the agent did overnight" — needs the *content* at each moment, not just the color.
2. **Intermediate frames are gone.** `flowRun.ts:persist` does `store.save(structuredClone(state))` on every tick, **overwriting** `.flow-runs/<runId>.json` (last-write-wins). The persisted record therefore holds only *final* per-node outputs plus start/finish timestamps. There is no record of what a node's output/children were at t=30s, so nothing to scrub to.

## Approach — persist a bounded timeline, replay it through NodeRunStore

Record a compact, bounded **event timeline** as the run executes, then reconstruct full per-node slices at any `atMs` and feed them into the existing `NodeRunStore`. Because every card already subscribes to that store per-id (the render-storm work), scrubbing lights up cards with real content and re-renders only the nodes whose slice changed at that frame — the render budget is preserved for free.

### 1. Timeline sink (`src/runner/runTimeline.ts`, new)

A sibling of `RunStore` that appends one frame per state transition to `.flow-runs/<runId>.timeline.json` (same `.flow-runs/` dir, already `.gitignore`d `*`). Uses the same injected `RunFileWriter { write(path, content) }` as `RunStore` — no new host capability.

```ts
interface TimelineFrame {
  at: number;                              // epoch ms, from RunOptions.now()
  nodeId: string;                          // the node whose slice changed this transition
  status: NodeStatus;
  output?: string;                         // capped, see FRAME_PREVIEW_LIMIT
  children?: Array<Pick<ChildProgress, 'label' | 'status'>>;  // fan-out shape at this frame
  tail?: string;                           // capped, last FRAME_TAIL_LIMIT chars
}

interface RunTimeline { runId: string; flowPath: string; frames: TimelineFrame[]; }

interface TimelineWriter {
  record(runId: string, flowPath: string, frame: TimelineFrame): void; // buffers
  flush(): Promise<void>;                                                            // writes JSON
}
function createTimelineWriter(write: RunFileWriter, pathFor: (runId: string) => string): TimelineWriter;
```

**Bounds (non-negotiable — a run can emit thousands of ticks):**
- `FRAME_PREVIEW_LIMIT = 400` chars per `output` (reuse the existing `CHILD_PREVIEW_LIMIT` value/idiom).
- `FRAME_TAIL_LIMIT = 2000` chars per `tail` (last N only).
- `MAX_TIMELINE_FRAMES = 2000`. On overflow, coalesce: drop the *oldest* frame whose node has a newer frame (never drop a node's only/last frame). This keeps every node's final state and thins dense middles.
- Only emit a frame when a node's `(status, output, children-shape, tail)` actually changed vs its last recorded frame — dedupe against the fresh-spread-every-tick problem the store already solved.

Wire in `flowRun.ts`: on each `onStateChange`, diff `state.nodes[id]` against the last recorded frame per id and `record(...)` changed ones; call `flush()` on run completion (and on the same debounce as the existing `store.save`). Failure to write the timeline must never fail the run — wrap in try/catch, the run record is the source of truth.

### 2. Replay engine (`src/editor/replay.ts`, extend)

Add, alongside the existing coarse functions:

```ts
interface ReplaySlices {
  statuses: Record<string, NodeStatus>;
  results:  Record<string, NodeExecution>;   // synthesized from frames (output/status/timestamps)
  children: Record<string, ChildProgress[]>;
  tails:    Record<string, string>;
}
function replayState(timeline: RunTimeline, atMs: number): ReplaySlices;
function replayTimelineDuration(timeline: RunTimeline): number;   // last frame.at - first frame.at
```

`replayState` walks frames with `frame.at <= atMs`, keeping the latest per node/kind. A node with no frame yet ≤ atMs is `queued` and absent from results/children/tails. Pure, deterministic, no I/O.

Keep `replayStatuses`/`replayDuration` as the fallback when no timeline file exists (old runs recorded before this feature) — the scrubber degrades to status-only, never breaks.

### 3. Load (`src/editor/runHistory.ts`, extend)

When a history row is opened for replay, attempt to load `<dir>/.flow-runs/<runId>.timeline.json` via the same `WorkspaceFiles` reader; return `RunTimeline | null`. Null → status-only fallback.

### 4. Feed NodeRunStore + play/pause (`FlowEditor.tsx`)

- When `replayActive` and a timeline is present: on `atMs` change, compute `replayState(timeline, atMs)` and push all four slices into the run store (`runStore.setStatuses/setResults/setChildren/setTails`). This is the same store the live run feeds — cards render replayed *content*, per-id, budget intact.
- Add a **play/pause** control next to the scrubber (`flow-replay-play`) that auto-advances `atMs` in real (or 2×) time from the recorded frame clock — the "watch it run back" moment. Pause on drag.
- On `flow-replay-close`, clear the store slices back to live (or empty) state.

Non-card readers (`progress`, `gateContext`, `SubAgentLayer` live source) are untouched — replay only drives the per-card store, exactly as the render-storm design scoped it.

## Verification

1. **Timeline recorder unit test** (`runTimeline.test.ts`, `// @vitest-environment node`). Feed a scripted sequence of `RunState` ticks; assert: dedupe (an unchanged node emits no new frame), preview/tail caps applied, `MAX_TIMELINE_FRAMES` coalescing keeps every node's last frame and drops oldest-with-successor, `flush()` writes parseable JSON to `pathFor(runId)`.
2. **Replay engine unit test** (extend `replay.test.ts`, `node` env). Given a fixed `RunTimeline`: `replayState` at t<firstFrame → all queued/empty; mid-run → running node carries its partial `output` and a `children` array with the right per-child statuses; t>lastFrame → done nodes carry final output. A node absent from all frames ≤ atMs is absent from results.
3. **Mount render-budget test** (extend `runContext`/replay mount test, `createRoot` + `act`). Two probe cards over the run store; scrub the timeline one frame that changes node A only; assert A's card re-rendered with the replayed output and B's did not. Proves replay reuses the per-id budget.
4. **Fallback test:** `replayState` unused / timeline file missing → `FlowEditor` still drives `replayStatuses` (status-only), no throw.

## Out of scope

Live-run behavior (replay is strictly post-run). Sharing/export of a run (separate feature). Tail fidelity beyond the capped preview (full raw transcript stays out of the timeline — it's already available per-session in the host). Replaying `write-file`/`shell` side effects (we replay the recorded state, we never re-execute).

## Fork notes

No core files touched; no `FORK-NOTICE.md` row. All persistence uses the existing `RunFileWriter` injected from `services.filesystem.writeFile`; `.flow-runs/` is already git-ignored.
