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
import {
  applyFileHunk,
  getFileDiff,
  unstageFiles,
  discardReviewedFile,
  discardFiles,
} from '../git.service.js';
import { acquireCheckpointPaths } from '../chat-checkpoint-locks.js';
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

it('treats glob characters literally in legacy whole-file discard', async () => {
  fs.writeFileSync(path.join(repo, '[ab].txt'), 'original\n');
  git('add', '.');
  git('commit', '-qm', 'literal path');
  fs.writeFileSync(path.join(repo, '[ab].txt'), 'changed\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'keep newer content\n');
  await discardFiles(repo, ['[ab].txt']);
  expect(fs.readFileSync(path.join(repo, '[ab].txt'), 'utf8')).toBe('original\n');
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('keep newer content\n');
});

it('ignores forced Git color for rendered and applied hunks', async () => {
  git('config', 'color.ui', 'always');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'ONE\ntwo\nthree\n');
  const diff = await getFileDiff(repo, 'a.txt', false);
  expect(diff.hunks).not.toContain('\u001b');
  const parsed = parseFileDiff(diff.hunks);
  await applyFileHunk(repo, 'a.txt', 0, parsed.hunks[0].fingerprint, 'stage');
  expect(git('show', ':a.txt')).toBe('ONE\ntwo\nthree\n');
});

it('refuses hunk unstaging of a staged rename without changing either index path', async () => {
  git('mv', 'a.txt', 'renamed.txt');
  fs.writeFileSync(path.join(repo, 'renamed.txt'), 'one\nTWO\nthree\n');
  git('add', '.');
  const before = git('write-tree');
  const diff = parseFileDiff((await getFileDiff(repo, 'renamed.txt', true)).hunks);
  await expect(
    applyFileHunk(repo, 'renamed.txt', 0, diff.hunks[0].fingerprint, 'unstage'),
  ).rejects.toThrow('as a whole file');
  expect(git('write-tree')).toBe(before);
});

it('fences destructive review behind the shared recovery lease', async () => {
  fs.writeFileSync(path.join(repo, 'a.txt'), 'ONE\ntwo\nthree\n');
  const reviewed = await getFileDiff(repo, 'a.txt', false);
  const parsed = parseFileDiff(reviewed.hunks);
  const release = acquireCheckpointPaths([repo]);
  try {
    await expect(
      applyFileHunk(repo, 'a.txt', 0, parsed.hunks[0].fingerprint, 'discard'),
    ).rejects.toThrow('Wait for file rewind');
    await expect(discardReviewedFile(repo, 'a.txt', reviewed.reviewFingerprint!)).rejects.toThrow(
      'Wait for file rewind',
    );
    await expect(discardFiles(repo, ['a.txt'])).rejects.toThrow('Wait for file rewind');
  } finally {
    release();
  }
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('ONE\ntwo\nthree\n');
});

it('discards only the reviewed whole-file patch and refuses newer edits', async () => {
  fs.writeFileSync(path.join(repo, 'a.txt'), 'reviewed\n');
  const reviewed = await getFileDiff(repo, 'a.txt', false);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'newer edit\n');
  await expect(discardReviewedFile(repo, 'a.txt', reviewed.reviewFingerprint!)).rejects.toThrow(
    'changed since',
  );
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('newer edit\n');
  const fresh = await getFileDiff(repo, 'a.txt', false);
  await discardReviewedFile(repo, 'a.txt', fresh.reviewFingerprint!);
  expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
});

it('guards untracked deletion with the reviewed contents', async () => {
  fs.writeFileSync(path.join(repo, '[new].txt'), 'reviewed\n');
  const reviewed = await getFileDiff(repo, '[new].txt', false);
  fs.writeFileSync(path.join(repo, '[new].txt'), 'new content\n');
  await expect(discardReviewedFile(repo, '[new].txt', reviewed.reviewFingerprint!)).rejects.toThrow(
    'changed since',
  );
  const fresh = await getFileDiff(repo, '[new].txt', false);
  await discardReviewedFile(repo, '[new].txt', fresh.reviewFingerprint!);
  expect(fs.existsSync(path.join(repo, '[new].txt'))).toBe(false);
});

it.skipIf(process.platform === 'win32').each(['stage', 'unstage', 'discard'] as const)(
  'keeps executable-bit changes separate when applying a content hunk (%s)',
  async (action) => {
    git('config', 'core.filemode', 'true');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'ONE\ntwo\nthree\n');
    fs.chmodSync(path.join(repo, 'a.txt'), 0o755);
    if (action === 'unstage') git('add', 'a.txt');
    const before = git('ls-files', '--stage', 'a.txt').slice(0, 6);
    const diff = parseFileDiff((await getFileDiff(repo, 'a.txt', action === 'unstage')).hunks);
    await applyFileHunk(repo, 'a.txt', 0, diff.hunks[0].fingerprint, action);
    expect(git('ls-files', '--stage', 'a.txt').slice(0, 6)).toBe(before);
    expect(fs.statSync(path.join(repo, 'a.txt')).mode & 0o111).toBe(0o111);
  },
);

