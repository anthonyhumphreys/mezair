import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { acquireCheckpointPaths, canonicalCheckpointPath } from './chat-checkpoint-locks.js';

const workers = new Map<string, string[]>();
/** Register before asynchronous worker startup; concurrent workers may share a checkout. */
export function registerManagedWorkerPaths(paths: string[]): () => void {
  const release = acquireCheckpointPaths(paths);
  const key = randomUUID();
  try {
    workers.set(key, [...new Set(paths.map(canonicalCheckpointPath))]);
  } finally {
    release();
  }
  return () => workers.delete(key);
}
export function assertNoManagedWorkerWrites(paths: string[]): void {
  const roots = paths.map(canonicalCheckpointPath);
  if (
    [...workers.values()]
      .flat()
      .some((worker) =>
        roots.some(
          (root) =>
            worker === root ||
            worker.startsWith(`${root}${path.sep}`) ||
            root.startsWith(`${worker}${path.sep}`),
        ),
      )
  )
    throw new Error('Wait for delegated workers in this checkout before changing its files.');
}

/** Turn completion may precede native process shutdown; retain its paths through close. */
export function retainManagedWorkerProcess(proc: ChildProcess, paths: string[]): void {
  if (!proc.pid) return;
  const release = registerManagedWorkerPaths(paths);
  proc.once('close', release);
}
