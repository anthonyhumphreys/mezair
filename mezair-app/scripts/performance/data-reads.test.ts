import { it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
setFlagsFromString('--expose_gc');
const collect = runInNewContext('gc') as () => void;
import { SCHEMA_SQL } from '../../src/main/db/schema';
const db = new Database(':memory:');
db.exec(SCHEMA_SQL);
vi.mock('../../src/main/db/database.js', () => ({ getDb: () => db }));
import {
  createChatThread,
  loadChatHistory,
} from '../../src/main/services/chat-persistence.service';
import { loadChatHistoryPage } from '../../src/main/services/chat-history-page.service';
import { FactoryStore } from '../../src/main/services/factory-persistence.service';
import type { FactoryDefinition, FactoryRun } from '../../src/shared/factories';
const now = '2026-01-01T00:00:00.000Z';
function sample(action: () => unknown) {
  collect();
  const baseHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  const value = action();
  const readHeap = process.memoryUsage().heapUsed;
  const bytes = Buffer.byteLength(JSON.stringify(value));
  return {
    ms: performance.now() - start,
    bytes,
    peakSampledHeapGrowthBytes: Math.max(
      0,
      readHeap - baseHeap,
      process.memoryUsage().heapUsed - baseHeap,
    ),
  };
}
it('measures full reads against bounded pages and summaries on one synthetic SQLite database', () => {
  const thread = createChatThread({ personaId: 'coder', title: 'Performance fixture' });
  const insert = db.prepare(
    'INSERT INTO chat_messages(id,role,content,timestamp,thread_id,event_json) VALUES(?,?,?,?,?,?)',
  );
  db.transaction(() => {
    for (let turn = 0; turn < 1000; turn++) {
      insert.run(`u-${turn}`, 'user', `Review ${turn}`, now, thread.id, null);
      for (let action = 0; action < 30; action++)
        insert.run(
          `e-${turn}-${action}`,
          'system',
          '',
          now,
          thread.id,
          JSON.stringify({
            type: 'command_exec',
            command: 'pnpm verify',
            output: 'Verified synthetic input.\n'.repeat(30),
            exitCode: 0,
          }),
        );
      insert.run(
        `a-${turn}`,
        'assistant',
        'Completed synthetic request.\n'.repeat(10),
        now,
        thread.id,
        null,
      );
    }
  })();
  const factory: FactoryDefinition = {
    id: 'factory-fixture',
    workspaceId: 'fixture',
    revision: 1,
    status: 'active',
    ownerId: 'fixture',
    accountScope: 'fixture',
    confirmation: 'fixture',
    createdAt: now,
    updatedAt: now,
    workflow: {
      id: 'workflow',
      name: 'Fixture',
      description: '',
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
    },
    definition: {
      name: 'Fixture',
      workspaceId: 'fixture',
      repoId: 'fixture',
      workflowTemplateId: 'workflow',
      criteria: ['Synthetic'],
      checks: ['pnpm verify'],
      postMergeChecks: [],
      limits: { repairRounds: 2, maxRunMinutes: 90, maxCommands: 40, maxConcurrentRuns: 1 },
      publication: { enabled: false, draft: true },
      merge: {
        mode: 'human-approved',
        method: 'squash',
        requiredChecks: ['CI'],
        requireApproval: true,
      },
      access: { kind: 'private' },
    },
  };
  db.prepare(
    "INSERT INTO workspaces(id,name,created_at,updated_at)VALUES('fixture','Fixture',?,?)",
  ).run(now, now);
  const store = new FactoryStore(db);
  store.saveRevision(factory);
  const insertRun = db.prepare(
    'INSERT INTO factory_runs(id,factory_id,issue_key,stage,record_json,version,updated_at)VALUES(?,?,?,?,?,1,?)',
  );
  db.transaction(() => {
    for (let n = 0; n < 5000; n++) {
      const run: FactoryRun = {
        id: `r-${n}`,
        factoryId: factory.id,
        revision: 1,
        workspaceId: 'fixture',
        snapshot: factory,
        issue: {
          number: n,
          title: 'Synthetic run',
          body: 'Context. '.repeat(100),
          url: '',
          labels: [],
          state: 'open',
          createdAt: now,
          updatedAt: now,
        },
        stage: n % 10 ? 'completed' : 'received',
        version: 1,
        repairRounds: 0,
        commandsUsed: 0,
        createdAt: now,
        updatedAt: now,
        deadlineAt: now,
        receipts: [],
      };
      insertRun.run(run.id, factory.id, run.id, run.stage, JSON.stringify(run), now);
    }
  })();
  const measurements: Record<
    string,
    Array<{ ms: number; bytes: number; peakSampledHeapGrowthBytes: number }>
  > = {
    historyFull: [],
    historyPage: [],
    factoryFull: [],
    factoryPage: [],
    factorySummary: [],
  };
  const actions = {
    historyFull: () => loadChatHistory(thread.id),
    historyPage: () => loadChatHistoryPage({ threadId: thread.id }),
    factoryFull: () => store.listRuns(factory.id),
    factoryPage: () => store.runPage(factory.id, 50),
    factorySummary: () => store.runSummary(factory.id),
  };
  for (let round = 0; round < 5; round++)
    for (const key of round % 2 ? Object.keys(actions).reverse() : Object.keys(actions))
      measurements[key].push(sample(actions[key]));
  expect(loadChatHistoryPage({ threadId: thread.id }).messages).toHaveLength(200);
  expect(store.runPage(factory.id, 50).runs).toHaveLength(50);
  expect(store.runSummary(factory.id).total).toBe(5000);
  writeFileSync(
    'docs/performance/data-reads.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        environment: {
          node: process.version,
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0].model,
        },
        methodology:
          'Same in-memory SQLite database; actual full-read and new paged services. Five alternating samples, including JSON serialization as a payload-size proxy. Forced GC before each sample; heap growth sampled after read and serialization (sampled high-water estimate, not a continuous allocation trace). Excludes Electron IPC transport, file-system I/O, providers and hosted encrypted history. 32,000 messages (1,000 turns × 30 actions plus user/answer); 5,000 factory runs.',
        measurements,
      },
      null,
      2,
    ) + '\n',
  );
  db.close();
});
