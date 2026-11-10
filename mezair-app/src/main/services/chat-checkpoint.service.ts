import fs from 'node:fs';
import {
  acquireCheckpointPaths,
  canonicalCheckpointPath,
  checkpointRestorePaths as restoringRepos,
} from './chat-checkpoint-locks.js';
import { acquireCheckpointLifecycle } from './chat-checkpoint-lifecycle.js';
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
    env: { ...process.env, ...env, GIT_LITERAL_PATHSPECS: '1' },
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

interface SubmoduleCheckpoint {
  path: string;
  commit: string;
  ref: string;
}
const SUBMODULE_MARKER = 'Mezair-Submodule-Checkpoints: ';

async function submodulePaths(repoPath: string): Promise<string[]> {
  const entries = (await git(repoPath, ['ls-files', '--stage', '-z'])).split('\0');
  const paths = entries
    .filter((entry) => entry.startsWith('160000 '))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1));
  if (paths.length > 64) throw new Error('Too many submodules to checkpoint safely.');
  for (const relative of paths) {
    const root = fs.realpathSync(repoPath);
    const full = path.resolve(root, relative);
    if (
      !full.startsWith(`${root}${path.sep}`) ||
      fs.realpathSync(full) !== full ||
      !fs.existsSync(path.join(full, '.git'))
    )
      throw new Error(`Initialise submodule ${relative} before using file rewind.`);
  }
  return paths.sort();
}

async function checkpointSubmodules(
  repoPath: string,
  commit: string,
): Promise<SubmoduleCheckpoint[]> {
  const message = await git(repoPath, ['show', '-s', '--format=%B', commit]);
  const metadata = message.split('\n').findLast((line) => line.startsWith(SUBMODULE_MARKER));
  if (!metadata) {
    if ((await submodulePaths(repoPath)).length)
      throw new Error(
        'This older checkpoint does not include submodules. Send a new turn to record them.',
      );
    return [];
  }
  const parsed: unknown = JSON.parse(metadata.slice(SUBMODULE_MARKER.length));
  if (!Array.isArray(parsed) || parsed.length > 64)
    throw new Error('Invalid submodule checkpoint.');
  return parsed.map((item) => {
    if (
      !item ||
      typeof item.path !== 'string' ||
      !item.path ||
      path.isAbsolute(item.path) ||
      item.path.split(/[\\/]/).includes('..') ||
      !/^[a-f0-9]{40,64}$/.test(item.commit) ||
      typeof item.ref !== 'string' ||
      !item.ref.startsWith('refs/mezair/checkpoints/') ||
      item.ref.includes('..')
    )
      throw new Error('Invalid submodule checkpoint.');
    return item as SubmoduleCheckpoint;
  });
}

async function validateSubmodules(
  repoPath: string,
  commit: string,
): Promise<SubmoduleCheckpoint[]> {
  const children = await checkpointSubmodules(repoPath, commit);
  if (
    JSON.stringify(children.map((child) => child.path).sort()) !==
    JSON.stringify(await submodulePaths(repoPath))
  )
    throw new Error(
      'Submodules were added or removed since this checkpoint. Restore their layout before rewinding.',
    );
  return children;
}

async function removeCheckpointRef(repoPath: string, commit: string, ref: string): Promise<void> {
  if (!ref.startsWith('refs/mezair/checkpoints/') || ref.includes('..'))
    throw new Error('Invalid checkpoint ref.');
  if (!isGitWorkTree(repoPath))
    throw new Error('Checkpoint checkout is unavailable; cleanup will retry.');
  const current = await git(repoPath, ['rev-parse', '--verify', '-q', ref]).catch((error) => {
    // A missing ref is harmless; an inaccessible/corrupt checkout must remain retryable.
    if (error.code === 1) return '';
    throw error;
  });
  // A delayed cleanup must never delete a newer checkpoint reusing the same ref.
  if (current.trim() !== commit) return;
  for (const child of await checkpointSubmodules(repoPath, commit)) {
    await removeCheckpointRef(path.join(repoPath, child.path), child.commit, child.ref);
  }
  await git(repoPath, ['update-ref', '-d', ref, commit]);
}

