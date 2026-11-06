import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '../../db/schema.js';

const db = new Database(':memory:');
db.exec(SCHEMA_SQL);
const mocks = vi.hoisted(() => ({
  settings: { llmProvider: 'codex', enabledLlmProviders: ['codex'], codexMode: 'full-access' },
  environment: vi.fn(async () => ({})),
  tools: vi.fn(async () => ({ args: [], env: {}, close: vi.fn() })),
  spawn: vi.fn(),
}));
vi.mock('../../db/database.js', () => ({ getDb: () => db }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: mocks.spawn,
}));
vi.mock('../settings.service.js', () => ({ getSettings: () => mocks.settings }));
vi.mock('../codex-bridge.service.js', () => ({
  detectCodexCli: async () => ({ installed: true }),
}));
vi.mock('../codex-session.service.js', async (original) => ({
  ...(await original<typeof import('../codex-session.service.js')>()),
  buildCodexProcessEnvironment: mocks.environment,
}));
vi.mock('../workflow-validation-tools.js', () => ({ openWorkflowValidationTools: mocks.tools }));
vi.mock('../persona.service.js', () => ({
  getPersonaById: () => ({
    id: 'coder',
    capabilities: { canReadFiles: true, canWriteFiles: true, canRunCommands: true },
  }),
  buildSystemPrompt: () => '',
}));
vi.mock('../notification.service.js', () => ({ notifyWorkflowDecision: vi.fn() }));
vi.mock('../automation.service.js', () => ({ triggerWatchtowerEvent: vi.fn() }));
vi.mock('../chat-persistence.service.js', () => ({
  createChatThread: () => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO chat_threads (id, workspace_id, persona_id, title) VALUES (?, 'ws', 'coder', 'Test')",
    ).run(id);
    return { id };
  },
  saveChatEntry: vi.fn(),
  createChatSession: vi.fn(),
  setChatThreadProviderThreadId: vi.fn(),
}));
import { saveWorkflowTemplate, startWorkflowRun, waitForWorkflowRun } from '../workflow.service.js';

function start() {
  const template = saveWorkflowTemplate({
    name: 'Access startup',
    nodes: [
      {
        id: 'task',
        name: 'Task',
        prompt: 'Inspect',
        personaId: 'coder',
        provider: 'codex',
        model: 'gpt-6.1-sol',
        reasoningEffort: 'medium',
        executionStrategy: 'focused',
        permissionMode: 'full-access',
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  });
  return startWorkflowRun({
    templateId: template.id,
    workspaceId: 'ws',
    repoIds: [],
    kickoff: 'Test',
  });
}
function processFixture() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { writable: true, write: vi.fn(), on: vi.fn() },
    kill: vi.fn(),
    killed: false,
  });
  mocks.spawn.mockReturnValue(proc);
  return proc;
}
function threadReady(proc: ReturnType<typeof processFixture>) {
  proc.stdout.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'thread/started',
        params: { thread: { id: 'native' } },
      }) + '\n',
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.codexMode = 'full-access';
  mocks.environment.mockResolvedValue({});
  mocks.tools.mockResolvedValue({ args: [], env: {}, close: vi.fn() });
  db.exec(
    "DELETE FROM workflow_runs; DELETE FROM workflow_templates; DELETE FROM chat_threads; DELETE FROM workspaces; INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('ws', 'Test', datetime('now'), datetime('now'));",
  );
});
afterAll(() => db.close());
describe('workflow startup authority', () => {
  it('reads the current ceiling after environment setup', async () => {
    let release!: () => void;
    mocks.environment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    );
    const proc = processFixture();
    const run = start();
    await vi.waitFor(() => expect(mocks.environment).toHaveBeenCalled());
    mocks.settings.codexMode = 'read-only';
    release();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    const messages = proc.stdin.write.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(messages.find((message) => message.method === 'thread/start').params.sandbox).toBe(
      'read-only',
    );
    threadReady(proc);
    proc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { turn: { id: 'turn', status: 'completed' } },
        }) + '\n',
      ),
    );
    expect((await waitForWorkflowRun(run.id)).status).toBe('completed');
  });
  it('does not spawn with stale access after MCP setup', async () => {
    let release!: () => void;
    mocks.tools.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ args: [], env: {}, close: vi.fn() });
        }),
    );
    const run = start();
    await vi.waitFor(() => expect(mocks.tools).toHaveBeenCalled());
    mocks.settings.codexMode = 'read-only';
    release();
    expect((await waitForWorkflowRun(run.id)).status).toBe('failed');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('does not start a turn if access changes while the provider initializes', async () => {
    const proc = processFixture();
    const run = start();
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    mocks.settings.codexMode = 'read-only';
    threadReady(proc);
    expect((await waitForWorkflowRun(run.id)).status).toBe('failed');
    expect(proc.stdin.write.mock.calls.some(([line]) => String(line).includes('turn/start'))).toBe(
      false,
    );
    expect(proc.kill).toHaveBeenCalled();
  });
});
