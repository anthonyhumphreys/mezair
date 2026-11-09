import { spawn } from 'node:child_process';

/** Bound filters as well as Git itself; a filter must not retain a checkout lease. */
export function runReviewedGit(
  repoPath: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    const stop = (): Promise<void> => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        return new Promise((resolve) => {
          const fallback = setTimeout(() => {
            child.kill('SIGKILL');
            killer.kill('SIGKILL');
            resolve();
          }, 3000);
          const finished = () => {
            clearTimeout(fallback);
            resolve();
          };
          killer.once('error', () => {
            child.kill('SIGKILL');
            finished();
          });
          killer.once('close', (code) => {
            if (code !== 0) child.kill('SIGKILL');
            finished();
          });
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
      return Promise.resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void stop().then(() => reject(error));
    };
    const timer = setTimeout(
      () => fail(new Error('Git review timed out. Refresh and try again.')),
      timeoutMs,
    );
    child.stdout.on('data', (data: string) => {
      stdout += data;
      stdoutBytes += Buffer.byteLength(data);
      if (stdoutBytes > 32 * 1024 * 1024) fail(new Error('This diff is too large to review.'));
    });
    child.stderr.on('data', (data: string) => {
      stderr = (stderr + data).slice(-8192);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && code !== 1) reject(new Error(stderr.trim() || 'Git review failed.'));
      else resolve({ stdout, code });
    });
  });
}
