import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../db/schema.js';

const inMemoryDb = new Database(':memory:');
inMemoryDb.exec(SCHEMA_SQL);

const { mockSummariseModule, mockSummariseRepo, mockOnRepoIndexed, mockNotify, mockGetSettings } =
  vi.hoisted(() => ({
    mockSummariseModule: vi.fn(),
    mockSummariseRepo: vi.fn(),
    mockOnRepoIndexed: vi.fn(),
    mockNotify: vi.fn(),
    mockGetSettings: vi.fn(),
  }));

vi.mock('../../db/database.js', () => ({
  getDb: () => inMemoryDb,
}));

vi.mock('../foundry.service.js', () => ({
  summariseModules: vi.fn(
    async (
      repoName: string,
      modules: import('../foundry.service.js').ModuleSummaryInput[],
      options: unknown,
    ) =>
      Promise.all(
        modules.map((mod) =>
          mockSummariseModule(
            repoName,
            mod.path,
            mod.directoryTree,
            mod.keyFileContents,
            undefined,
            options,
          ),
        ),
      ),
  ),
  summariseRepo: mockSummariseRepo,
}));

// repository-map-worker.service.js is intentionally NOT mocked: under Vitest
// it runs the graph build inline (no bundled worker file exists), so mapRepo
// exercises the real repository-map path end to end.

vi.mock('../code-review-git.service.js', () => ({
  getCurrentCommitSha: async () => 'deadbeef',
}));

vi.mock('../repobase.service.js', () => ({
  onRepoIndexed: mockOnRepoIndexed,
}));

vi.mock('../notification.service.js', () => ({
  notifyIfUnfocused: mockNotify,
}));

vi.mock('../settings.service.js', () => ({
  getSettings: mockGetSettings,
}));

import { summariseModules } from '../foundry.service.js';
import { computeModuleContentHash, enrichRepo, mapRepo } from '../repo-index.service.js';

let repoDir = '';
const REPO_ID = 'repo-under-test';

function seedRepo(): void {
  inMemoryDb
    .prepare(
      `INSERT INTO repos (id, name, path, status, created_at, updated_at)
       VALUES (?, ?, ?, 'connected', datetime('now'), datetime('now'))`,
    )
    .run(REPO_ID, 'fixture-repo', repoDir);
}

function writeFixture(): void {
  mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  mkdirSync(path.join(repoDir, 'lib'), { recursive: true });
  writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'fixture-repo' }));
  writeFileSync(path.join(repoDir, 'README.md'), '# fixture');
  writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(repoDir, 'src', 'util.ts'), 'export const b = 2;\n');
  writeFileSync(path.join(repoDir, 'lib', 'helper.ts'), 'export const c = 3;\n');
}

