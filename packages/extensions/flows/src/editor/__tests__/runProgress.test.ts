// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runProgress } from '../runProgress';

describe('runProgress', () => {
  it('counts settled steps against everything the run knows about', () => {
    expect(
      runProgress({ a: 'done', b: 'failed', c: 'running', d: 'queued', e: 'skipped' })
    ).toEqual({ settled: 3, total: 5, running: ['c'] });
  });

  it('lists every concurrently running step', () => {
    expect(runProgress({ a: 'running', b: 'running' })?.running).toEqual(['a', 'b']);
  });

  it('is null before anything has a status — there is no run to report', () => {
    expect(runProgress({})).toBeNull();
  });
});
