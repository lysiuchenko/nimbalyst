// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { openSession } from '../openSession';

describe('openSession', () => {
  it('asks the host to bring the session on screen', async () => {
    const invoke = vi.fn(async () => ({ success: true }));

    await openSession({ invoke }, 'session-1', '/repo');

    expect(invoke).toHaveBeenCalledWith('sessions:focus', 'session-1', '/repo');
  });
});
