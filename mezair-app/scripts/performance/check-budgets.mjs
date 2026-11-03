import { readFileSync } from 'node:fs';
const [beforeFile, afterFile, mode = 'renderer'] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforeFile, 'utf8')),
  after = JSON.parse(readFileSync(afterFile, 'utf8'));
const failures = [];
const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
function limit(name, value, maximum) {
  if (!Number.isFinite(value) || value > maximum) failures.push(`${name}: ${value} > ${maximum}`);
}
if (mode === 'bundle') {
  for (const key of Object.keys(before.journeys))
    limit(
      `${key} static JavaScript growth`,
      after.journeys[key].rawBytes,
      before.journeys[key].rawBytes * 1.02,
    );
} else if (mode === 'native') {
  if (!before.complete || !after.complete) failures.push('Native evidence is incomplete');
  limit(
    'cold first-run regression',
    median(after.launches.map((x) => x.launchToInteractiveMs)),
    median(before.launches.map((x) => x.launchToInteractiveMs)) * 1.2,
  );
  limit(
    'idle working set regression',
    median(after.launches.map((x) => x.idleRssBytes)),
    median(before.launches.map((x) => x.idleRssBytes)) * 1.15,
  );
  limit('sampled streaming process-tree RSS', after.sampledPeakRssBytes, 1.25 * 1024 ** 3);
  if (after.soakElapsedMs < 1800000)
    failures.push('Candidate streaming soak must last at least 30 minutes');
  const samples = after.samples.filter((x) => x.elapsedMs > 300000);
  const early = samples.slice(0, Math.max(1, Math.floor(samples.length / 4))),
    late = samples.slice(-Math.max(1, Math.floor(samples.length / 4)));
  limit(
    'retained working set growth after warmup',
    median(late.map((x) => x.rssBytes)) - median(early.map((x) => x.rssBytes)),
    128 * 1024 ** 2,
  );
} else {
  if (before.runs.length < 5 || after.runs.length < 5)
    failures.push('Five paired samples are required');
  for (const [key, ratio] of [
    ['mountMs', 1.15],
    ['streamP95Ms', 1.15],
    ['retainedHeapBytes', 1.1],
  ])
    limit(`${key} regression`, after.median[key], before.median[key] * ratio);
  limit('windowed transcript DOM', after.median.domElements, 2000);
  limit('scroll geometry reads per burst', after.median.turnRectReads, 30);
  if (!after.checks?.advanced?.passed?.length) failures.push('Advanced journey checks are missing');
}
console.log(
  JSON.stringify(
    { mode, before: beforeFile, after: afterFile, passed: failures.length === 0, failures },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
