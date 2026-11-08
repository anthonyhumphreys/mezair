// Runs only synthetic component state; no user browser profile or repository is opened.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { connectCdp } from './performance/cdp.mjs';
const profile = mkdtempSync(join(tmpdir(), 'mezair-review-ui-'));
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--window-size=1280,900',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let spawnError;
browser.on('error', (error) => {
  spawnError = error;
});
const closed = new Promise((resolve) => browser.once('close', resolve));
let cdp;
try {
  const deadline = Date.now() + 30000;
  const portFile = join(profile, 'DevToolsActivePort');
  while (!existsSync(portFile)) {
    if (spawnError) throw spawnError;
    if (Date.now() > deadline) throw new Error('Synthetic review browser did not start');
    await wait(25);
  }
  const [port, endpoint] = readFileSync(portFile, 'utf8').trim().split('\n');
  cdp = await connectCdp(`ws://127.0.0.1:${port}${endpoint}`);
  const results = [];
  for (const width of [1280, 720]) {
    const { targetId } = await cdp.command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.command('Target.attachToTarget', { targetId, flatten: true });
    await cdp.command('Page.enable', {}, sessionId);
    await cdp.command('Runtime.enable', {}, sessionId);
    await cdp.command(
      'Emulation.setDeviceMetricsOverride',
      { width, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.command('Target.activateTarget', { targetId });
    let loadTimeout;
    let unsubscribe;
    const loaded = new Promise((resolve, reject) => {
      loadTimeout = setTimeout(() => reject(new Error('Review page did not load')), 30000);
      unsubscribe = cdp.onEvent((event) => {
        if (event.method === 'Page.loadEventFired' && event.sessionId === sessionId) resolve();
      });
    });
    try {
      await cdp.command(
        'Page.navigate',
        {
          url: pathToFileURL(
            resolve(
              process.env.REVIEW_FIXTURE_OUT ?? '/tmp/mezair-chat-review-fixture',
              'index.html',
            ),
          ).href,
        },
        sessionId,
      );
      await loaded;
    } finally {
      clearTimeout(loadTimeout);
      unsubscribe?.();
    }
    await cdp.evaluate(
      sessionId,
      `new Promise((resolve,reject)=>{const deadline=Date.now()+30000;const poll=()=>typeof window.checkReview==='function'?resolve(true):Date.now()>deadline?reject(new Error('Review fixture failed to load')):setTimeout(poll,25);poll()})`,
    );
    results.push({ width, ...(await cdp.evaluate(sessionId, 'window.checkReview()')) });
    await cdp.command('Target.closeTarget', { targetId });
  }
  console.log(JSON.stringify({ viewports: results }));
} finally {
  cdp?.close();
  browser.kill('SIGTERM');
  await Promise.race([closed, wait(3000, undefined, { ref: false })]);
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGKILL');
    await closed;
  }
  // Chrome helpers can finish writing after the browser process exits.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
