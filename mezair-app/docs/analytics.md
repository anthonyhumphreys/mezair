# Optional anonymous analytics

Mezair uses PostHog for opt-in usage statistics. Sentry crash reporting retains
its own consent. Migration 118 adds `usage_statistics_enabled` with a default of
zero, including for users who already enabled crash reporting. This preference
is local to the device and is not synced.

Set `MEZAIR_POSTHOG_PROJECT_TOKEN` and `MEZAIR_POSTHOG_HOST` in `.env` before
building Desktop. Electron Vite embeds these two public configuration values in
the main bundle. Release workflows read the equivalent GitHub Actions variables;
use environment-level overrides for separate staging and production projects.
Use the public ingestion token, never a personal API key. Missing configuration
or an unpackaged development build disables collection.

The user enables statistics under **Settings → Privacy → Help improve Mezair**.
Changes apply immediately. Disabling aborts delivery and drops queued events;
normal exit allows a bounded flush. The SDK runs only in the main process.

Every event has `surface=desktop`, `app_version`, `platform`, `arch`, and
`$process_person_profile=false`. GeoIP, exception capture and feature flag polling
are disabled. Each app launch or renewed consent gets a new random ID that is
never persisted or connected to a user account. Count runs and events, not unique
installations, retention, successful installations, or developer productivity.

| Event | Trigger |
| --- | --- |
| `app_opened` | Consented packaged app startup or enabling statistics |
| `onboarding_started` | Local onboarding starts |
| `onboarding_step_completed` | Local onboarding step completes |
| `chat_composer_enabled` | Composer becomes available |
| `chat_blocked_shown` | A blocked chat state appears |
| `change_summary_viewed` | First locally recorded view of a turn summary |
| `change_applied` | Existing activation flow records applied changes |
| `pull_request_opened` | Existing activation flow records PR creation |
| `repo_index_tier_reached` | Repository indexing reaches a tier |
| `repo_enrich_completed` | Repository enrichment completes |

Only these fixed names are forwarded after local metrics accept an event. Local
payloads, repository/workspace/thread/turn IDs, run/journey IDs, prompts, content,
paths, URLs, credentials, and account details are never forwarded. Existing rows
are never replayed. The local activation report continues to work without consent.

The website uses the same project with `surface=website`, separate browser consent,
and public page/download events. Filter by `surface` when building PostHog insights.

Verification from `mezair-app/`:

```sh
pnpm test -- src/main/services/__tests__/usage-statistics.service.test.ts src/main/services/__tests__/usage-statistics-wire.test.ts src/main/services/__tests__/telemetry.service.test.ts src/main/services/__tests__/metrics.service.test.ts src/main/db/__tests__/schema.test.ts
pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec tsc --noEmit -p tsconfig.web.json
pnpm lint
pnpm build
```
