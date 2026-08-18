// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createTimelineWriter,
  frameChanged,
  FRAME_PREVIEW_LIMIT,
  MAX_TIMELINE_FRAMES,
  nodeFrame,
  recordStateFrames,
  type TimelineFrame,
} from '../runTimeline';
import type { RunState } from '../types';

function frame(nodeId: string, at: number, output?: string): TimelineFrame {
  return { at, nodeId, status: 'running', ...(output !== undefined ? { output } : {}) };
}

describe('createTimelineWriter', () => {
  it('flushes buffered frames as parseable JSON to pathFor(runId)', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const writer = { write: vi.fn(async (path: string, content: string) => { writes.push({ path, content }); }) };
    const t = createTimelineWriter(writer, (id) => `/w/.flow-runs/${id}.timeline.json`);
    t.record('r', '/w/f.flow.json', frame('a', 0));
    t.record('r', '/w/f.flow.json', frame('a', 10, 'hi'));
    await t.flush();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('/w/.flow-runs/r.timeline.json');
    const parsed = JSON.parse(writes[0].content);
    expect(parsed.runId).toBe('r');
    expect(parsed.flowPath).toBe('/w/f.flow.json');
    expect(parsed.frames).toHaveLength(2);
  });

  it('does not write when there are no frames', async () => {
    const writer = { write: vi.fn(async () => {}) };
    const t = createTimelineWriter(writer, (id) => `/w/${id}.timeline.json`);
    await t.flush();
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('caps frame output to FRAME_PREVIEW_LIMIT', async () => {
    let captured = '';
    const writer = { write: vi.fn(async (_path: string, content: string) => { captured = content; }) };
    const t = createTimelineWriter(writer, (id) => `/w/${id}.timeline.json`);
    t.record('r', '/w/f', frame('a', 0, 'x'.repeat(FRAME_PREVIEW_LIMIT + 50)));
    await t.flush();
    const out: string = JSON.parse(captured).frames[0].output;
    expect(out.length).toBe(FRAME_PREVIEW_LIMIT + 1); // 400 chars + the '…' marker
    expect(out.endsWith('…')).toBe(true);
  });

  it('coalesces past MAX_TIMELINE_FRAMES, keeping every node\'s last frame', async () => {
    let captured = '';
    const writer = { write: vi.fn(async (_path: string, content: string) => { captured = content; }) };
    const t = createTimelineWriter(writer, (id) => `/w/${id}.timeline.json`);
    // Alternate two nodes for well past the cap.
    const total = MAX_TIMELINE_FRAMES + 500;
    for (let i = 0; i < total; i++) t.record('r', '/w/f', frame(i % 2 === 0 ? 'a' : 'b', i));
    await t.flush();
    const frames: TimelineFrame[] = JSON.parse(captured).frames;
    expect(frames.length).toBe(MAX_TIMELINE_FRAMES);
    // The last frame of each node (highest `at`) survives coalescing.
    const lastA = Math.max(...frames.filter((f) => f.nodeId === 'a').map((f) => f.at));
    const lastB = Math.max(...frames.filter((f) => f.nodeId === 'b').map((f) => f.at));
    expect(lastA).toBe(total - 2); // last even index
    expect(lastB).toBe(total - 1); // last odd index
    // Frames stay in ascending `at` order (only removals, never reorders).
    for (let i = 1; i < frames.length; i++) expect(frames[i].at).toBeGreaterThanOrEqual(frames[i - 1].at);
  });
});

function state(nodes: RunState['nodes']): RunState {
  return {
    runId: 'r', flowName: 'f', status: 'running', startedAt: 0,
    nodes, outputs: {}, usage: { inputTokens: 0, outputTokens: 0 },
  };
}

describe('state → frames', () => {
  it('frameChanged ignores `at` and detects status/output/children-shape changes', () => {
    const base = nodeFrame({ nodeId: 'a', status: 'running', output: 'x' }, 10);
    expect(frameChanged(base, nodeFrame({ nodeId: 'a', status: 'running', output: 'x' }, 99))).toBe(false);
    expect(frameChanged(base, nodeFrame({ nodeId: 'a', status: 'done', output: 'x' }, 10))).toBe(true);
    expect(frameChanged(base, nodeFrame({ nodeId: 'a', status: 'running', output: 'y' }, 10))).toBe(true);
    expect(frameChanged(undefined, base)).toBe(true);
    const withKids = nodeFrame({ nodeId: 'a', status: 'running', children: [{ label: 'c1', status: 'running' }] }, 10);
    expect(frameChanged(withKids, nodeFrame({ nodeId: 'a', status: 'running', children: [{ label: 'c1', status: 'done' }] }, 10))).toBe(true);
  });

  it('recordStateFrames dedupes unchanged nodes and flushes changed ones', async () => {
    const writes: string[] = [];
    const writer = { write: async (_p: string, c: string) => { writes.push(c); } };
    const t = createTimelineWriter(writer, (id) => `/w/${id}.timeline.json`);
    const last: Record<string, TimelineFrame> = {};
    recordStateFrames(t, last, state({ a: { nodeId: 'a', status: 'running', output: 'p' } }), '/w/f.flow.json', 0);
    // Same slice next tick → no new frame.
    recordStateFrames(t, last, state({ a: { nodeId: 'a', status: 'running', output: 'p' } }), '/w/f.flow.json', 5);
    // Output advances → one new frame.
    recordStateFrames(t, last, state({ a: { nodeId: 'a', status: 'done', output: 'pq' } }), '/w/f.flow.json', 10);
    await t.flush();
    const frames: TimelineFrame[] = JSON.parse(writes[0]).frames;
    expect(frames.map((f) => f.at)).toEqual([0, 10]);
    expect(frames[1].status).toBe('done');
  });
});
