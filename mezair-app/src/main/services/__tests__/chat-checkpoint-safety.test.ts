import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '../../db/schema.js';
import { acquireCheckpointPaths } from '../chat-checkpoint-locks.js';
const state = vi.hoisted(() => ({ db: undefined as unknown as Database.Database }));
vi.mock('../../db/database.js', () => ({ getDb: () => state.db }));
import {
  assertNoCheckpointRestore,
  captureTurnCheckpoints,
  restoreCheckpoint,
  deleteThreadCheckpoints,
  previewCheckpointRestore,
  drainCheckpointCleanup,
} from '../chat-checkpoint.service.js';
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
beforeEach(() => {
  state.db = new Database(':memory:');
  state.db.exec(SCHEMA_SQL);
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mezair-checkpoint-safety-'));
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 't@example.test');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'before\n');
  git('add', '.');
  git('commit', '-qm', 'before');
  state.db.prepare("INSERT INTO repos(id,name,path) VALUES('repo','Repo',?)").run(repo);
  state.db
    .prepare(
      "INSERT INTO chat_threads(id,persona_id,title,repo_ids_json) VALUES('thread','coder','Thread','[\"repo\"]')",
    )
    .run();
});
afterEach(() => {
  state.db.close();
  fs.rmSync(repo, { recursive: true, force: true });
});
describe('checkpoint restore safety', () => {
  it('does not persist a turn snapshot while destructive review or rewind holds the checkout', async () => {
    const release = acquireCheckpointPaths([repo]);
    try {
      await expect(captureTurnCheckpoints('thread', 'message', ['repo'])).rejects.toThrow(
        'Wait for file rewind',
      );
    } finally {
      release();
    }
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM chat_checkpoints').get()).toEqual({
      count: 0,
    });
  });
  it('refuses to touch files when the undo checkpoint cannot be persisted', async () => {
    await captureTurnCheckpoints('thread', 'message', ['repo']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'current work\n');
    const refsBefore = git('for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints');
    state.db.exec(
      "CREATE TRIGGER fail_undo BEFORE INSERT ON chat_checkpoints WHEN NEW.kind = 'restore' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
    );
    await expect(restoreCheckpoint('thread', 'message')).rejects.toThrow(
      'Could not save the undo checkpoint',
    );
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('current work\n');
    expect(git('for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints')).toBe(refsBefore);
    expect(() => assertNoCheckpointRestore(['repo'])).not.toThrow();
  });
  it('keeps undo usable and deletes retained refs with the thread checkpoints', async () => {
    await captureTurnCheckpoints('thread', 'message', ['repo']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'current work\n');
    const result = await restoreCheckpoint('thread', 'message');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('before\n');
    await restoreCheckpoint('thread', result.undoKey);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('current work\n');
    await deleteThreadCheckpoints('thread');
    expect(git('for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints').trim()).toBe('');
  });
});

it('fences concurrent rewinds and new turns until recovery finishes', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'current work\n');
  const pending = restoreCheckpoint('thread', 'message');
  await vi.waitFor(() =>
    expect(() => assertNoCheckpointRestore(['repo'])).toThrow('Wait for file rewind'),
  );
  expect(() => assertNoCheckpointRestore(['repo'])).toThrow('Wait for file rewind');
  await expect(restoreCheckpoint('thread', 'message')).rejects.toThrow('Wait for file rewind');
  await pending;
  expect(() => assertNoCheckpointRestore(['repo'])).not.toThrow();
});

it('requires a new confirmation when files change after the preview', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'reviewed current\n');
  const preview = await previewCheckpointRestore('thread', 'message');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'unreviewed file\n');
  await expect(
    restoreCheckpoint('thread', 'message', { fingerprint: preview.fingerprint }),
  ).rejects.toThrow('Files changed since the preview');
  expect(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8')).toBe('unreviewed file\n');
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('reviewed current\n');
  const refreshed = await previewCheckpointRestore('thread', 'message');
  expect(refreshed.fingerprint).not.toBe(preview.fingerprint);
  expect(refreshed.repos[0].changes).toContainEqual({ path: 'new.txt', effect: 'remove' });
});

it('rechecks contents after saving undo and before the first restore write', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'reviewed\n');
  const preview = await previewCheckpointRestore('thread', 'message');
  state.db.function('external_edit', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'new edit\n');
    return 1;
  });
  state.db.exec(
    "CREATE TRIGGER external_edit_during_undo BEFORE INSERT ON chat_checkpoints WHEN NEW.kind = 'restore' BEGIN SELECT external_edit(); END",
  );
  await expect(
    restoreCheckpoint('thread', 'message', { fingerprint: preview.fingerprint }),
  ).rejects.toThrow('Files changed since the preview');
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('new edit\n');
});

