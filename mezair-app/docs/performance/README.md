# Desktop journey performance — 3 November 2026

Open [followup.html](./followup.html) for the current report and all ten follow-ups. [journeys.html](./journeys.html) preserves the original 100-turn pass and its measurements.

## Source and evidence

- Original reference: `ead4fe2a85ffb7b752cc61670adb4a7e8449600e`.
- Follow-up reference: first-pass commit `258009240b2322049a37658e4393bc8dd1a5aaf6`.
- Final local renderer fixture: `b3dfb42cd219f0ad0adb7488c45c035d464a95e9`. Ubuntu evidence: `2991f4e4dd1c07a7d3db4e5aa5bd4fd5383cdf3e`.
- macOS package: `a3b205f1a627383d103e5cc92521da6228b94e02`. Windows package: PR merge `38f1ca751a55fba06927528b8c63827160955502` for `2991f4e4`. Both captures precede the final failure/recovery fixes in `b3dfb42c`; final browser and regression checks cover those fixes. Exact native sources are retained in each JSON file.
- [Performance Actions run](https://github.com/anthonyhumphreys/mezair/actions/runs/41648903569), [desktop checks](https://github.com/anthonyhumphreys/mezair/actions/runs/41648903567), [PR #100](https://github.com/anthonyhumphreys/mezair/pull/100).

| Files                                                          | Scope                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `followup-before.json`, `followup-after.json`                  | Five alternating production-renderer pairs on Apple M3: 1,000 turns, 30,000 operations, 60 streamed updates and 200 composition updates. |
| `ci-before.json`, `ci-after.json`                              | The same paired scenario on Ubuntu 24.04, including richer ownership checks.                                                             |
| `rich-checks.json`                                             | State-channel renders, real tool imports, Mermaid, images, diffs, pop-outs and software WebGL cleanup.                                   |
| `followup-bundles.json`, `ci-bundles-*.json`                   | Unique JavaScript bytes in each journey's static production import closure. Dynamic tools/worker grammars are excluded until requested.  |
| `data-reads.json`                                              | Five alternating service reads against synthetic SQLite data: 32,000 messages and 5,000 factory runs.                                    |
| `native-macos-*.json`, `native-windows-*.json`                 | Three fresh-profile packaged launches per revision, 15-second idle samples and the candidate's 30-minute continuous streaming soak.      |
| `journeys-*.json`, `bundles-before.json`, `bundles-after.json` | Historical first-pass evidence; a separate 100-turn workload.                                                                            |

The local 1,000-turn comparison reduces mount from 575.1 to 36.5 ms, streamed P95 from 5.9 to 4.7 ms, retained renderer heap from 68.0 to 11.8 MiB, and DOM elements from 57,021 to 717. Initial JavaScript grows 1.09% against the first pass for isolated state channels and recoverable imports; it remains 31.0% below the original reference. Each journey passes the 2% follow-up bundle budget.

Renderer heap is measured after forced GC and excludes Electron main/GPU/native memory. Native working-set/RSS sums may count shared pages more than once. Service JSON bytes estimate IPC payload, without measuring Electron transport; heap is sampled after reading/encoding, rather than continuously traced. The native soak uses 100 turns; the separate renderer comparison uses 1,000. No customer data, live provider call or production deployment is involved.

The CI artifact runner's historical methodology sentence says “100-turn”; `scenarioTurns` and each raw run's `turns` field record the actual parameter, 1,000 in the follow-up evidence. The final local runner now records the parameter directly. The original results remain separate.

## Reproduce paired rendering and bundles

Run from `mezair-app/`, with dependencies installed. For a fresh install, first run `node .github/scripts/prepare-desktop-clis.mjs` from the monorepo root, then `pnpm install` inside `mezair-app/`.

```sh
performance_baseline=$(mktemp -d /tmp/mezair-perf-baseline.XXXXXX)
node scripts/performance/prepare-baseline.mjs \
  258009240b2322049a37658e4393bc8dd1a5aaf6 "$performance_baseline"
PERF_OUT_DIR=/tmp/mezair-perf-before pnpm --dir "$performance_baseline/mezair-app" \
  exec vite build --config scripts/performance/vite.config.mjs
PERF_OUT_DIR=/tmp/mezair-perf-after pnpm exec vite build \
  --config scripts/performance/vite.config.mjs
PERF_FIXTURE_ROOT=/tmp/mezair-perf-after \
PERF_COMPARE_ROOT=/tmp/mezair-perf-before \
PERF_TURNS=1000 PERF_CHECKS=1 PERF_RICH=1 \
  node scripts/performance/run.mjs /tmp/mezair-after.json /tmp/mezair-before.json
node scripts/performance/check-budgets.mjs \
  /tmp/mezair-before.json /tmp/mezair-after.json renderer

pnpm --dir "$performance_baseline/mezair-app" exec electron-vite build
node scripts/performance/bundle-metrics.mjs \
  "$performance_baseline/mezair-app/out/renderer" /tmp/mezair-bundles-before.json
pnpm exec electron-vite build
node scripts/performance/bundle-metrics.mjs out/renderer /tmp/mezair-bundles-after.json
node scripts/performance/check-budgets.mjs \
  /tmp/mezair-bundles-before.json /tmp/mezair-bundles-after.json bundle
```

The reference must exist in the local Git object database. The helper copies the same fixture and uses the candidate toolchain, removing candidate-only checks from old source. It aligns local CLI dependency names by their unchanged `file:` paths when a package scope changes; application source and the reference version stay intact. Set `CHROME_PATH` outside macOS. The runner uses a disposable profile and local files through the DevTools pipe, without a local server. `PERF_RICH=1` enables software WebGL and pop-outs only in this test browser. `PERF_SCREENSHOT=/tmp/mezair-chat.png` saves the measured view.

Five pairs alternate order in one browser session. Raw samples and environment details are retained. Keep other checks idle during timing comparisons. Gzip is a size indicator, rather than Electron traffic or runtime memory.

## Reproduce data reads and native profiles

```sh
pnpm run rebuild:native:node
pnpm exec vitest run --config scripts/performance/data-reads.vitest.config.mjs
```

This writes `docs/performance/data-reads.json`. It includes SQLite, mapping and JSON encoding against an in-memory database. History pages contain 200 messages; factory pages contain 50 runs; summary counts avoid receipt hydration. Hosted pagination is tested separately with recipient encryption and access checks.

Build unsigned directory packages and renderer fixtures for both revisions, as in `.github/workflows/app-performance.yml`. Then run:

```sh
PERF_SOURCE_SHA=258009240b2322049a37658e4393bc8dd1a5aaf6 \
  node scripts/performance/native-profile.mjs \
  /absolute/path/to/reference/Mezair.app/Contents/MacOS/Mezair \
  /tmp/mezair-perf-before /tmp/native-before.json 0
PERF_SOURCE_SHA=$(git rev-parse HEAD) \
  node scripts/performance/native-profile.mjs \
  /absolute/path/to/candidate/Mezair.app/Contents/MacOS/Mezair \
  /tmp/mezair-perf-after /tmp/native-after.json 1800
node scripts/performance/check-budgets.mjs \
  /tmp/native-before.json /tmp/native-after.json native
```

On Windows pass `win-unpacked/Mezair.exe`. The profiler creates isolated profiles, waits for production welcome controls and two real animation frames, samples idle memory 15 seconds later, verifies worker highlighting, and streams for at least 30 minutes. “Cold” means a new process/profile, without clearing OS file caches or rebooting. Five-second process-tree samples provide a sampled peak, without forced GC.

The memory workload uses profiling-only throttling overrides, display-sleep prevention and 16 ms timer-paced animation callbacks so display sleep cannot stall it. Normal-frame renderer latency is measured separately. The profiler cleans up its own profiles, connections and processes. Packaging rebuilds dependencies for Electron; run `pnpm run rebuild:native:node` before Node tests. Do not run packaging and database tests concurrently.

## Verification and budgets

- 4 November scroll-to-latest regression: the turn list and delegated-work panel shared the active thread ID as their sibling React key. Re-rendering a saved conversation could retain an orphaned list and inflate the scrollable height. Distinct `turns:` and `delegations:` keys prevent that collision. The transcript also disables native edge bounce and skips bottom-position writes when already within one pixel of the bottom. Browser checks now re-render a saved 1,000-turn chat and a short settled chat 30 times each, asserting exactly one list, a stable latest-message position, zero redundant scroll writes, and continued following when the response grows. The same check fails against released commit `894f4902236692f02f1cdff302f40906c9c91903` because it mounts a duplicate list.
- Desktop: 3,453 tests passed, 12 skipped; both TypeScript projects, lint, production build and desktop CI pass.
- Hosted factory tests: 19 passed, including cursor ties, bounds and access revocation; backend TypeScript passes locally.
- Browser checks cover virtualized anchors, focus/selection, loaded search, disclosure persistence, Markdown, highlighting, dashboard races and resource ownership. A settings-editor probe uses production chat channels; this is not a full Settings-route test. Intent timings cover module readiness, rather than PTY first-frame latency. Software WebGL verifies context release, rather than native GPU memory.
- Follow-up on 4 November: all 508 backend tests pass. The enrollment failure came from a shared test Durable Object retaining a cooldown timestamp when the next fixture rewound its fake clock. Each independent hosted-identity fixture now clears that test timestamp once; attempts within the fixture still exercise the real provider throttle and device-cap enforcement. Production authentication and rate limits are unchanged.
- Renderer gates: at most 2% bundle, 10% retained-heap and 15% mount/P95 growth; at most 2,000 DOM elements and 30 geometry reads.
- Native gates: startup median at most 1.20× reference, idle memory at most 1.15×, sampled peak at most 1.25 GiB, and late-quarter versus early-quarter median growth at most 128 MiB after minute five. Welcome targets are 3 seconds on Apple M3 and 8 seconds on the Windows CI VM.

Both native soaks completed and pass the strengthened gate: macOS 30.02 minutes / 1,279 cycles / 598.6 MiB sampled peak; Windows 30.02 minutes / 1,298 cycles / 547.3 MiB. Neither records renderer errors. Idle process-tree memory is 2.2% higher on macOS and 1.2% higher on Windows, within the 15% allowance; renderer memory is the measured improvement.

CI pins Node 22.16.0 and OS labels `ubuntu-24.04` / `windows-2022`; Electron is frozen by the lockfile. Hosted images and Chrome patches can update; paired measurements share one runner/browser and capture actual versions. Integration tests require loopback socket access.
