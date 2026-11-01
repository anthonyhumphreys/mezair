import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import {
  captureUsageStatistic,
  initializeUsageStatistics,
  setUsageStatisticsEnabled,
  shutdownUsageStatistics,
} from '../usage-statistics.service.js';

afterEach(async () => {
  setUsageStatisticsEnabled(false);
  await shutdownUsageStatistics();
  vi.restoreAllMocks();
});

describe('PostHog statistics transport', () => {
  it('flushes only anonymous events through the real SDK', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"status":1}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    initializeUsageStatistics({
      enabled: true,
      packaged: true,
      version: '0.7.5',
      token: 'test-public-token',
      host: 'https://analytics.invalid',
    });
    captureUsageStatistic('change_applied');
    captureUsageStatistic('private-repository-name');
    await shutdownUsageStatistics();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://analytics.invalid/batch/');
    const bytes = Buffer.from(await new Response(request?.body).arrayBuffer());
    const body = bytes[0] === 0x1f ? gunzipSync(bytes).toString() : bytes.toString();
    const payload = JSON.parse(body) as {
      batch: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }>;
    };
    expect(payload.batch.map((event) => event.event)).toEqual(['app_opened', 'change_applied']);
    expect(new Set(payload.batch.map((event) => event.distinct_id)).size).toBe(1);
    for (const event of payload.batch) {
      expect(event.properties).toMatchObject({
        surface: 'desktop',
        app_version: '0.7.5',
        platform: process.platform,
        arch: process.arch,
        $process_person_profile: false,
        $geoip_disable: true,
      });
      expect(Object.keys(event.properties).sort()).toEqual(
        [
          '$geoip_disable',
          '$lib',
          '$lib_version',
          '$process_person_profile',
          'app_version',
          'arch',
          'platform',
          'surface',
        ].sort(),
      );
    }
  });

  it('never delivers queued events after withdrawal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    initializeUsageStatistics({
      enabled: true,
      packaged: true,
      version: '0.7.5',
      token: 'test-public-token',
      host: 'https://analytics.invalid',
    });
    captureUsageStatistic('change_applied');
    setUsageStatisticsEnabled(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
