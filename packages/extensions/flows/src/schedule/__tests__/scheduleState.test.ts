// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readScheduleState, statePathFor, writeScheduleState } from '../scheduleState';

describe('statePathFor', () => {
  it('keeps state beside the runs, never in the flow file', () => {
    expect(statePathFor('flows/release.flow.json')).toBe(
      'flows/.flow-runs/release.flow.json.schedule.json'
    );
  });

  it('handles a flow at the workspace root', () => {
    expect(statePathFor('release.flow.json')).toBe('.flow-runs/release.flow.json.schedule.json');
  });

  it('normalises Windows separators before placing state beside the flow', () => {
    expect(statePathFor('C:\\repo\\flows\\release.flow.json')).toBe(
      'C:/repo/flows/.flow-runs/release.flow.json.schedule.json'
    );
  });
});

describe('readScheduleState', () => {
  it('reads what was written', async () => {
    const files = { readFile: vi.fn(async () => JSON.stringify({ dueAt: 42 })) };

    expect(await readScheduleState(files, 'a.flow.json')).toEqual({ dueAt: 42 });
  });

  it('starts clean when there is no state, rather than refusing to schedule', async () => {
    const files = {
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    };

    expect(await readScheduleState(files, 'a.flow.json')).toEqual({});
  });

  it('survives a hand-edited state file', async () => {
    const files = { readFile: vi.fn(async () => 'not json') };

    expect(await readScheduleState(files, 'a.flow.json')).toEqual({});
  });
});

describe('writeScheduleState', () => {
  it('writes state to the run directory', async () => {
    const written: Record<string, string> = {};

    await writeScheduleState(
      { write: async (path, content) => void (written[path] = content) },
      'a.flow.json',
      { dueAt: 7 }
    );

    expect(JSON.parse(written['.flow-runs/a.flow.json.schedule.json'])).toEqual({ dueAt: 7 });
  });
});
