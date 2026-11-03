# Desktop journey performance pass — 2–3 November 2026

Open [journeys.html](./journeys.html) for the report, measurements, limits and ten next steps.

## Evidence

- Baseline source: `ead4fe2a85ffb7b752cc61670adb4a7e8449600e`.
- `journeys-before.json` / `journeys-after.json`: five independent headless Chrome contexts per version, using a production build of the real chat transcript and scroll hook. Builds alternate in one browser session, reversing order every pair to control for machine load. The fixture contains 100 turns, 3,000 operations and 60 streamed answer updates. The composition batch contains another 200 updates. Raw runs and environment details are included.
- `bundles-before.json` / `bundles-after.json`: unique JavaScript bytes in each journey's production Vite static import closure. Settings includes its default appearance category. Dynamically imported tools are counted only when a journey requests them. Gzip is a size comparison, not Electron transfer traffic.
- The after-run also performs browser assertions for processing-detail expansion, scroll preservation, pinned following, thread replacement and dashboard request races. These run after heap capture and are listed in the JSON.

Measurements cover renderer work and retained JavaScript heap after forced GC. They do not measure full Electron RSS, native startup, provider token latency, network performance or field INP/LCP. The fixture has routine operations and Markdown, rather than rich surfaces, attachments or large diffs. Live accounts and repositories are not accessed. Absolute timings vary with hardware and load.

## Reproduce the renderer measurement

From `mezair-app/`, with its existing dependencies installed:

```sh
pnpm exec vite build --config scripts/performance/vite.config.mjs
PERF_CHECKS=1 node scripts/performance/run.mjs /tmp/mezair-journeys-after.json
node scripts/performance/bundle-metrics.mjs out/renderer /tmp/mezair-bundles-after.json
```

The runner defaults to macOS Google Chrome. Set `CHROME_PATH` to another installed Chromium executable on other platforms. It creates and removes a disposable browser profile, uses the DevTools pipe, and loads only the built local fixture. No local HTTP server or browser automation dependency is required. `PERF_SCREENSHOT=/tmp/mezair-chat.png` optionally saves the first measured view.

To compare with the unchanged source, keep the same fixture/runner and dependencies:

```sh
benchmark_baseline=$(mktemp -d /tmp/mezair-baseline.XXXXXX)
git -C .. archive ead4fe2a85ffb7b752cc61670adb4a7e8449600e \
  mezair-app/src mezair-app/package.json | tar -x -C "$benchmark_baseline"
mkdir -p "$benchmark_baseline/mezair-app/scripts"
cp -R scripts/performance "$benchmark_baseline/mezair-app/scripts/"
ln -s "$PWD/node_modules" "$benchmark_baseline/mezair-app/node_modules"
(cd "$benchmark_baseline/mezair-app" && pnpm exec vite build --config scripts/performance/vite.config.mjs)
node scripts/performance/run.mjs /tmp/mezair-journeys-before.json
```

The fixture intentionally falls back to the baseline's stateless composer when the incremental composer is absent. Run the two versions sequentially with other checks idle. The build output is `/tmp/mezair-performance-fixture`; building the second version replaces the first. The fixture build's missing-export warning on the baseline is expected because that version does not have `createChatTurnComposer`.

For the paired comparison used in the report, preserve each build in a separate directory before building the other, then run:

```sh
PERF_FIXTURE_ROOT=/tmp/mezair-performance-fixture-after \
PERF_COMPARE_ROOT=/tmp/mezair-performance-fixture-before \
PERF_CHECKS=1 node scripts/performance/run.mjs \
  /tmp/mezair-journeys-after.json /tmp/mezair-journeys-before.json
```

Bundle comparisons require complete production renderer builds of each revision. The recorded baseline was captured before source edits; the after build uses `pnpm exec electron-vite build`. Point `bundle-metrics.mjs` at each saved `out/renderer` directory. Renderer-only metrics do not require rebuilding Electron native modules.

## Verification

- Full desktop Vitest suite: 3,429 passed, 12 skipped in 376 files (372 passed, 4 skipped).
- Both `tsconfig.node.json` and `tsconfig.web.json` pass.
- `pnpm lint` and production Electron/Vite build pass.
- Focused tests cover immutable history changes, queued delivery, Undo guards, bounded fan-out, logarithmic anchor lookup, hidden polling and collapsed DOM allocation.
- Browser assertions exercise the real transcript and dashboard hook using synthetic data. They are not a full native Electron or live-provider end-to-end test.

The test suite needs permission to bind loopback sockets. Its initial sandboxed run failed on blocked local servers; the same suite passed with local sockets allowed.
