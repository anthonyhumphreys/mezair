import { getDb } from '../db/database.js';

/** Check the current grant independently of best-effort checkpoint I/O. */
export function assertWorkspaceRepositoryMembership(workspaceId: string, repoIds: string[]): void {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(workspaceId))
    throw new Error('This conversation workspace is no longer available.');
  const member = db.prepare('SELECT 1 FROM workspace_repos WHERE workspace_id = ? AND repo_id = ?');
  if (repoIds.some((repoId) => !member.get(workspaceId, repoId)))
    throw new Error(
      'A session repository is no longer in this workspace. Start a new session before sending.',
    );
}
