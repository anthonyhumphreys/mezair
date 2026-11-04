// node scripts/performance/native-profile.mjs APP_EXECUTABLE FIXTURE_DIRECTORY OUTPUT_JSON [SOAK_SECONDS=1800]
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectCdp } from './cdp.mjs';

const exec = promisify(execFile);
const [executable, fixture, output, seconds = '1800'] = process.argv.slice(2);
if (!executable || !fixture || !output)
  throw new Error('Pass app executable, built fixture directory and output JSON.');
const durationMs = Number(seconds) * 1000;
if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('Invalid soak duration.');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = {
  source: process.env.PERF_SOURCE_SHA ?? null,
  measuredAt: new Date().toISOString(),
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0].model },
  methodology:
    'Unsigned packaged app, isolated fresh profile for each of three launches. Launch-to-interactive waits for the production welcome heading, role controls and two animation frames. Idle RSS is sampled 15 seconds later. Profiling disables background throttling through the main-process inspector so screen sleep/occlusion cannot stall animation-frame samples. Sum of OS working sets/RSS for the app process tree (shared pages can count more than once). Five-second sampled peak, no forced GC. A profiling-only display-sleep blocker and 16-ms timer-paced animation callbacks keep the memory soak running independently of display vsync; renderer latency is measured separately with native animation frames. Main process remains running during a synthetic production-renderer stream; no model/provider is invoked.',
  launches: [],
  samples: [],
  complete: false,
};
const save = () => writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');

async function memory(rootPid) {
  if (process.platform === 'win32') {
    const script = `$all=Get-CimInstance Win32_Process; $ids=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${rootPid}); do {$added=$false; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$added=$true}}}while($added); $sum=0; $count=0; foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p){$sum+=$p.WorkingSet64;$count++}}; @{rssBytes=$sum;processes=$count}|ConvertTo-Json -Compress`;
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    return JSON.parse(stdout);
  }
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss=']);
  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([rootPid]);
  let added;
  do {
    added = false;
    for (const [pid, parent] of rows)
      if (ids.has(parent) && !ids.has(pid)) {
        ids.add(pid);
        added = true;
      }
  } while (added);
  const owned = rows.filter(([pid]) => ids.has(pid));
  return { rssBytes: owned.reduce((sum, row) => sum + row[2] * 1024, 0), processes: owned.length };
}

for (let launch = 0; launch < 3; launch++) {
  const profile = mkdtempSync(join(tmpdir(), 'mezair-native-perf-'));
  const env = { ...process.env, MEZAIR_DEV_USER_DATA_PATH: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const start = performance.now();
  const child = spawn(
    resolve(executable),
    [
      '--no-sandbox',
      '--inspect=127.0.0.1:0',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    { env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let cdp;
  let mainCdp;
  try {
    const endpoints = await new Promise((resolve, reject) => {
      let log = '';
      const timeout = setTimeout(
        () => reject(new Error('Native app did not expose its local debugging endpoint.')),
        60_000,
      );
      child.once('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Native app exited before profiling (${code}).`));
      });
      child.stderr.on('data', (data) => {
        log = (log + data.toString()).slice(-16_000);
        const endpoint = log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
        const main = log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
        if (endpoint && main) {
          clearTimeout(timeout);
          resolve({ renderer: endpoint, main });
        }
      });
    });
    cdp = await connectCdp(endpoints.renderer);
    mainCdp = await connectCdp(endpoints.main);
    await mainCdp.evaluate(
      undefined,
      `new Promise((resolve, reject) => {
      const electron = process.mainModule.require('electron');
      const deadline = Date.now() + 60000;
      const check = () => {
        const windows = electron.BrowserWindow.getAllWindows();
        if (windows.length) { electron.powerSaveBlocker.start('prevent-display-sleep'); windows.forEach((window) => window.webContents.setBackgroundThrottling(false)); resolve(true); }
        else if (Date.now() > deadline) reject(new Error('Native window was not created'));
        else setTimeout(check, 25);
      };
      electron.app.whenReady().then(check);
    })`,
    );
    const coldWindowAvailableMs = performance.now() - start;
    cdp.onEvent((event) => {
      if (
        event.method === 'Runtime.exceptionThrown' ||
        event.method === 'Inspector.targetCrashed'
      ) {
        report.rendererErrors ??= [];
        report.rendererErrors.push(event.params);
        save();
      }
    });
    const deadline = performance.now() + 60_000;
    let target;
    while (!target && performance.now() < deadline) {
      const targets = await cdp.command('Target.getTargets');
      target = targets.targetInfos.find(
        (item) => item.type === 'page' && item.url.includes('index.html'),
      );
      if (!target) await delay(25);
    }
    if (!target) throw new Error('Production renderer did not open.');
    const { sessionId } = await cdp.command('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await cdp.command('Runtime.enable', {}, sessionId);
    await cdp.evaluate(
      sessionId,
      `new Promise((resolve, reject) => {
      const deadline=Date.now()+60000;
      const check=()=>document.querySelector('h1')?.textContent?.includes('Welcome to') && document.querySelector('button') ? requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))
        : Date.now()>deadline ? reject(new Error('First-run UI did not become interactive')) : setTimeout(check,25);
      check();
    })`,
    );
    const launchToInteractiveMs = performance.now() - start;
    await delay(15000);
    const idle = await memory(child.pid);
    report.launches.push({
      coldWindowAvailableMs,
      launchToInteractiveMs,
      idleRssBytes: idle.rssBytes,
      processes: idle.processes,
    });
    save();
    if (launch === 2 && durationMs > 0) {
      await cdp.command('Page.enable', {}, sessionId);
      await cdp.command(
        'Page.navigate',
        { url: pathToFileURL(resolve(fixture, 'index.html')).href },
        sessionId,
      );
      await cdp.evaluate(
        sessionId,
        `new Promise((resolve,reject)=>{const deadline=Date.now()+30000;const check=()=>typeof window.runPerformanceScenario==='function'?resolve(true):Date.now()>deadline?reject(new Error('Stream fixture did not load')):setTimeout(check,25);check()})`,
      );
      // Memory soak uses timer-paced frames, independent of display vsync or screen lock.
      // Cold startup above still uses native animation frames.
      await cdp.evaluate(
        sessionId,
        `(() => {
        window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
        window.cancelAnimationFrame = (id) => clearTimeout(id);
      })()`,
      );
      report.highlightCheck = await cdp.evaluate(sessionId, 'window.checkNativeHighlight()');
      save();
      const soakStart = performance.now();
      let nextSample = 0;
      let cycles = 0;
      while (performance.now() - soakStart < durationMs) {
        await cdp.evaluate(sessionId, 'window.runPerformanceScenario()');
        cycles++;
        const elapsedMs = performance.now() - soakStart;
        if (elapsedMs >= nextSample) {
          report.samples.push({ elapsedMs, cycles, ...(await memory(child.pid)) });
          nextSample = elapsedMs + 5000;
          save();
        }
      }
      report.soakElapsedMs = performance.now() - soakStart;
      report.streamCycles = cycles;
    }
  } catch (error) {
    report.error = String(error);
    save();
    throw error;
  } finally {
    cdp?.close();
    mainCdp?.close();
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
report.complete = true;
report.sampledPeakRssBytes = Math.max(0, ...report.samples.map((sample) => sample.rssBytes));
save();
console.log(
  JSON.stringify({
    complete: report.complete,
    launches: report.launches,
    soakElapsedMs: report.soakElapsedMs,
    sampledPeakRssBytes: report.sampledPeakRssBytes,
  }),
);
