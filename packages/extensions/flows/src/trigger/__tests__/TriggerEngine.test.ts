// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TriggerEngine } from '../TriggerEngine';
import type { FlowTrigger } from '../types';

const trigger = (over: Partial<FlowTrigger> = {}): FlowTrigger => ({
  type: 'file-change',
  glob: 'notes/*.md',
  debounceSeconds: 1,
  enabled: true,
  ...over,
});

function engineWith(over: Partial<ConstructorParameters<typeof TriggerEngine>[0]> = {}) {
  const runs: string[] = [];
  const engine = new TriggerEngine({
    listTriggered: async () => [{ flowPath: 'a.flow.json', trigger: trigger() }],
    isRunning: () => false,
    runFlow: async (flowPath) => {
      runs.push(flowPath);
    },
    ...over,
  });
  return { engine, runs };
}

describe('TriggerEngine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a burst of matching saves fires exactly one run, after the quiet period', async () => {
    const { engine, runs } = engineWith();

    await engine.fileChanged('/w/notes/a.md');
    await engine.fileChanged('/w/notes/a.md');
    await engine.fileChanged('/w/notes/b.md');
    expect(runs).toEqual([]);

    await vi.advanceTimersByTimeAsync(999);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(runs).toEqual(['a.flow.json']);
  });

  it('every matching event resets the timer — only silence fires', async () => {
    const { engine, runs } = engineWith();

    await engine.fileChanged('/w/notes/a.md');
    await vi.advanceTimersByTimeAsync(900);
    await engine.fileChanged('/w/notes/a.md');
    await vi.advanceTimersByTimeAsync(900);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(runs).toEqual(['a.flow.json']);
  });

  it('a non-matching path does nothing', async () => {
    const { engine, runs } = engineWith();

    await engine.fileChanged('/w/src/index.ts');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toEqual([]);
  });

  it('drops the fire while the flow is already running — no queueing', async () => {
    const { engine, runs } = engineWith({ isRunning: () => true });

    await engine.fileChanged('/w/notes/a.md');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toEqual([]);
  });

  it('run records and flow files never trigger — that way lies a loop', async () => {
    const { engine, runs } = engineWith({
      listTriggered: async () => [
        { flowPath: 'a.flow.json', trigger: trigger({ glob: '**' }) },
      ],
    });

    await engine.fileChanged('/w/.flow-runs/run-1.json');
    await engine.fileChanged('/w/a.flow.json');
    await engine.fileChanged('/w/a.flow.json.schedule.json');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toEqual([]);
  });

  it('absorbs the echo of its own run — a flow that writes its own trigger target settles', async () => {
    const runs: string[] = [];
    let engine: TriggerEngine;
    engine = new TriggerEngine({
      listTriggered: async () => [{ flowPath: 'a.flow.json', trigger: trigger() }],
      isRunning: () => false,
      runFlow: async (flowPath) => {
        runs.push(flowPath);
        // The run writes a file that matches its own trigger. The watcher
        // delivers that change after the run ends, past the in-flight drop.
        await engine.fileChanged('/w/notes/out.md');
      },
    });

    await engine.fileChanged('/w/notes/a.md');
    await vi.advanceTimersByTimeAsync(11_000); // fires the run, which writes an echo
    await vi.advanceTimersByTimeAsync(11_000); // the echo would fire a second run
    await vi.advanceTimersByTimeAsync(11_000);

    expect(runs).toEqual(['a.flow.json']);
  });

  it('still fires on a genuine edit made after the run settles', async () => {
    const { engine, runs } = engineWith();

    await engine.fileChanged('/w/notes/a.md');
    await vi.advanceTimersByTimeAsync(11_000); // one run
    expect(runs).toEqual(['a.flow.json']);

    // A real edit that arrives well after the run completed is not an echo.
    await vi.advanceTimersByTimeAsync(20_000);
    await engine.fileChanged('/w/notes/b.md');
    await vi.advanceTimersByTimeAsync(11_000);
    expect(runs).toEqual(['a.flow.json', 'a.flow.json']);
  });

  it('editing a flow refreshes the trigger list', async () => {
    let globNow = 'notes/*.md';
    const { engine, runs } = engineWith({
      listTriggered: async () => [
        { flowPath: 'a.flow.json', trigger: trigger({ glob: globNow }) },
      ],
    });

    // Arm the cache with the old glob, then change it on "disk".
    await engine.fileChanged('/w/other.txt');
    globNow = 'docs/*.md';
    await engine.fileChanged('/w/a.flow.json');

    await engine.fileChanged('/w/docs/readme.md');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(runs).toEqual(['a.flow.json']);
  });

  it('dispose cancels a pending fire', async () => {
    const { engine, runs } = engineWith();

    await engine.fileChanged('/w/notes/a.md');
    engine.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toEqual([]);
  });
});