/** Records the working tree as a commit and pins it with `refName`. */
export async function createCheckpointCommit(
  repoPath: string,
  refName: string,
  message: string,
  depth = 0,
  budget = { remaining: 65 },
  manifest: Array<{ repoPath: string; commit: string; ref: string }> = [],
): Promise<string> {
  if (--budget.remaining < 0 || depth > 8)
    throw new Error('Submodule nesting exceeds the checkpoint limit.');
  const children: SubmoduleCheckpoint[] = [];
  try {
    for (const relative of await submodulePaths(repoPath)) {
      const ref = `${refName}-submodule-${crypto.createHash('sha256').update(relative).digest('hex').slice(0, 16)}`;
      const commit = await createCheckpointCommit(
        path.join(repoPath, relative),
        ref,
        message,
        depth + 1,
        budget,
        manifest,
      );
      children.push({ path: relative, ref, commit });
    }
    const tree = await captureWorkingTree(repoPath);
    const head = await resolveHead(repoPath);
    const args = [
      'commit-tree',
      tree,
      '-m',
      `${message}\n\n${SUBMODULE_MARKER}${JSON.stringify(children)}`,
    ];
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
    if (depth > 0)
      manifest.push({ repoPath: canonicalCheckpointPath(repoPath), commit, ref: refName });
    return commit;
  } catch (error) {
    for (const child of children)
      await removeCheckpointRef(path.join(repoPath, child.path), child.commit, child.ref).catch(
        () => undefined,
      );
    throw error;
  }
}

/**
 * Files that differ between the checkpoint and the current working tree,
 * described from the point of view of restoring the checkpoint.
 */
export async function diffAgainstCheckpoint(
  repoPath: string,
  commit: string,
): Promise<ChatCheckpointFileChange[]> {
  return (await compareCheckpoint(repoPath, commit)).changes;
}

