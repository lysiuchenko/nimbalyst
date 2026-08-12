import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setHostServicesForTest } from '../../host/hostServices';
import { FlowsDashboard } from '../FlowsDashboard';

describe('FlowsDashboard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    __setHostServicesForTest(undefined);
  });

  it('shows a recoverable load error and retries instead of staying blank', async () => {
    const findFiles = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('workspace unavailable'))
      .mockResolvedValue([]);
    __setHostServicesForTest({
      filesystem: { findFiles, readFile: vi.fn() },
    } as never);

    await act(async () => {
      root.render(<FlowsDashboard host={host()} />);
      await settle();
    });

    expect(container.querySelector('[data-testid="flows-dashboard-error"]')).not.toBeNull();
    expect(container.textContent).toContain('workspace unavailable');

    const retry = container.querySelector<HTMLButtonElement>('.flows-dashboard-primary-action');
    expect(retry).not.toBeNull();
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    });

    expect(container.querySelector('[data-testid="flows-dashboard-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="flows-dashboard-empty"]')).not.toBeNull();
    expect(findFiles).toHaveBeenCalledTimes(4);
  });
});

function host() {
  return {
    workspacePath: '/repo',
    storage: { get: () => undefined },
    openFile: vi.fn(),
    close: vi.fn(),
  } as never;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}