it('refuses preview and restore after a repository leaves the source workspace', async () => {
  state.db.exec(
    "INSERT INTO workspaces(id,name,created_at,updated_at) VALUES('ws','Workspace','now','now'); UPDATE chat_threads SET workspace_id = 'ws'; INSERT INTO workspace_repos(workspace_id,repo_id,added_at) VALUES('ws','repo','now');",
  );
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'private current work\n');
  const preview = await previewCheckpointRestore('thread', 'message');
  state.db.exec("DELETE FROM workspace_repos WHERE repo_id = 'repo'");
  await expect(previewCheckpointRestore('thread', 'message')).rejects.toThrow('no longer');
  await expect(
    restoreCheckpoint('thread', 'message', { fingerprint: preview.fingerprint }),
  ).rejects.toThrow('no longer');
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('private current work\n');
});

it('retains and drains Git-ref cleanup when threads are deleted indirectly', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  state.db.exec("DELETE FROM chat_threads WHERE id = 'thread'");
  expect(state.db.prepare('SELECT COUNT(*) AS count FROM chat_checkpoints').get()).toEqual({
    count: 0,
  });
  expect(state.db.prepare('SELECT COUNT(*) AS count FROM chat_checkpoint_cleanup').get()).toEqual({
    count: 1,
  });
  await drainCheckpointCleanup();
  expect(git('for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints').trim()).toBe('');
  expect(state.db.prepare('SELECT COUNT(*) AS count FROM chat_checkpoint_cleanup').get()).toEqual({
    count: 0,
  });
});

it('retains parent and child cleanup when a submodule checkout is temporarily unavailable', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'mezair-cleanup-child-'));
  const childGit = (...args: string[]) =>
    execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  try {
    childGit('init', '-q');
    childGit('config', 'user.name', 'Test');
    childGit('config', 'user.email', 't@example.test');
    fs.writeFileSync(path.join(source, 'child.txt'), 'child\n');
    childGit('add', '.');
    childGit('commit', '-qm', 'child');
    git('-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'nested');
    git('commit', '-qm', 'submodule');
    await captureTurnCheckpoints('thread', 'message', ['repo']);
    const nested = path.join(repo, 'nested'),
      offline = path.join(repo, 'offline-nested');
    fs.renameSync(nested, offline);
    await deleteThreadCheckpoints('thread');
    await drainCheckpointCleanup();
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM chat_checkpoint_cleanup').get()).toEqual(
      { count: 1 },
    );
    expect(git('for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints')).toContain(
      'refs/mezair/checkpoints',
    );
    fs.renameSync(offline, nested);
    await drainCheckpointCleanup();
    expect(state.db.prepare('SELECT COUNT(*) AS count FROM chat_checkpoint_cleanup').get()).toEqual(
      { count: 0 },
    );
    expect(git('for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints').trim()).toBe('');
    expect(
      execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/mezair/checkpoints'], {
        cwd: nested,
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
}, 30000);

it('can rewind the oldest retained turn without pruning it during undo capture', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  state.db.prepare("UPDATE chat_checkpoints SET created_at = '2000-01-01T00:00:00Z'").run();
  for (let index = 0; index < 59; index++) {
    state.db
      .prepare(
        `INSERT INTO chat_checkpoints(id,thread_id,message_id,repo_id,commit_sha,ref_name,kind,created_at,repo_path)
      SELECT ?,thread_id,?,repo_id,commit_sha,?,'turn',?,repo_path FROM chat_checkpoints WHERE message_id = 'message'`,
      )
      .run(
        `filler-${index}`,
        `filler-${index}`,
        `refs/mezair/checkpoints/filler-${index}`,
        new Date(2026, 0, 1, index).toISOString(),
      );
  }
  fs.writeFileSync(path.join(repo, 'a.txt'), 'current\n');
  const preview = await previewCheckpointRestore('thread', 'message');
  const result = await restoreCheckpoint('thread', 'message', { fingerprint: preview.fingerprint });
  expect(result.warning).toBeUndefined();
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('before\n');
  const undo = await previewCheckpointRestore('thread', result.undoKey);
  await restoreCheckpoint('thread', result.undoKey, { fingerprint: undo.fingerprint });
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('current\n');
});

it('returns a usable undo key when a file operation fails after restore begins', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  const first = path.join(repo, 'a-extra.txt');
  const extra = path.join(repo, 'z-extra.txt');
  fs.writeFileSync(first, 'first recoverable file\n');
  fs.writeFileSync(extra, 'second recoverable file\n');
  const canonicalExtra = fs.realpathSync(extra);
  const remove = fs.rmSync;
  const spy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
    if (target === canonicalExtra) throw new Error('simulated write failure');
    return remove(target, options);
  });
  let undoKey: string;
  try {
    const result = await restoreCheckpoint('thread', 'message');
    expect(result.warning).toContain('Undo rewind');
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.readFileSync(extra, 'utf8')).toBe('second recoverable file\n');
    undoKey = result.undoKey;
  } finally {
    spy.mockRestore();
  }
  expect((await restoreCheckpoint('thread', undoKey!)).warning).toBeUndefined();
  expect(fs.readFileSync(first, 'utf8')).toBe('first recoverable file\n');
  expect(fs.readFileSync(extra, 'utf8')).toBe('second recoverable file\n');
});
