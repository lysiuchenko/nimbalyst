// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { deleteRunRecord } from '../deleteRunRecord';

describe('deleteRunRecord', () => {
  it('deletes the record beside the flow it came from', async () => {
    const invoke = vi.fn(async () => ({ success: true }));

    // `delete-file` stats the path, so it has to be the absolute one the
    // editor holds — not a workspace-relative path.
    await deleteRunRecord({ invoke }, '/repo/flows/release.flow.json', 'run-7');

    expect(invoke).toHaveBeenCalledWith('delete-file', '/repo/flows/.flow-runs/run-7.json');
  });

  it('handles a flow with no directory above it', async () => {
    const invoke = vi.fn(async () => ({ success: true }));

    await deleteRunRecord({ invoke }, 'release.flow.json', 'run-7');

    expect(invoke).toHaveBeenCalledWith('delete-file', '.flow-runs/run-7.json');
  });
});
