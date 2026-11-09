import { getDb } from '../db/database.js';
import { acquireCheckpointPaths } from './chat-checkpoint-locks.js';

/** Keep scope and undo records intact for the entire asynchronous recovery lease. */
export function acquireCheckpointLifecycle(
  scope: { threadId?: string; workspaceId?: string; repoIds?: string[] } = {},
): () => void {
  const db = getDb();
  const clauses: string[] = [];
  const values: string[] = [];
  if (scope.threadId) {
    clauses.push('c.thread_id = ?');
    values.push(scope.threadId);
  }
  if (scope.workspaceId) {
    clauses.push('t.workspace_id = ?');
    values.push(scope.workspaceId);
  }
  if (scope.repoIds) {
    if (!scope.repoIds.length) return () => undefined;
    clauses.push(`c.repo_id IN (${scope.repoIds.map(() => '?').join(',')})`);
    values.push(...scope.repoIds);
  }
  const rows = db
    .prepare(
      `SELECT COALESCE(c.repo_path, r.path) AS path
    FROM chat_checkpoints c LEFT JOIN repos r ON r.id = c.repo_id
    LEFT JOIN chat_threads t ON t.id = c.thread_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`,
    )
    .all(...values) as Array<{ path: string | null }>;
  return acquireCheckpointPaths(rows.flatMap((row) => (row.path ? [row.path] : [])));
}
