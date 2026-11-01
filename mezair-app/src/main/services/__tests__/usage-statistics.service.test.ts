import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = {
    capture: vi.fn(),
    optOut: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  return {
    client,
    construct: vi.fn(function (
      _token: string,
      _options: ConstructorParameters<typeof import('posthog-node').PostHog>[1],
    ) {
      return client;
    }),
  };
});
vi.mock('posthog-node', () => ({ PostHog: mocks.construct }));

import {
  captureUsageStatistic,
  initializeUsageStatistics,
  setUsageStatisticsEnabled,
  shutdownUsageStatistics,
} from '../usage-statistics.service.js';

const config = {
  enabled: true,
  packaged: true,
  version: '0.7.5',
  token: 'test-token',
  host: 'https://eu.i.posthog.com',
};

describe('anonymous usage statistics', () => {
  beforeEach(() => {
    setUsageStatisticsEnabled(false);
    vi.clearAllMocks();
  });

  it.each([{ enabled: false }, { packaged: false }, { token: '' }, { host: '' }])(
    'does not create a client or send events when unavailable: %o',
    (override) => {
      initializeUsageStatistics({ ...config, ...override });
      captureUsageStatistic('change_applied');
      expect(mocks.construct).not.toHaveBeenCalled();
      expect(mocks.client.capture).not.toHaveBeenCalled();
    },
  );

  it('sends only fixed names and content-free platform properties', () => {
    initializeUsageStatistics({ ...config });
    captureUsageStatistic('change_applied');
    captureUsageStatistic('private/repository-name');
    expect(mocks.client.capture).toHaveBeenCalledTimes(2);
    const event = mocks.client.capture.mock.calls[1][0];
    expect(event).toEqual({
      distinctId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      event: 'change_applied',
      properties: {
        surface: 'desktop',
        app_version: '0.7.5',
        platform: process.platform,
        arch: process.arch,
        $process_person_profile: false,
      },
    });
    expect(mocks.construct).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        disableGeoip: true,
        enableExceptionAutocapture: false,
        enableLocalEvaluation: false,
      }),
    );
  });

  it('stops immediately on opt-out and rotates identity on renewed consent', async () => {
    initializeUsageStatistics({ ...config });
    const firstId = mocks.client.capture.mock.calls[0][0].distinctId;
    const customFetch = mocks.construct.mock.calls[0][1]!.fetch!;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    await customFetch('https://example.invalid', { method: 'POST', headers: {} });
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    setUsageStatisticsEnabled(false);
    expect(signal?.aborted).toBe(true);
    captureUsageStatistic('change_applied');
    expect(mocks.client.capture).toHaveBeenCalledTimes(1);
    expect(mocks.client.optOut).toHaveBeenCalledOnce();
    expect(mocks.client.shutdown).toHaveBeenCalledWith(0);
    setUsageStatisticsEnabled(true);
    expect(mocks.client.capture.mock.calls[1][0].distinctId).not.toBe(firstId);
    fetchMock.mockRestore();
    await shutdownUsageStatistics();
    expect(mocks.client.shutdown).toHaveBeenLastCalledWith(1500);
  });

  it('does not let analytics failures interrupt feature use', () => {
    initializeUsageStatistics({ ...config });
    mocks.client.capture.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    expect(() => captureUsageStatistic('change_applied')).not.toThrow();
  });
});