async function compareCheckpoint(
  repoPath: string,
  commit: string,
): Promise<{ changes: ChatCheckpointFileChange[]; fingerprint: string }> {
  const children = await validateSubmodules(repoPath, commit);
  const current = await captureWorkingTree(repoPath);
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify([fs.realpathSync(repoPath), commit, current]));
  const output = await git(repoPath, [
    'diff',
    '--name-status',
    '--no-renames',
    '--ignore-submodules=all',
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
  for (const child of children) {
    const nested = await compareCheckpoint(path.join(repoPath, child.path), child.commit);
    hash.update(child.path).update(nested.fingerprint);
    changes.push(
      ...nested.changes.map((change) => ({ ...change, path: `${child.path}/${change.path}` })),
    );
  }
  return { changes, fingerprint: hash.digest('hex') };
}

/** Writes the checkpoint's content for `changes` into the working tree only. */
export async function restoreWorkingTree(
  repoPath: string,
  commit: string,
  changes: ChatCheckpointFileChange[],
): Promise<void> {
  const children = await validateSubmodules(repoPath, commit);
  for (const child of children) {
    const prefix = `${child.path}/`;
    const nested = changes
      .filter((change) => change.path.startsWith(prefix))
      .map((change) => ({ ...change, path: change.path.slice(prefix.length) }));
    await restoreWorkingTree(path.join(repoPath, child.path), child.commit, nested);
  }
  changes = changes.filter(
    (change) => !children.some((child) => change.path.startsWith(`${child.path}/`)),
  );
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
  repo_path: string | null;
  kind: 'turn' | 'restore';
  created_at: string;
}

function repoPathFor(repoId: string): string | null {
  const row = getDb().prepare('SELECT path FROM repos WHERE id = ?').get(repoId) as
    { path: string } | undefined;
  return row?.path ?? null;
}

function validateCheckpointScope(threadId: string, repoIds: string[]): void {
  const db = getDb();
  const thread = db
    .prepare('SELECT workspace_id, repo_ids_json FROM chat_threads WHERE id = ?')
    .get(threadId) as { workspace_id: string | null; repo_ids_json: string } | undefined;
  if (!thread) throw new Error('Thread not found.');
  const allowed: string[] = JSON.parse(thread.repo_ids_json);
  for (const id of repoIds) {
    if (
      !allowed.includes(id) ||
      (thread.workspace_id &&
        !db
          .prepare('SELECT 1 FROM workspace_repos WHERE workspace_id = ? AND repo_id = ?')
          .get(thread.workspace_id, id))
    )
      throw new Error('A checkpoint repository is no longer in this conversation workspace.');
  }
}

/** Resolve repair bindings through the same validator used to start provider sessions. */
async function targetPaths(threadId: string, repoIds: string[]): Promise<Map<string, string>> {
  validateCheckpointScope(threadId, repoIds);
  const db = getDb();
  // Avoid loading the review runtime for ordinary chats.
  const repair = db
    .prepare(
      `SELECT 1 FROM change_reviews WHERE EXISTS (
    SELECT 1 FROM json_each(record_json, '$.findings')
    WHERE json_extract(value, '$.repair.threadId') = ?
  ) LIMIT 1`,
    )
    .get(threadId);
  const repairPaths = repair
    ? (await import('./change-review.service.js')).resolveReviewRepairPaths(threadId, repoIds)
    : undefined;
  const paths = new Map<string, string>();
  for (const [index, id] of repoIds.entries()) {
    const value = repairPaths?.[index] ?? repoPathFor(id);
    if (!value) throw new Error('A repository is unavailable. No files were rewound.');
    paths.set(id, canonicalCheckpointPath(value));
  }
  return paths;
}

async function validatedRows(
  threadId: string,
  messageId: string,
): Promise<Array<{ row: CheckpointRow; repoPath: string }>> {
  const rows = rowsForMessage(threadId, messageId);
  if (!rows.length) throw new Error('No checkpoint was recorded before this message.');
  const paths = await targetPaths(
    threadId,
    rows.map((row) => row.repo_id),
  );
  return rows.map((row) => {
    const current = paths.get(row.repo_id)!;
    const recorded = row.repo_path ?? repoPathFor(row.repo_id);
    if (!recorded || fs.realpathSync(recorded) !== current)
      throw new Error(
        'The checkpoint belongs to a different checkout. Send a new turn before rewinding.',
      );
    return { row, repoPath: current };
  });
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
  strict = false,
  executionPaths?: Map<string, string>,
): Promise<ChatCheckpointSummary[]> {
  const db = getDb();
  const created: ChatCheckpointSummary[] = [];
  validateCheckpointScope(threadId, repoIds);
  const paths = executionPaths ?? (await targetPaths(threadId, repoIds));
  const release =
    kind === 'restore' && strict && executionPaths
      ? () => undefined
      : acquireCheckpointPaths([...paths.values()]);
  try {
    for (const repoId of [...new Set(repoIds)]) {
      const repoPath = paths.get(repoId);
      if (!repoPath || !isGitWorkTree(repoPath)) {
        if (strict) throw new Error('A repository is unavailable. No files were rewound.');
        continue;
      }
      const existing = db
        .prepare(
          'SELECT id, created_at FROM chat_checkpoints WHERE thread_id = ? AND message_id = ? AND repo_id = ?',
        )
        .get(threadId, messageId, repoId) as { id: string; created_at: string } | undefined;
      if (existing && kind === 'turn') {
        created.push({ messageId, repoId, createdAt: existing.created_at, kind });
        continue;
      }
      const refName = checkpointRef(threadId, messageId, repoId);
      let commit: string | undefined;
      const manifest: Array<{ repoPath: string; commit: string; ref: string }> = [];
      const checkpointId = existing?.id ?? crypto.randomUUID();
      try {
        commit = await createCheckpointCommit(
          repoPath,
          refName,
          `Mezair checkpoint ${threadId} ${messageId}`,
          0,
          { remaining: 65 },
          manifest,
        );
        const createdAt = new Date().toISOString();
        db.transaction(() => {
          db.prepare(
            `INSERT INTO chat_checkpoints (id, thread_id, message_id, repo_id, commit_sha, ref_name, kind, created_at, repo_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, message_id, repo_id)
         DO UPDATE SET commit_sha = excluded.commit_sha, ref_name = excluded.ref_name, created_at = excluded.created_at, repo_path = excluded.repo_path`,
          ).run(
            checkpointId,
            threadId,
            messageId,
            repoId,
            commit,
            refName,
            kind,
            createdAt,
            repoPath,
          );
          // The independent manifest survives a parent ref being removed outside Mezair.
          db.prepare(
            `INSERT OR IGNORE INTO chat_checkpoint_cleanup (id, repo_path, commit_sha, ref_name)
            SELECT id, repo_path, commit_sha, ref_name FROM chat_checkpoint_ref_manifest WHERE checkpoint_id = ?`,
          ).run(checkpointId);
          db.prepare('DELETE FROM chat_checkpoint_ref_manifest WHERE checkpoint_id = ?').run(
            checkpointId,
          );
          const insert = db.prepare(
            'INSERT INTO chat_checkpoint_ref_manifest (id, checkpoint_id, repo_path, commit_sha, ref_name) VALUES (?, ?, ?, ?, ?)',
          );
          for (const child of manifest)
            insert.run(crypto.randomUUID(), checkpointId, child.repoPath, child.commit, child.ref);
        })();
        created.push({ messageId, repoId, createdAt, kind });
      } catch (error) {
        const cleanup = db.prepare(
          'INSERT OR IGNORE INTO chat_checkpoint_cleanup (id, repo_path, commit_sha, ref_name) VALUES (?, ?, ?, ?)',
        );
        for (const child of manifest)
          cleanup.run(crypto.randomUUID(), child.repoPath, child.commit, child.ref);
        if (commit) cleanup.run(crypto.randomUUID(), repoPath, commit, refName);
        if (commit) await removeCheckpointRef(repoPath, commit, refName).catch(() => undefined);
        if (strict)
          throw new Error('Could not save the undo checkpoint. No files were rewound.', {
            cause: error,
          });
        console.warn('[Checkpoints] capture failed', repoId, error);
      }
    }
    if (kind === 'turn') await pruneThreadCheckpoints(threadId);
    return created;
  } finally {
    release();
  }
}

async function pruneThreadCheckpoints(threadId: string): Promise<void> {
  const db = getDb();
  const messages = db
    .prepare(
      `SELECT message_id, MAX(rowid) AS latest FROM chat_checkpoints
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
    const repoPath = row.repo_path ?? repoPathFor(row.repo_id);
    if (repoPath && isGitWorkTree(repoPath)) {
      await removeCheckpointRef(repoPath, row.commit_sha, row.ref_name).catch(() => undefined);
    }
    db.prepare('DELETE FROM chat_checkpoints WHERE id = ?').run(row.id);
  }
}

/** Removes every checkpoint ref for a thread; call before deleting the thread. */
export async function deleteThreadCheckpoints(threadId: string): Promise<void> {
  const release = acquireCheckpointLifecycle({ threadId });
  try {
    const rows = getDb()
      .prepare('SELECT * FROM chat_checkpoints WHERE thread_id = ?')
      .all(threadId) as CheckpointRow[];
    await deleteCheckpointRows(rows);
  } finally {
    release();
  }
}

/** SQL deletion triggers retain cleanup metadata even when threads cascade away. */
let cleanupCursor = '';
let drainingCleanup: Promise<void> | undefined;
export function drainCheckpointCleanup(): Promise<void> {
  if (drainingCleanup) return drainingCleanup;
  drainingCleanup = (async () => {
    const db = getDb();
    let rows = db
      .prepare('SELECT * FROM chat_checkpoint_cleanup WHERE id > ? ORDER BY id LIMIT 60')
      .all(cleanupCursor) as Array<{
      id: string;
      repo_path: string;
      commit_sha: string;
      ref_name: string;
    }>;
    if (!rows.length && cleanupCursor) {
      cleanupCursor = '';
      rows = db
        .prepare('SELECT * FROM chat_checkpoint_cleanup ORDER BY id LIMIT 60')
        .all() as typeof rows;
    }
    for (const row of rows) {
      cleanupCursor = row.id;
      if (!isGitWorkTree(row.repo_path)) continue; // Retry when an offline checkout returns.
      let release: (() => void) | undefined;
      try {
        release = acquireCheckpointPaths([row.repo_path]);
        await removeCheckpointRef(row.repo_path, row.commit_sha, row.ref_name);
        db.prepare('DELETE FROM chat_checkpoint_cleanup WHERE id = ?').run(row.id);
      } catch (error) {
        console.warn('[Checkpoints] retained cleanup will retry', error);
      } finally {
        release?.();
      }
    }
  })().finally(() => {
    drainingCleanup = undefined;
  });
  return drainingCleanup;
}

export function startCheckpointCleanup(): void {
  const drain = () =>
    void drainCheckpointCleanup().catch((error) =>
      console.warn('[Checkpoints] cleanup deferred', error),
    );
  drain();
  setInterval(drain, 30_000).unref();
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
    .prepare(
      'SELECT * FROM chat_checkpoints WHERE thread_id = ? AND message_id = ? ORDER BY repo_id',
    )
    .all(threadId, messageId) as CheckpointRow[];
}

export async function previewCheckpointRestore(
  threadId: string,
  messageId: string,
): Promise<ChatCheckpointPreview> {
  const targets = await validatedRows(threadId, messageId);
  const repos: ChatCheckpointPreview['repos'] = [];
  const hash = crypto.createHash('sha256');
  for (const { row, repoPath } of targets) {
    const compared = await compareCheckpoint(repoPath, row.commit_sha);
    hash.update(JSON.stringify([row.id, compared.fingerprint]));
    repos.push({
      repoId: row.repo_id,
      createdAt: row.created_at,
      changes: compared.changes,
    });
  }
  return { messageId, repos, fingerprint: hash.digest('hex') };
}

function checkpointRepoPaths(repoIds: string[]): string[] {
  return repoIds.flatMap((id) => {
    const value = repoPathFor(id);
    if (!value) return [];
    try {
      return [fs.realpathSync(value)];
    } catch {
      return [path.resolve(value)];
    }
  });
}
function pathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}${path.sep}`) ||
    right.startsWith(`${left}${path.sep}`)
  );
}
export function checkpointRepositoriesOverlap(left: string[], right: string[]): boolean {
  return checkpointPathsOverlap(checkpointRepoPaths(left), checkpointRepoPaths(right));
}
export function checkpointPathsOverlap(left: string[], right: string[]): boolean {
  return left.some((a) => right.some((b) => pathsOverlap(a, b)));
}
export function assertNoCheckpointRestore(repoIds: string[], executionPaths?: string[]): void {
  if (
    (executionPaths ?? checkpointRepoPaths(repoIds)).some((value) =>
      [...restoringRepos].some((locked) => pathsOverlap(value, locked)),
    )
  )
    throw new Error('Wait for file rewind to finish before starting a turn in these repositories.');
}