beforeEach(() => {
  inMemoryDb.exec('DELETE FROM repo_index_jobs');
  inMemoryDb.exec('DELETE FROM module_summaries');
  inMemoryDb.exec('DELETE FROM repo_summaries');
  inMemoryDb.exec('DELETE FROM repository_map_graphs');
  inMemoryDb.exec('DELETE FROM repos');
  vi.clearAllMocks();
  mockGetSettings.mockReturnValue({ llmProvider: 'openai', openaiModel: 'gpt-6.1-sol' });

  repoDir = mkdtempSync(path.join(tmpdir(), 'mezair-repo-index-'));
  writeFixture();
  seedRepo();

  mockOnRepoIndexed.mockResolvedValue(undefined);
  mockNotify.mockReturnValue(undefined);
  mockSummariseModule.mockImplementation(async (_repoName: string, modulePath: string) => ({
    path: modulePath,
    purpose: `Purpose of ${modulePath}`,
    keyFiles: [],
    dependencies: [],
  }));
  mockSummariseRepo.mockResolvedValue({
    overview: 'LLM overview',
    mermaidDiagram: 'graph TD\n  A-->B',
    patterns: ['Layered'],
    frameworks: [],
    entryPoints: ['src/index.ts'],
    configFiles: ['package.json'],
  });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('mapRepo (mapped tier)', () => {
  it('produces a structural summary with no LLM calls', async () => {
    await mapRepo(REPO_ID);

    expect(mockSummariseModule).not.toHaveBeenCalled();
    expect(mockSummariseRepo).not.toHaveBeenCalled();

    const repo = inMemoryDb
      .prepare('SELECT status, index_tier, file_count FROM repos WHERE id = ?')
      .get(REPO_ID) as { status: string; index_tier: string; file_count: number };
    expect(repo).toEqual({ status: 'indexed', index_tier: 'mapped', file_count: 5 });

    const summary = inMemoryDb
      .prepare('SELECT overview, index_provider FROM repo_summaries WHERE repo_id = ?')
      .get(REPO_ID) as { overview: string; index_provider: string };
    expect(summary.overview).toContain('fixture-repo');
    expect(summary.index_provider).toBe('local-fallback');

    const modules = inMemoryDb
      .prepare('SELECT path FROM module_summaries WHERE repo_id = ? ORDER BY path')
      .all(REPO_ID) as { path: string }[];
    expect(modules.map((m) => m.path)).toEqual(['.', 'lib', 'src']);

    const graph = inMemoryDb
      .prepare('SELECT repo_id FROM repository_map_graphs WHERE repo_id = ?')
      .get(REPO_ID);
    expect(graph).toBeTruthy();
    expect(mockOnRepoIndexed).toHaveBeenCalled();
  });
});

describe('enrichRepo (enriched tier)', () => {
  it('writes module summaries as they complete and marks the repo enriched', async () => {
    await mapRepo(REPO_ID);
    const result = await enrichRepo(REPO_ID);

    expect(result).toEqual({ summarised: 3, skipped: 0, failed: 0 });
    const repo = inMemoryDb
      .prepare('SELECT status, index_tier FROM repos WHERE id = ?')
      .get(REPO_ID) as { status: string; index_tier: string };
    expect(repo).toEqual({ status: 'indexed', index_tier: 'enriched' });

    const modules = inMemoryDb
      .prepare('SELECT path, purpose, content_hash FROM module_summaries WHERE repo_id = ?')
      .all(REPO_ID) as { path: string; purpose: string; content_hash: string | null }[];
    expect(modules.every((m) => m.purpose.startsWith('Purpose of '))).toBe(true);
    expect(modules.every((m) => typeof m.content_hash === 'string')).toBe(true);

    const summary = inMemoryDb
      .prepare('SELECT overview, index_provider FROM repo_summaries WHERE repo_id = ?')
      .get(REPO_ID) as { overview: string; index_provider: string };
    expect(summary.overview).toBe('LLM overview');
    expect(summary.index_provider).toBe('local-llm');
  });

  it('skips unchanged modules via content hash on re-enrichment', async () => {
    await mapRepo(REPO_ID);
    await enrichRepo(REPO_ID);
    expect(mockSummariseModule).toHaveBeenCalledTimes(3);

    // Nothing changed: every module is skipped, the successful overview is reused too.
    const second = await enrichRepo(REPO_ID);
    expect(second).toEqual({ summarised: 0, skipped: 3, failed: 0 });
    expect(mockSummariseModule).toHaveBeenCalledTimes(3);
    expect(mockSummariseRepo).toHaveBeenCalledTimes(1);

    // Change one file inside the src module: only that module re-summarises.
    writeFileSync(path.join(repoDir, 'src', 'util.ts'), 'export const b = 42;\n// changed\n');
    const third = await enrichRepo(REPO_ID);
    expect(third.summarised).toBe(1);
    expect(third.skipped).toBe(2);
    expect(mockSummariseModule).toHaveBeenCalledTimes(4);
    expect(mockSummariseModule).toHaveBeenLastCalledWith(
      'fixture-repo',
      'src',
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(Object),
    );
  });

  it('keeps the repo enriched with a fallback overview when the overview call fails', async () => {
    await mapRepo(REPO_ID);
    mockSummariseRepo.mockRejectedValueOnce(new Error('llm down'));

    const result = await enrichRepo(REPO_ID);
    expect(result.summarised).toBe(3);

    const repo = inMemoryDb.prepare('SELECT index_tier FROM repos WHERE id = ?').get(REPO_ID) as {
      index_tier: string;
    };
    expect(repo.index_tier).toBe('enriched');
    const summary = inMemoryDb
      .prepare('SELECT overview, index_warnings FROM repo_summaries WHERE repo_id = ?')
      .get(REPO_ID) as { overview: string; index_warnings: string };
    expect(summary.overview).toContain('fixture-repo');
    expect(summary.index_warnings).toContain('llm down');
  });
});

describe('computeModuleContentHash', () => {
  it('changes when file contents or membership change', () => {
    const module = {
      path: 'src',
      files: [
        {
          relativePath: 'src/index.ts',
          extension: '.ts',
          sizeBytes: 10,
          mtimeMs: 1000,
        },
      ],
      keyFiles: ['src/index.ts'],
      directoryTree: '',
    };
    const before = computeModuleContentHash(module, repoDir);
    const renamed = computeModuleContentHash(
      { ...module, files: [{ ...module.files[0], sizeBytes: 11 }] },
      repoDir,
    );
    expect(before).not.toBe(renamed);
  });
});

describe('enrichment resource and cache boundaries', () => {
  it('batches modules with capped inputs and records the actual selected model', async () => {
    writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const a = 1;\n'.repeat(10000));
    await mapRepo(REPO_ID);
    await enrichRepo(REPO_ID);
    expect(summariseModules).toHaveBeenCalledTimes(1);
    const [, modules, options] = vi.mocked(summariseModules).mock.calls[0];
    expect(modules).toHaveLength(3);
    expect(
      modules.every(
        (mod) => mod.directoryTree.length <= 1500 && mod.keyFileContents.length <= 5000,
      ),
    ).toBe(true);
    expect(options).toMatchObject({
      priority: 'background',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      timeoutMs: 90000,
    });
    const row = inMemoryDb
      .prepare('SELECT model_version FROM repo_summaries WHERE repo_id = ?')
      .get(REPO_ID) as { model_version: string };
    expect(row.model_version).toBe('openai:gpt-6.1-sol:summary-v1');
  });
  it('invalidates cached modules and overview when the selected model changes', async () => {
    await mapRepo(REPO_ID);
    await enrichRepo(REPO_ID);
    mockGetSettings.mockReturnValue({ llmProvider: 'openai', openaiModel: 'gpt-6-astra' });
    expect(await enrichRepo(REPO_ID)).toEqual({ summarised: 3, skipped: 0, failed: 0 });
    expect(summariseModules).toHaveBeenCalledTimes(2);
    expect(mockSummariseRepo).toHaveBeenCalledTimes(2);
  });
  it('does not cache a failed batch and retries it next time', async () => {
    await mapRepo(REPO_ID);
    mockSummariseModule.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await enrichRepo(REPO_ID)).toEqual({ summarised: 0, skipped: 0, failed: 3 });
    const rows = inMemoryDb
      .prepare('SELECT content_hash FROM module_summaries WHERE repo_id = ?')
      .all(REPO_ID) as { content_hash: string | null }[];
    expect(rows.every((row) => row.content_hash === null)).toBe(true);
    expect(await enrichRepo(REPO_ID)).toEqual({ summarised: 3, skipped: 0, failed: 0 });
  });
  it('does not persist a late batch after repository indexing is cancelled', async () => {
    await mapRepo(REPO_ID);
    let cancelled = false;
    mockSummariseModule.mockImplementationOnce(async (_repoName: string, path: string) => {
      cancelled = true;
      return { path, purpose: 'Late generated purpose', keyFiles: [], dependencies: [] };
    });
    await expect(enrichRepo(REPO_ID, undefined, { shouldCancel: () => cancelled })).rejects.toThrow(
      'cancelled',
    );
    const rows = inMemoryDb
      .prepare('SELECT purpose FROM module_summaries WHERE repo_id = ?')
      .all(REPO_ID) as { purpose: string }[];
    expect(rows.every((row) => row.purpose !== 'Late generated purpose')).toBe(true);
    expect(mockSummariseRepo).not.toHaveBeenCalled();
  });
});
