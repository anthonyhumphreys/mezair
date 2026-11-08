import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Process-local checkout leases shared by recovery, capture and destructive review. */
export const checkpointRestorePaths = new Set<string>();
export function hasCheckpointRestore(): boolean {
  return checkpointRestorePaths.size > 0;
}

export function acquireCheckpointPaths(paths: string[]): () => void {
  const canonical = [
    ...new Set(
      paths.map((value) => {
        try {
          return realpathSync(value);
        } catch {
          return path.resolve(value);
        }
      }),
    ),
  ];
  if (
    canonical.some((value) =>
      [...checkpointRestorePaths].some(
        (held) =>
          value === held ||
          value.startsWith(`${held}${path.sep}`) ||
          held.startsWith(`${value}${path.sep}`),
      ),
    )
  )
    throw new Error('Wait for file rewind or review to finish in these repositories.');
  canonical.forEach((value) => checkpointRestorePaths.add(value));
  return () => canonical.forEach((value) => checkpointRestorePaths.delete(value));
}
