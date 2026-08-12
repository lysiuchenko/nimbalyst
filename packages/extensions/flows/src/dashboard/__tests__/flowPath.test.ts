// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { flowBasename, flowPathKey, workspaceRelativeFlowPath } from '../flowPath';

describe('flow paths', () => {
  it('makes a POSIX path relative only inside the exact workspace boundary', () => {
    expect(workspaceRelativeFlowPath('/repo/deep/nightly.flow.json', '/repo')).toBe(
      'deep/nightly.flow.json'
    );
    expect(workspaceRelativeFlowPath('/repository/nightly.flow.json', '/repo')).toBe(
      '/repository/nightly.flow.json'
    );
  });

  it('normalises Windows separators and drive-letter case', () => {
    expect(workspaceRelativeFlowPath('c:\\Repo\\deep\\Nightly.flow.json', 'C:\\repo')).toBe(
      'deep/Nightly.flow.json'
    );
    expect(flowPathKey('DEEP\\NIGHTLY.flow.json', 'C:\\repo')).toBe('deep/nightly.flow.json');
  });

  it('gives absolute and relative forms one canonical key', () => {
    expect(flowPathKey('/repo/deep/nightly.flow.json', '/repo')).toBe(
      flowPathKey('./deep/nightly.flow.json', '/repo')
    );
  });

  it('handles filesystem roots without constructing a double-slash boundary', () => {
    expect(workspaceRelativeFlowPath('/nightly.flow.json', '/')).toBe('nightly.flow.json');
    expect(workspaceRelativeFlowPath('C:\\nightly.flow.json', 'c:\\')).toBe('nightly.flow.json');
  });

  it('extracts a fallback name with either separator style', () => {
    expect(flowBasename('C:\\repo\\deep\\nightly.flow.json')).toBe('nightly');
  });
});
