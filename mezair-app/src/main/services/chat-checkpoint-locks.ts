import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Process-local checkout leases shared by recovery, capture and destructive review. */
export const checkpointRestorePaths = new Set<string>();
export function hasCheckpointRestore(): boolean {
  return checkpointRestorePaths.size > 0;
}

/** Resolve existing ancestors too, so an offline child retains its canonical identity. */
export function canonicalCheckpointPath(value: string): string {
  const absolute = path.resolve(value);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = path.dirname(absolute);
    return parent === absolute
      ? absolute
      : path.join(canonicalCheckpointPath(parent), path.basename(absolute));
  }
}

export class CheckpointLeaseBusyError extends Error {}

export function acquireCheckpointPaths(paths: string[]): () => void {
  const canonical = [...new Set([...new Set(paths)].map(canonicalCheckpointPath))];
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
    throw new CheckpointLeaseBusyError(
      'Wait for file rewind or review to finish in these repositories.',
    );
  canonical.forEach((value) => checkpointRestorePaths.add(value));
  return () => canonical.forEach((value) => checkpointRestorePaths.delete(value));
}
