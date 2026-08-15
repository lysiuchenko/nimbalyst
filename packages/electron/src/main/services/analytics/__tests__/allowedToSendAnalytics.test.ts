// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Fork build: telemetry is disabled at the AnalyticsService gate. These tests
// guard that override so an upstream rebase that restores the setting-read (or
// its fail-open branch) fails here instead of silently re-enabling capture.

const { isAnalyticsEnabledMock } = vi.hoisted(() => ({
  isAnalyticsEnabledMock: vi.fn(() => true),
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    on() {}
    capture() {}
    async shutdown() {}
  },
}));
vi.mock('electron-store', () => ({
  default: class {
    get() {
      return 'nimbalyst_test';
    }
    set() {}
  },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { analytics: { info() {}, warn() {}, error() {}, debug() {} } },
}));
vi.mock('../../../utils/store', () => ({
  isAnalyticsEnabled: isAnalyticsEnabledMock,
  setAnalyticsEnabled: vi.fn(),
}));

import { AnalyticsService } from '../AnalyticsService';

describe('AnalyticsService.allowedToSendAnalytics (fork: telemetry disabled)', () => {
  it('returns false even when the setting is enabled', () => {
    isAnalyticsEnabledMock.mockReturnValue(true);
    expect(AnalyticsService.getInstance().allowedToSendAnalytics()).toBe(false);
  });

  it('returns false without failing open when the setting read throws', () => {
    isAnalyticsEnabledMock.mockImplementation(() => {
      throw new Error('store gone');
    });
    expect(AnalyticsService.getInstance().allowedToSendAnalytics()).toBe(false);
  });
});
