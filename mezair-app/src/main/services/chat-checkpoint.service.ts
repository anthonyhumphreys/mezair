import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/database.js';
import type {
  ChatCheckpointFileChange,
  ChatCheckpointPreview,
  ChatCheckpointRestoreResult,
  ChatCheckpointSummary,
} from '../../shared/types.js';

/**
 * Turn checkpoints (rewind). Before each user turn is sent, Mezair records the
 * full working tree of every repository in the thread as a dangling commit
 * kept alive by a private ref under `refs/mezair/checkpoints/`. Capture uses a
 * throwaway index, so the user's index, working tree, stash and branches are
 * never touched. Restoring writes only the working tree and always records the
 * pre-restore state first, so a rewind can itself be undone.
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 20_000;
/** Per-thread cap; older checkpoints are pruned with their refs. */
export const MAX_CHECKPOINTS_PER_THREAD = 60;

async function git(repoPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    env: env ? { ...process.env, ...env } : process.env,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf-8',
  });
  return stdout;
}

async function resolveHead(repoPath: string): Promise<string | null> {
  try {
    return (await git(repoPath, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Writes the current working tree (tracked + untracked, respecting ignores)
 * to a tree object using a temporary copy of the index.
 */
export async function captureWorkingTree(repoPath: string): Promise<string> {
  const indexPath = path.resolve(
    repoPath,
    (await git(repoPath, ['rev-parse', '--git-path', 'index'])).trim(),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mezair-checkpoint-'));
  const tempIndex = path.join(dir, 'index');
  try {
    // Copying the real index keeps git's stat cache, so `add -A` is fast.
    if (fs.existsSync(indexPath)) fs.copyFileSync(indexPath, tempIndex);
    const env = { GIT_INDEX_FILE: tempIndex };
    await git(repoPath, ['add', '-A', '--', '.'], env);
    return (await git(repoPath, ['write-tree'], env)).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Records the working tree as a commit and pins it with `refName`. */
export async function createCheckpointCommit(
  repoPath: string,
  refName: string,
  message: string,
): Promise<string> {
  const tree = await captureWorkingTree(repoPath);
  const head = await resolveHead(repoPath);
  const args = ['commit-tree', tree, '-m', message];
  if (head) args.splice(2, 0, '-p', head);
  const commit = (
    await git(repoPath, args, {
      GIT_AUTHOR_NAME: 'Mezair',
      GIT_AUTHOR_EMAIL: 'checkpoints@mezair.local',
      GIT_COMMITTER_NAME: 'Mezair',
      GIT_COMMITTER_EMAIL: 'checkpoints@mezair.local',
    })
  ).trim();
  await git(repoPath, ['update-ref', refName, commit]);
  return commit;
}

/**
 * Files that differ between the checkpoint and the current working tree,
 * described from the point of view of restoring the checkpoint.
 */
export async function diffAgainstCheckpoint(
  repoPath: string,
  commit: string,
): Promise<ChatCheckpointFileChange[]> {
  const current = await captureWorkingTree(repoPath);
  const output = await git(repoPath, [
    'diff',
    '--name-status',
    '--no-renames',
    '-z',
    `${commit}^{tree}`,
    current,
  ]);
  const parts = output.split('\0').filter(Boolean);
  const changes: ChatCheckpointFileChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const filePath = parts[i + 1];
    // A = added since the checkpoint → restoring removes it.
    // D = deleted since → restoring recreates it. Anything else is rewritten.
    changes.push({
      path: filePath,
      effect: status === 'A' ? 'remove' : status === 'D' ? 'recreate' : 'restore',
    });
  }
  return changes;
}

/** Writes the checkpoint's content for `changes` into the working tree only. */
export async function restoreWorkingTree(
  repoPath: string,
  commit: string,
  changes: ChatCheckpointFileChange[],
): Promise<void> {
  const fromCheckpoint = changes.filter((change) => change.effect !== 'remove');
  const toRemove = changes.filter((change) => change.effect === 'remove');
  const root = path.resolve(repoPath);
  for (const change of toRemove) {
    const full = path.resolve(root, change.path);
    if (!full.startsWith(`${root}${path.sep}`)) continue;
    fs.rmSync(full, { force: true });
  }
  // `git restore --worktree` leaves the index alone. Batch to stay under argv limits.
  for (let i = 0; i < fromCheckpoint.length; i += 200) {
    const batch = fromCheckpoint.slice(i, i + 200).map((change) => change.path);
    await git(repoPath, ['restore', `--source=${commit}`, '--worktree', '--', ...batch]);
  }
}

// --- Persistence -------------------------------------------------------------

interface CheckpointRow {
  id: string;
  thread_id: string;
  message_id: string;
  repo_id: string;
  commit_sha: string;
  ref_name: string;
  kind: 'turn' | 'restore';
  created_at: string;
}

function repoPathFor(repoId: string): string | null {
  const row = getDb().prepare('SELECT path FROM repos WHERE id = ?').get(repoId) as
    { path: string } | undefined;
  return row?.path ?? null;
}

function safeRefSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'x';
}

function checkpointRef(threadId: string, messageId: string, repoId: string): string {
  return `refs/mezair/checkpoints/${safeRefSegment(threadId)}/${safeRefSegment(messageId)}-${safeRefSegment(repoId).slice(0, 12)}`;
}

function isGitWorkTree(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git'));
}

/**
 * Records a checkpoint for each repository before a turn. Best effort: a
 * failure is logged and never blocks the message.
 */
export async function captureTurnCheckpoints(
  threadId: string,
  messageId: string,
  repoIds: string[],
  kind: 'turn' | 'restore' = 'turn',
): Promise<ChatCheckpointSummary[]> {
  const db = getDb();
  const created: ChatCheckpointSummary[] = [];
  for (const repoId of [...new Set(repoIds)]) {
    const repoPath = repoPathFor(repoId);
    if (!repoPath || !isGitWorkTree(repoPath)) continue;
    const refName = checkpointRef(threadId, messageId, repoId);
    try {
      const commit = await createCheckpointCommit(
        repoPath,
        refName,
        `Mezair checkpoint ${threadId} ${messageId}`,
      );
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_checkpoints (id, thread_id, message_id, repo_id, commit_sha, ref_name, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, message_id, repo_id)
         DO UPDATE SET commit_sha = excluded.commit_sha, ref_name = excluded.ref_name, created_at = excluded.created_at`,
      ).run(crypto.randomUUID(), threadId, messageId, repoId, commit, refName, kind, createdAt);
      created.push({ messageId, repoId, createdAt, kind });
    } catch (error) {
      console.warn('[Checkpoints] capture failed', repoId, error);
    }
  }
  await pruneThreadCheckpoints(threadId);
  return created;
}

async function pruneThreadCheckpoints(threadId: string): Promise<void> {
  const db = getDb();
  const messages = db
    .prepare(
      `SELECT message_id, MAX(created_at) AS latest FROM chat_checkpoints
       WHERE thread_id = ? GROUP BY message_id ORDER BY latest DESC`,
    )
    .all(threadId) as Array<{ message_id: string }>;
  const stale = messages.slice(MAX_CHECKPOINTS_PER_THREAD).map((row) => row.message_id);
  for (const messageId of stale) {
    const rows = db
      .prepare('SELECT * FROM chat_checkpoints WHERE thread_id = ? AND message_id = ?')
      .all(threadId, messageId) as CheckpointRow[];
    await deleteCheckpointRows(rows);
  }
}

async function deleteCheckpointRows(rows: CheckpointRow[]): Promise<void> {
  const db = getDb();
  for (const row of rows) {
    const repoPath = repoPathFor(row.repo_id);
    if (repoPath && isGitWorkTree(repoPath)) {
      await git(repoPath, ['update-ref', '-d', row.ref_name]).catch(() => undefined);
    }
    db.prepare('DELETE FROM chat_checkpoints WHERE id = ?').run(row.id);
  }
}

/** Removes every checkpoint ref for a thread; call before deleting the thread. */
export async function deleteThreadCheckpoints(threadId: string): Promise<void> {
  const rows = getDb()
    .prepare('SELECT * FROM chat_checkpoints WHERE thread_id = ?')
    .all(threadId) as CheckpointRow[];
  await deleteCheckpointRows(rows);
}

export function listThreadCheckpoints(threadId: string): ChatCheckpointSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT message_id, repo_id, created_at, kind FROM chat_checkpoints
       WHERE thread_id = ? ORDER BY created_at ASC`,
    )
    .all(threadId) as Array<Pick<CheckpointRow, 'message_id' | 'repo_id' | 'created_at' | 'kind'>>;
  return rows.map((row) => ({
    messageId: row.message_id,
    repoId: row.repo_id,
    createdAt: row.created_at,
    kind: row.kind,
  }));
}

function rowsForMessage(threadId: string, messageId: string): CheckpointRow[] {
  return getDb()
    .prepare('SELECT * FROM chat_checkpoints WHERE thread_id = ? AND message_id = ?')
    .all(threadId, messageId) as CheckpointRow[];
}

export async function previewCheckpointRestore(
  threadId: string,
  messageId: string,
): Promise<ChatCheckpointPreview> {
  const rows = rowsForMessage(threadId, messageId);
  if (rows.length === 0) throw new Error('No checkpoint was recorded before this message.');
  const repos: ChatCheckpointPreview['repos'] = [];
  for (const row of rows) {
    const repoPath = repoPathFor(row.repo_id);
    if (!repoPath) continue;
    repos.push({
      repoId: row.repo_id,
      createdAt: row.created_at,
      changes: await diffAgainstCheckpoint(repoPath, row.commit_sha),
    });
  }
  return { messageId, repos };
}

/**
 * Restores every repository to its checkpoint. The current state is recorded
 * first under a `restore-…` key so the rewind can be undone.
 */
export async function restoreCheckpoint(
  threadId: string,
  messageId: string,
): Promise<ChatCheckpointRestoreResult> {
  const rows = rowsForMessage(threadId, messageId);
  if (rows.length === 0) throw new Error('No checkpoint was recorded before this message.');
  const undoKey = `restore-${Date.now().toString(36)}`;
  await captureTurnCheckpoints(
    threadId,
    undoKey,
    rows.map((row) => row.repo_id),
    'restore',
  );
  let filesChanged = 0;
  for (const row of rows) {
    const repoPath = repoPathFor(row.repo_id);
    if (!repoPath) continue;
    const changes = await diffAgainstCheckpoint(repoPath, row.commit_sha);
    await restoreWorkingTree(repoPath, row.commit_sha, changes);
    filesChanged += changes.length;
  }
  return { filesChanged, undoKey };
}
