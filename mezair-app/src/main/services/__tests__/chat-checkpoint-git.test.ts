import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/database.js', () => ({ getDb: vi.fn() }));
vi.mock('../llm.service.js', () => ({ callLlm: vi.fn() }));

import {
  createCheckpointCommit,
  diffAgainstCheckpoint,
  restoreWorkingTree,
} from '../chat-checkpoint.service.js';
import { applyFileHunk, getFileDiff } from '../git.service.js';
import { parseFileDiff } from '../../../shared/git-hunks.js';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).toString();

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mezair-cp-test-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, 'gone.txt'), 'keep me\n');
  git('add', '.');
  git('commit', '-qm', 'init');
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('turn checkpoints', () => {
  it('captures without touching the index and restores the working tree', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    git('add', 'a.txt');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'draft\n');
    const statusBefore = git('status', '--porcelain');

    const commit = await createCheckpointCommit(repo, 'refs/mezair/checkpoints/t/m1', 'cp');
    expect(git('status', '--porcelain')).toBe(statusBefore);
    expect(git('rev-parse', 'refs/mezair/checkpoints/t/m1').trim()).toBe(commit);

    // The agent's turn: edit, delete, and create files.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'rewritten\n');
    fs.rmSync(path.join(repo, 'gone.txt'));
    fs.rmSync(path.join(repo, 'untracked.txt'));
    fs.writeFileSync(path.join(repo, 'new.txt'), 'agent file\n');

    const changes = await diffAgainstCheckpoint(repo, commit);
    expect(Object.fromEntries(changes.map((c) => [c.path, c.effect]))).toEqual({
      'a.txt': 'restore',
      'gone.txt': 'recreate',
      'new.txt': 'remove',
      'untracked.txt': 'recreate',
    });

    await restoreWorkingTree(repo, commit, changes);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8')).toBe('one\ntwo\nthree\nfour\n');
    expect(fs.readFileSync(path.join(repo, 'gone.txt'), 'utf-8')).toBe('keep me\n');
    expect(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf-8')).toBe('draft\n');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);
    expect(await diffAgainstCheckpoint(repo, commit)).toEqual([]);
  });
});

describe('applyFileHunk', () => {
  beforeEach(() => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(repo, 'a.txt'), `${lines.join('\n')}\n`);
    git('add', '.');
    git('commit', '-qm', 'thirty lines');
    lines[0] = 'LINE 1';
    lines[28] = 'LINE 29';
    fs.writeFileSync(path.join(repo, 'a.txt'), `${lines.join('\n')}\n`);
  });

  it('stages one hunk and discards another', async () => {
    const parsed = parseFileDiff((await getFileDiff(repo, 'a.txt', false)).hunks);
    expect(parsed.hunks).toHaveLength(2);

    await applyFileHunk(repo, 'a.txt', 0, parsed.hunks[0].fingerprint, 'stage');
    expect(git('diff', '--cached')).toContain('+LINE 1');
    expect(git('diff', '--cached')).not.toContain('+LINE 29');

    const remaining = parseFileDiff((await getFileDiff(repo, 'a.txt', false)).hunks);
    expect(remaining.hunks).toHaveLength(1);
    await applyFileHunk(repo, 'a.txt', 0, remaining.hunks[0].fingerprint, 'discard');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8')).toContain('line 29');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8')).toContain('LINE 1');
  });

  it('rejects stale fingerprints and escaping paths', async () => {
    await expect(applyFileHunk(repo, 'a.txt', 0, 'stale', 'stage')).rejects.toThrow(/edited since/);
    await expect(applyFileHunk(repo, '../x.txt', 0, 'x', 'stage')).rejects.toThrow(/outside/);
  });
});