describe('turn checkpoints', () => {
  it('captures without touching the index and restores the working tree', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    git('add', 'a.txt');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nunstaged\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'draft\n');
    const statusBefore = git('status', '--porcelain');
    const indexBeforeCapture = git('write-tree');

    const commit = await createCheckpointCommit(repo, 'refs/mezair/checkpoints/t/m1', 'cp');
    expect(git('status', '--porcelain')).toBe(statusBefore);
    expect(git('write-tree')).toBe(indexBeforeCapture);
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

    const indexBeforeRestore = git('write-tree');
    await restoreWorkingTree(repo, commit, changes);
    expect(git('write-tree')).toBe(indexBeforeRestore);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8')).toBe(
      'one\ntwo\nthree\nfour\nunstaged\n',
    );
    expect(fs.readFileSync(path.join(repo, 'gone.txt'), 'utf-8')).toBe('keep me\n');
    expect(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf-8')).toBe('draft\n');
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);
    expect(await diffAgainstCheckpoint(repo, commit)).toEqual([]);
  }, 30_000);
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

  it('unstages one hunk without changing working files or the other staged hunk', async () => {
    git('add', 'a.txt');
    const workingBefore = fs.readFileSync(path.join(repo, 'a.txt'), 'utf8');
    const parsed = parseFileDiff((await getFileDiff(repo, 'a.txt', true)).hunks);
    await applyFileHunk(repo, 'a.txt', 0, parsed.hunks[0].fingerprint, 'unstage');
    expect(git('diff', '--cached')).not.toContain('+LINE 1');
    expect(git('diff', '--cached')).toContain('+LINE 29');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe(workingBefore);
  });

  it('rejects stale fingerprints and escaping paths', async () => {
    await expect(applyFileHunk(repo, 'a.txt', 0, 'stale', 'stage')).rejects.toThrow(/edited since/);
    await expect(applyFileHunk(repo, '../x.txt', 0, 'x', 'stage')).rejects.toThrow(/outside/);
  });
});

describe('review regression cases', () => {
  it('unstages both paths of a rename', async () => {
    git('mv', 'a.txt', 'renamed.txt');
    await unstageFiles(repo, ['renamed.txt']);
    expect(git('diff', '--cached', '--name-status').trim()).toBe('');
    expect(fs.readFileSync(path.join(repo, 'renamed.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  });
  it('applies hunks with diff.noprefix enabled and custom prefixes', async () => {
    git('config', 'diff.noprefix', 'true');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    const diff = parseFileDiff((await getFileDiff(repo, 'a.txt', false)).hunks);
    await applyFileHunk(repo, 'a.txt', 0, diff.hunks[0].fingerprint, 'stage');
    expect(git('diff', '--cached')).toContain('+changed');
  });
  it('captures and rewinds submodule working files without moving its branch or index', async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'mezair-submodule-source-'));
    try {
      const childGit = (...args: string[]) =>
        execFileSync('git', args, { cwd: source, encoding: 'utf8' });
      childGit('init', '-q');
      childGit('config', 'user.name', 'Test');
      childGit('config', 'user.email', 't@example.com');
      fs.writeFileSync(path.join(source, 'child.txt'), 'committed\n');
      childGit('add', '.');
      childGit('commit', '-qm', 'child');
      git('-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'nested');
      git('commit', '-qm', 'add submodule');
      const childPath = path.join(repo, 'nested');
      const childHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: childPath,
        encoding: 'utf8',
      });
      fs.writeFileSync(path.join(childPath, 'child.txt'), 'before turn\n');
      fs.writeFileSync(path.join(childPath, 'draft.txt'), 'untracked before turn\n');
      const commit = await createCheckpointCommit(
        repo,
        'refs/mezair/checkpoints/t/sub',
        'submodules',
      );
      fs.writeFileSync(path.join(childPath, 'child.txt'), 'after turn\n');
      fs.rmSync(path.join(childPath, 'draft.txt'));
      const changes = await diffAgainstCheckpoint(repo, commit);
      expect(changes.map((item) => item.path)).toEqual(['nested/child.txt', 'nested/draft.txt']);
      await restoreWorkingTree(repo, commit, changes);
      expect(fs.readFileSync(path.join(childPath, 'child.txt'), 'utf8')).toBe('before turn\n');
      expect(fs.readFileSync(path.join(childPath, 'draft.txt'), 'utf8')).toBe(
        'untracked before turn\n',
      );
      expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: childPath, encoding: 'utf8' })).toBe(
        childHead,
      );
      expect(execFileSync('git', ['diff', '--cached'], { cwd: childPath, encoding: 'utf8' })).toBe(
        '',
      );
      expect(await diffAgainstCheckpoint(repo, commit)).toEqual([]);
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
    }
  }, 30_000);
});