/**
 * Restores every repository to its checkpoint. The current state is recorded
 * first under a `restore-…` key so the rewind can be undone.
 */
export async function restoreCheckpoint(
  threadId: string,
  messageId: string,
  options?: { assertCanRestore?: (paths: string[]) => void; fingerprint?: string },
): Promise<ChatCheckpointRestoreResult> {
  const rows = rowsForMessage(threadId, messageId);
  if (rows.length === 0) throw new Error('No checkpoint was recorded before this message.');
  // Resolve the execution paths before leasing them; a retained repair worktree
  // is a separate checkout from the repository's ordinary working tree.
  const targets = await validatedRows(threadId, messageId);
  const lockedPaths = targets.map(({ repoPath }) => repoPath);
  assertNoCheckpointRestore([], lockedPaths);
  options?.assertCanRestore?.(lockedPaths);
  const release = acquireCheckpointPaths(lockedPaths);
  try {
    // Validate every target before creating undo snapshots or mutating any files.
    const prepared = await Promise.all(
      targets.map(async ({ row, repoPath }) => {
        const comparison = await compareCheckpoint(repoPath, row.commit_sha);
        return { row, repoPath, ...comparison };
      }),
    );
    const fingerprint = crypto.createHash('sha256');
    for (const item of prepared)
      fingerprint.update(JSON.stringify([item.row.id, item.fingerprint]));
    if (options?.fingerprint && options.fingerprint !== fingerprint.digest('hex'))
      throw new Error(
        'Files changed since the preview. Review the updated file list and confirm again.',
      );
    const undoKey = `restore-${crypto.randomUUID()}`;
    await captureTurnCheckpoints(
      threadId,
      undoKey,
      rows.map((row) => row.repo_id),
      'restore',
      true,
      new Map(targets.map(({ row, repoPath }) => [row.repo_id, repoPath])),
    );
    // Undo capture awaits Git. Recheck scope and all contents before the first write.
    await validatedRows(threadId, messageId);
    for (const item of prepared) {
      if (
        (await compareCheckpoint(item.repoPath, item.row.commit_sha)).fingerprint !==
        item.fingerprint
      )
        throw new Error(
          'Files changed since the preview. Review the updated file list and confirm again.',
        );
    }
    let filesChanged = 0;
    let started = false;
    try {
      for (const { row, repoPath, changes } of prepared) {
        options?.assertCanRestore?.(lockedPaths);
        started = true;
        await restoreWorkingTree(repoPath, row.commit_sha, changes);
        filesChanged += changes.length;
      }
      return { filesChanged, undoKey };
    } catch (error) {
      if (!started) throw error;
      console.warn('[Checkpoints] restore stopped; undo retained', error);
      return {
        filesChanged,
        undoKey,
        warning:
          'Rewind could not finish. Your previous files are saved; choose Undo rewind to restore them.',
      };
    }
  } finally {
    release();
    await pruneThreadCheckpoints(threadId).catch((error) =>
      console.warn('[Checkpoints] pruning deferred', error),
    );
  }
}
