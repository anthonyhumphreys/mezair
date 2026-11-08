/** Process-local leases; normal turns avoid loading checkpoint/Git code when none exist. */
export const checkpointRestorePaths = new Set<string>();
export function hasCheckpointRestore(): boolean {
  return checkpointRestorePaths.size > 0;
}
