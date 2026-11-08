import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '../../db/schema.js';
const state = vi.hoisted(() => ({ db: undefined as unknown as Database.Database }));
vi.mock('../../db/database.js', () => ({ getDb: () => state.db }));
import {
  assertNoCheckpointRestore,
  captureTurnCheckpoints,
  restoreCheckpoint,
  deleteThreadCheckpoints,
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
  expect(() => assertNoCheckpointRestore(['repo'])).toThrow('Wait for file rewind');
  await expect(restoreCheckpoint('thread', 'message')).rejects.toThrow('Wait for file rewind');
  await pending;
  expect(() => assertNoCheckpointRestore(['repo'])).not.toThrow();
});

it('returns a usable undo key when a file operation fails after restore begins', async () => {
  await captureTurnCheckpoints('thread', 'message', ['repo']);
  const extra = path.join(repo, 'extra.txt');
  fs.writeFileSync(extra, 'keep this recoverable\n');
  const remove = fs.rmSync;
  const spy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
    if (target === extra) throw new Error('simulated write failure');
    return remove(target, options);
  });
  let undoKey: string;
  try {
    const result = await restoreCheckpoint('thread', 'message');
    expect(result.warning).toContain('Undo rewind');
    undoKey = result.undoKey;
  } finally {
    spy.mockRestore();
  }
  expect((await restoreCheckpoint('thread', undoKey!)).warning).toBeUndefined();
  expect(fs.readFileSync(extra, 'utf8')).toBe('keep this recoverable\n');
});
