import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

export class EmptyLlmResponseError extends Error {}

/** Bounded output and process-tree cleanup shared by one-shot CLI providers. */
export function runUtilityCli(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    prompt?: string;
    signal?: AbortSignal;
    outputPath?: string;
    outputLimit?: number;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
    });
    const limit = options.outputLimit ?? 2_000_000;
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
      } catch {
        /* already exited */
      }
    };
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value!);
    };
    const stop = (error: Error) => {
      if (failure || settled) return;
      failure = error;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 2000);
      forceTimer = setTimeout(() => finish(failure), 7000);
      killTimer.unref();
      forceTimer.unref();
    };
    const abort = () => stop(options.signal?.reason ?? new Error('Request cancelled.'));
    const timeout = setTimeout(() => stop(new Error('AI request timed out. Try again.')), 300_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      if (stdout.length + chunk.length > limit)
        stop(new Error('AI response exceeded its output limit.'));
      else stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (failure) {
        kill('SIGKILL');
        finish(failure);
        return;
      }
      if (code !== 0) {
        finish(new Error(`${command} failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      try {
        let output = '';
        if (options.outputPath && existsSync(options.outputPath)) {
          if (statSync(options.outputPath).size > limit)
            throw new Error('AI response exceeded its output limit.');
          output = readFileSync(options.outputPath, 'utf8').trim();
        }
        const result = output || stdout.trim();
        if (!result) throw new EmptyLlmResponseError(`${command} returned an empty response`);
        finish(undefined, result);
      } catch (error) {
        finish(error as Error);
      }
    });
    // A provider may exit before reading stdin; the close event carries its error.
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.prompt);
  });
}
