import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export interface ReviewedGitOptions {
  timeoutMs: number;
  idleTimeoutMs?: number;
  label?: string;
}

async function waitForProcessGroup(pid: number): Promise<void> {
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    // Reparented zombies have exited and cannot write files, but still retain a group ID.
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('ps', ['-axo', 'pgid=,stat='], {
        encoding: 'utf8',
        timeout: 2000,
      }));
    } catch {
      // Keep ownership when the OS cannot confirm descendant termination.
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    const live = stdout.split('\n').some((line) => {
      const [group, state] = line.trim().split(/\s+/);
      return Number(group) === pid && state && !state.startsWith('Z');
    });
    if (!live) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Bounds filters and waits for killed writers before their caller releases its lease. */
export function runReviewedGit(
  repoPath: string,
  args: string[],
  options: number | ReviewedGitOptions = 30_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const {
    timeoutMs,
    idleTimeoutMs,
    label = 'Git review',
  } = typeof options === 'number' ? { timeoutMs: options } : options;
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '',
      stderr = '',
      stdoutBytes = 0,
      settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = async () => {
      if (process.platform === 'win32' && child.pid) {
        await new Promise<void>((done) => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          const fallback = setTimeout(() => {
            child.kill('SIGKILL');
            killer.kill('SIGKILL');
            done();
          }, 3000);
          const finish = () => {
            clearTimeout(fallback);
            done();
          };
          killer.once('error', () => {
            child.kill('SIGKILL');
            finish();
          });
          killer.once('close', (code) => {
            if (code !== 0) child.kill('SIGKILL');
            finish();
          });
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
      await closed;
      if (process.platform !== 'win32' && child.pid) await waitForProcessGroup(child.pid);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      void stop().then(() => reject(error), reject);
    };
    const activity = () => {
      if (!idleTimeoutMs || settled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () =>
          fail(
            new Error(
              `${label} stopped after no progress. Retry when the connection is available.`,
            ),
          ),
        idleTimeoutMs,
      );
    };
    const timer = setTimeout(
      () => fail(new Error(`${label} timed out. Refresh and try again.`)),
      timeoutMs,
    );
    activity();
    child.stdout.on('data', (data: string) => {
      if (settled) return;
      activity();
      stdoutBytes += Buffer.byteLength(data);
      stdout += data;
      if (stdoutBytes > 32 * 1024 * 1024) fail(new Error('This output is too large to review.'));
    });
    child.stderr.on('data', (data: string) => {
      if (settled) return;
      activity();
      stderr = (stderr + data).slice(-8192);
    });
    child.once('error', fail);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      if (code !== 0 && code !== 1) reject(new Error(stderr.trim() || `${label} failed.`));
      else resolve({ stdout, stderr, code });
    });
  });
}
