import { randomUUID } from 'node:crypto';
import { PostHog } from 'posthog-node';

// Only event names cross this boundary. Local metric payloads and identifiers
// must never be passed to PostHog.
const EVENTS = new Set([
  'app_opened',
  'onboarding_started',
  'onboarding_step_completed',
  'chat_composer_enabled',
  'chat_blocked_shown',
  'change_summary_viewed',
  'change_applied',
  'pull_request_opened',
  'repo_index_tier_reached',
  'repo_enrich_completed',
]);

interface UsageStatisticsOptions {
  enabled: boolean;
  packaged: boolean;
  version: string;
  token?: string;
  host?: string;
}

let options: UsageStatisticsOptions | undefined;
let client: PostHog | undefined;
let runId: string | undefined;
let controller: AbortController | undefined;

export function initializeUsageStatistics(input: UsageStatisticsOptions): void {
  options = input;
  setUsageStatisticsEnabled(input.enabled);
}

export function setUsageStatisticsEnabled(enabled: boolean): void {
  if (options) options.enabled = enabled;
  if (!enabled) {
    // Abort in-flight delivery and discard queued events instead of flushing
    // them after consent has been withdrawn.
    controller?.abort();
    client?.optOut();
    void client?.shutdown(0).catch(() => {});
    client = undefined;
    controller = undefined;
    runId = undefined;
    return;
  }
  if (client || !options?.packaged || !options.token || !options.host) return;
  try {
    controller = new AbortController();
    const signal = controller.signal;
    client = new PostHog(options.token, {
      host: options.host,
      disableGeoip: true,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      featureFlagsPollingInterval: null,
      isServer: false,
      flushAt: 10,
      flushInterval: 10_000,
      fetchRetryCount: 0,
      requestTimeout: 5_000,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
        }),
    });
    client.on('error', () => {});
    runId = randomUUID();
    captureUsageStatistic('app_opened');
  } catch {
    client = undefined;
    runId = undefined;
  }
}

export function captureUsageStatistic(event: string): void {
  if (!options?.enabled || !client || !runId || !EVENTS.has(event)) return;
  try {
    client.capture({
      distinctId: runId,
      event,
      properties: {
        surface: 'desktop',
        app_version: options.version,
        platform: process.platform,
        arch: process.arch,
        $process_person_profile: false,
      },
    });
  } catch {
    // Optional measurement must never interrupt the app.
  }
}

export async function shutdownUsageStatistics(): Promise<void> {
  const current = client;
  client = undefined;
  runId = undefined;
  await current?.shutdown(1_500).catch(() => {});
}
