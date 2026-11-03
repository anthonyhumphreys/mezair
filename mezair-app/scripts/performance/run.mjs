// pnpm exec vite build --config scripts/performance/vite.config.mjs
// node scripts/performance/run.mjs docs/performance/journeys-after.json
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus, platform, release, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const profile = mkdtempSync(join(tmpdir(), 'mezair-perf-'));
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-popup-blocking',
    ...(process.env.PERF_RICH ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    '--remote-debugging-pipe',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,900',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const browserExited = new Promise((resolve) => browser.once('close', resolve));
let sequence = 0;
let buffer = '';
const pending = new Map();
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 60_000);
    pending.set(id, { resolve, reject, timeout });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}
browser.stdio[4].on('data', (data) => {
  buffer += data.toString();
  let delimiter;
  while ((delimiter = buffer.indexOf('\0')) !== -1) {
    const message = JSON.parse(buffer.slice(0, delimiter));
    buffer = buffer.slice(delimiter + 1);
    if (message.method === 'Runtime.exceptionThrown')
      console.error(
        'Renderer exception:',
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    const request = pending.get(message.id);
    if (!request) continue;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  }
});
browser.on('error', (error) => {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pending.clear();
});
const evaluate = async (sessionId, expression) => {
  const result = await command(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};

try {
  await new Promise((resolve, reject) => {
    browser.once('spawn', resolve);
    browser.once('error', reject);
  });
  const version = await command('Browser.getVersion');
  const variants = [
    {
      root: process.env.PERF_FIXTURE_ROOT ?? join(tmpdir(), 'mezair-performance-fixture'),
      output: process.argv[2],
      runs: [],
      current: true,
      checks: undefined,
    },
  ];
  if (process.env.PERF_COMPARE_ROOT)
    variants.push({
      root: process.env.PERF_COMPARE_ROOT,
      output: process.argv[3],
      runs: [],
      current: false,
      checks: undefined,
    });
  for (let run = 0; run < Number(process.env.PERF_RUNS ?? 5); run++) {
    for (const variant of run % 2 ? [...variants].reverse() : variants) {
      const { browserContextId } = await command('Target.createBrowserContext');
      const { targetId } = await command('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
      await command('Page.enable', {}, sessionId);
      await command('Runtime.enable', {}, sessionId);
      await command(
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
        sessionId,
      );
      await command(
        'Page.navigate',
        { url: pathToFileURL(resolve(variant.root, 'index.html')).href },
        sessionId,
      );
      // Poll only for module bootstrap, before any timed work begins.
      await evaluate(
        sessionId,
        `new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const check = () => typeof window.runPerformanceScenario === 'function' ? resolve(true)
        : Date.now() > deadline ? reject(new Error('Fixture did not load')) : setTimeout(check, 20);
      check();
    })`,
      );
      await command('HeapProfiler.collectGarbage', {}, sessionId);
      const idle = await command('Runtime.getHeapUsage', {}, sessionId);
      const metrics = await evaluate(
        sessionId,
        `window.runPerformanceScenario({turns:${Number(process.env.PERF_TURNS ?? 100)}})`,
      );
      await command('HeapProfiler.collectGarbage', {}, sessionId);
      const heap = await command('Runtime.getHeapUsage', {}, sessionId);
      variant.runs.push({
        ...metrics,
        retainedHeapBytes: heap.usedSize - idle.usedSize,
        totalHeapBytes: heap.usedSize,
      });
      if (process.env.PERF_SCREENSHOT && run === 0 && variant.current) {
        const screenshot = await command('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(process.env.PERF_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
      }
      if (process.env.PERF_CHECKS && run === 0 && variant.current) {
        await evaluate(sessionId, `window.__PERF_RICH__=${Boolean(process.env.PERF_RICH)}`);
        variant.checks = {
          chat: await evaluate(sessionId, 'window.checkTranscript()'),
          dashboard: await evaluate(sessionId, 'window.checkDashboard()'),
          advanced: await evaluate(sessionId, 'window.checkAdvanced()'),
        };
      }
      await command('Target.disposeBrowserContext', { browserContextId });
    }
  }
  for (const variant of variants) {
    const { runs, checks } = variant;
    const median = Object.fromEntries(
      Object.keys(runs[0]).map((key) => [
        key,
        runs.map((run) => run[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)],
      ]),
    );
    const result = {
      measuredAt: new Date().toISOString(),
      environment: {
        chrome: version.product,
        js: version.jsVersion,
        node: process.versions.node,
        platform: `${platform()} ${release()} ${arch()}`,
        cpu: cpus()[0].model,
      },
      scenarioTurns: Number(process.env.PERF_TURNS ?? 100),
      methodology:
        'Production Vite build; headless Chrome with background throttling disabled; five fresh browser contexts; forced GC before and after; synthetic 100-turn history with 30 operations per turn; 60 streamed updates; 200 composition updates; 20 scroll events in one frame. Renderer-only measurements, not whole Electron process memory or provider latency.',
      comparison:
        variants.length > 1
          ? 'Alternating before/after builds in the same browser session; order reversed every pair.'
          : undefined,
      median,
      runs,
      checks,
    };
    writeFileSync(resolve(variant.output), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ output: variant.output, ...median }, null, 2));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser.pid && browser.exitCode === null) {
    await Promise.race([
      command('Browser.close').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000).unref()),
    ]);
    await Promise.race([
      browserExited,
      new Promise((resolve) => setTimeout(resolve, 3000).unref()),
    ]);
    if (browser.exitCode === null) browser.kill();
  }
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error('Browser closed'));
  }
  pending.clear();
  await browserExited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
