import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake ACP agent process: stdin writes are captured, stdout lines are
// emitted by the test to drive the JSON-RPC stream.
interface FakeAcpProcess extends EventEmitter {
  stdin: {
    writable: boolean;
    destroyed: boolean;
    writableEnded: boolean;
    write: (chunk: string) => boolean;
    on: () => unknown;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  written: string[];
}

function createFakeAcpProcess(): FakeAcpProcess {
  const proc = new EventEmitter() as FakeAcpProcess;
  const written: string[] = [];
  proc.stdin = {
    writable: true,
    destroyed: false,
    writableEnded: false,
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
    on: () => proc.stdin,
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.written = written;
  return proc;
}

function emit(proc: FakeAcpProcess, payload: Record<string, unknown>): void {
  proc.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`));
}

function writtenRequests(proc: FakeAcpProcess, method: string): Record<string, unknown>[] {
  return proc.written
    .flatMap((chunk) => chunk.split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((msg) => msg.method === method);
}

const mocks = vi.hoisted(() => ({
  settings: {
    llmProvider: 'cursor',
    enabledLlmProviders: ['cursor', 'devin', 'claude', 'codex', 'openai', 'azure', 'llmgateway'],
    codexMode: 'workspace-auto',
    openaiModel: 'auto',
    reasoningLevel: 'medium',
  } as Record<string, unknown>,
  personas: {} as Record<
    string,
    { capabilities: { canWriteFiles: boolean; canRunCommands: boolean; canReadFiles: boolean } }
  >,
  spawnResults: [] as FakeAcpProcess[],
  timeline: [] as string[],
  persistedEventTypes: [] as string[],
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = mocks.spawnResults.shift();
    if (!proc) throw new Error('No fake ACP process queued for spawn()');
    return proc;
  }),
}));

vi.mock('../claude-agent-process.js', () => ({
  ClaudeAgentProcess: class {
    constructor() {
      return vi.mocked(spawn)('claude', [], { stdio: 'pipe' }) as unknown as FakeAcpProcess;
    }
  },
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mezair-test', getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../settings.service.js', () => ({ getSettings: () => mocks.settings }));

vi.mock('../persona.service.js', () => ({
  getPersonaById: (id: string) => mocks.personas[id] ?? null,
  buildSystemPrompt: () => 'system prompt',
  buildDesignSystemPrompt: () => 'design prompt',
  buildScaffoldSystemPrompt: () => 'scaffold prompt',
}));

vi.mock('../mesh-ownership.service.js', () => ({ assertSessionTurnAllowed: () => undefined }));
vi.mock('../dojo-analytics.service.js', () => ({
  listDojoPrices: () => [],
  recordDojoExecutionEvent: () => undefined,
}));
vi.mock('../companion-events.service.js', () => ({ emitCompanionEvent: () => undefined }));
vi.mock('../chat-persistence.service.js', () => ({
  getChatThread: () => null,
  isTemporaryChatThread: () => false,
  updateChatThreadAttention: () => undefined,
}));
vi.mock('../chat-evidence.service.js', () => ({
  saveChatEvent: vi.fn((_threadId, _repoId, _sessionId, event) => {
    mocks.persistedEventTypes.push(event.type);
    mocks.timeline.push(`persist:${event.type}`);
  }),
}));
vi.mock('../agent-ui-intent.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent-ui-intent.service.js')>();
  return { ...actual, getAgentUIIntent: vi.fn(() => null) };
});
vi.mock('../thread-assist.service.js', () => ({ scheduleThreadMetadataRefresh: () => undefined }));
vi.mock('../notification.service.js', () => ({ notifyChatActivity: () => undefined }));
vi.mock('../llm-gateway.service.js', () => ({
  applyLlmGatewayEnvironment: () => undefined,
  resolveLlmGatewayModelConfig: vi.fn(),
}));
vi.mock('../llm-gateway-runtime.service.js', () => ({
  syncGatewayCodexIntegrations: vi.fn(),
  writeGatewayCodexCatalog: vi.fn(async () => []),
}));
vi.mock('../codex-runtime.service.js', () => ({ resolveCodexRuntime: async () => '/bin/codex' }));

import { spawn } from 'node:child_process';
import {
  listPendingApprovalRequests,
  startSession,
  getAgentToolSessionContext,
  getCodexSession,
  steerTurn,
  sendMessage,
  followUpTurn,
  interruptTurn,
  stopSession,
  stopAllSessions,
  subscribeToCodexEvents,
  type CodexEventSubscription,
} from '../codex-session.service.js';

const INIT_RESULT = (loadSession: boolean) => ({
  jsonrpc: '2.0',
  id: 'init-1',
  result: {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession,
      promptCapabilities: { image: true, embeddedContext: true },
    },
  },
});

async function waitForSpawn(): Promise<void> {
  await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalled(), { timeout: 2000 });
}

async function startAcpSession(
  proc: FakeAcpProcess,
  options?: Parameters<typeof startSession>[3],
  personaId = 'coder',
) {
  mocks.spawnResults.push(proc);
  const started = startSession(['/repo'], ['r1'], personaId, options);
  // startSession awaits the env build before spawning — emit only once the
  // fake process's stdout listeners are attached.
  await waitForSpawn();
  emit(proc, INIT_RESULT(true));
  emit(proc, { jsonrpc: '2.0', id: 's1', result: { sessionId: 'acp-1' } });
  return started;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function acknowledgeLastRequest(proc: FakeAcpProcess, method: string): Promise<void> {
  await vi.waitFor(() => expect(writtenRequests(proc, method).length).toBeGreaterThan(0));
  const request = writtenRequests(proc, method).at(-1);
  expect(request?.id).toBeDefined();
  emit(proc, { jsonrpc: '2.0', id: request?.id, result: {} });
  await tick();
}

async function sendConfiguredMessage(
  proc: FakeAcpProcess,
  sessionId: string,
  message: string,
): Promise<void> {
  const sending = sendMessage(sessionId, message, [], {});
  expect(writtenRequests(proc, 'session/prompt')).toHaveLength(0);
  await acknowledgeLastRequest(proc, 'session/set_mode');
  expect(writtenRequests(proc, 'session/prompt')).toHaveLength(0);
  await acknowledgeLastRequest(proc, 'session/set_config_option');
  expect(writtenRequests(proc, 'session/set_config_option').at(-1)?.params).toMatchObject({
    configId: 'model',
    value: 'default',
  });
  await sending;
}

describe('ACP session parity (cursor/devin)', () => {
  let events: CodexEventSubscription[];
  let unsubscribe: () => void;

  beforeEach(() => {
    events = [];
    mocks.timeline = [];
    mocks.persistedEventTypes = [];
    unsubscribe = subscribeToCodexEvents((payload) => {
      events.push(payload);
      mocks.timeline.push(`event:${payload.event.type}`);
    });
    mocks.settings.llmProvider = 'cursor';
    mocks.settings.codexMode = 'workspace-auto';
    mocks.personas['coder'] = {
      capabilities: { canWriteFiles: true, canRunCommands: true, canReadFiles: true },
    };
    mocks.personas['reader'] = {
      capabilities: { canWriteFiles: false, canRunCommands: false, canReadFiles: true },
    };
  });

  afterEach(() => {
    unsubscribe();
    stopAllSessions();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('reports truthful capabilities: ACP mid-turn sends queue, goals are unsupported', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);

    expect(session.capabilities).toMatchObject({
      resumable: true,
      midTurnSend: 'queue',
      followUp: { guide: false, queue: true },
      readOnlySession: false,
      goals: false,
      accessModes: ['ask', 'agent', 'plan'],
    });
    expect(session.continuity).toBe('new');
    expect(session.resumable).toBe(true);
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'cursor-agent',
      ['acp'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('resumes via session/load when the agent advertises loadSession', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc, {
      provider: 'cursor',
      providerThreadId: 'acp-old',
    });

    const loads = writtenRequests(proc, 'session/load');
    expect(loads).toHaveLength(1);
    expect(loads[0].params).toMatchObject({ sessionId: 'acp-old' });
    expect(writtenRequests(proc, 'session/new')).toHaveLength(0);
    expect(session.continuity).toBe('resumed');
    expect(session.resumable).toBe(true);
  });

  it('falls back to session/new and reports transcript-seeded when loadSession is not advertised', async () => {
    const proc = createFakeAcpProcess();
    mocks.spawnResults.push(proc);
    const started = startSession(['/repo'], ['r1'], 'coder', {
      provider: 'cursor',
      providerThreadId: 'acp-gone',
    });
    await waitForSpawn();
    // session/new must be deferred until the initialize result arrives
    expect(writtenRequests(proc, 'session/new')).toHaveLength(0);
    emit(proc, INIT_RESULT(false));
    expect(writtenRequests(proc, 'session/new')).toHaveLength(1);
    emit(proc, { jsonrpc: '2.0', id: 's1', result: { sessionId: 'acp-2' } });
    const session = await started;

    expect(session.continuity).toBe('transcript-seeded');
    expect(session.resumable).toBe(false);
    expect(session.capabilities?.resumable).toBe(false);
  });

  it('reports an ACP fork as transcript-seeded, never protocol-forked', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc, {
      provider: 'cursor',
      forkFromProviderThreadId: 'acp-source',
    });

    expect(writtenRequests(proc, 'session/new')).toHaveLength(1);
    expect(writtenRequests(proc, 'session/load')).toHaveLength(0);
    expect(session.continuity).toBe('transcript-seeded');
  });

  it('rejects read-only personas before spawning an ACP provider', async () => {
    await expect(startSession(['/repo'], ['r1'], 'reader', { provider: 'cursor' })).rejects.toThrow(
      'read-only sandbox',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('queues a busy-send and flushes it via session/prompt when the turn completes (H2)', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);

    await sendConfiguredMessage(proc, session.id, 'first message');
    // The public session snapshot above is stale — internally the session is
    // now 'busy', which is what routes the steer into the queue.

    const result = await steerTurn(session.id, 'also handle this', []);
    expect(result).toMatchObject({
      disposition: 'queued',
      queueDepth: 1,
      requestId: expect.any(String),
    });
    expect(
      events.some((e) => e.event.type === 'queue_update' && e.event.queuedSendCount === 1),
    ).toBe(true);

    // Turn completes → queued message is delivered as a new prompt.
    emit(proc, { jsonrpc: '2.0', id: 't1', result: { stopReason: 'end_turn' } });
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await tick();
    await tick();

    const prompts = writtenRequests(proc, 'session/prompt');
    const queuedPrompt = prompts.at(-1);
    expect(queuedPrompt?.params).toMatchObject({ sessionId: 'acp-1' });
    expect(JSON.stringify(queuedPrompt?.params)).toContain('also handle this');
    expect(
      events.some((e) => e.event.type === 'queue_update' && e.event.queuedSendCount === 0),
    ).toBe(true);
  });

  it('deduplicates explicit queue retries and rejects a reused requestId with changed content', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    vi.setSystemTime(new Date('2026-11-08T10:00:00.000Z'));

    const request = {
      sessionId: session.id,
      requestId: 'follow-up-1',
      intent: 'queue' as const,
      message: 'run the next task',
      attachments: [],
    };
    expect(await followUpTurn(request)).toMatchObject({ status: 'queued', queueDepth: 1 });
    expect(await followUpTurn(request)).toMatchObject({ status: 'queued', queueDepth: 1 });
    expect(await followUpTurn({ ...request, message: 'different content' })).toMatchObject({
      status: 'failed',
      queueDepth: 1,
    });
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);

    const deliveredAt = '2026-11-08T10:02:00.000Z';
    vi.setSystemTime(new Date(deliveredAt));
    emit(proc, { jsonrpc: '2.0', id: 't-follow-up', result: { stopReason: 'end_turn' } });
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await tick();
    await tick();

    const prompts = writtenRequests(proc, 'session/prompt');
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1].params)).toContain('run the next task');
    expect(
      events
        .filter((item) => item.event.type === 'follow_up_delivery')
        .map((item) => item.event.followUpStatus),
    ).toEqual(['queued', 'delivered']);

    expect(await followUpTurn(request)).toMatchObject({
      status: 'delivered',
      queueDepth: 0,
      startedAt: deliveredAt,
    });
    expect(
      events.findLast((item) => item.event.type === 'follow_up_delivery')?.event.followUpStartedAt,
    ).toBe(deliveredAt);
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(2);
  });

  it('queues a simultaneous idle follow-up while the first send is preparing', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    const first = followUpTurn({
      sessionId: session.id,
      requestId: 'first-idle',
      intent: 'queue',
      message: 'first',
    });
    const second = followUpTurn({
      sessionId: session.id,
      requestId: 'second-idle',
      intent: 'queue',
      message: 'second',
    });
    expect(await second).toMatchObject({ status: 'queued', queueDepth: 1 });
    expect(getCodexSession(session.id)?.status).toBe('busy');
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    expect(await first).toMatchObject({ status: 'delivered' });
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);
    emit(proc, { jsonrpc: '2.0', id: 'first-complete', result: { stopReason: 'end_turn' } });
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await tick();
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(2);
    expect(
      await followUpTurn({
        sessionId: session.id,
        requestId: 'second-idle',
        intent: 'queue',
        message: 'second',
      }),
    ).toMatchObject({ status: 'delivered' });
  });

  it('fails queued work on interruption and does not start it automatically', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    const request = {
      sessionId: session.id,
      requestId: 'follow-up-after-interrupt',
      intent: 'queue' as const,
      message: 'next task',
    };
    await followUpTurn(request);

    emit(proc, { jsonrpc: '2.0', id: 't-cancelled', result: { stopReason: 'cancelled' } });
    await tick();

    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);
    expect(
      events.find(
        (item) =>
          item.event.type === 'follow_up_delivery' &&
          item.event.followUpRequestId === request.requestId &&
          item.event.followUpStatus === 'failed',
      )?.event.followUpError,
    ).toContain('interrupted');
  });

  it('fails queued follow-ups when the active ACP prompt is rejected', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    const activePrompt = writtenRequests(proc, 'session/prompt').at(-1);
    expect(activePrompt?.id).toBeDefined();
    const request = {
      sessionId: session.id,
      requestId: 'follow-up-active-prompt-rejected',
      intent: 'queue' as const,
      message: 'next task',
    };
    await followUpTurn(request);

    emit(proc, {
      jsonrpc: '2.0',
      id: activePrompt?.id,
      error: { message: 'active prompt rejected' },
    });

    expect(await followUpTurn(request)).toMatchObject({ status: 'failed' });
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);
    expect(
      events.some(
        (item) => item.event.type === 'turn_outcome' && item.event.turnOutcome === 'failed',
      ),
    ).toBe(true);
  });

  it('keeps queued work if an interrupt could not be sent and drains it after completion', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    const request = {
      sessionId: session.id,
      requestId: 'follow-up-cancel-write-failed',
      intent: 'queue' as const,
      message: 'next task',
    };
    await followUpTurn(request);

    proc.stdin.writable = false;
    expect(() => interruptTurn(session.id)).toThrow('could not accept the cancel request');
    expect(await followUpTurn(request)).toMatchObject({ status: 'queued', queueDepth: 1 });

    proc.stdin.writable = true;
    emit(proc, { jsonrpc: '2.0', id: 't-not-cancelled', result: { stopReason: 'end_turn' } });
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await tick();
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(2);
    expect(await followUpTurn(request)).toMatchObject({ status: 'delivered' });
  });

  it('fails queued follow-up without sending it when ACP rejects mode setup', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    const request = {
      sessionId: session.id,
      requestId: 'follow-up-mode-rejected',
      intent: 'queue' as const,
      message: 'next task',
    };
    await followUpTurn(request);

    emit(proc, {
      jsonrpc: '2.0',
      id: 't-before-mode-rejection',
      result: { stopReason: 'end_turn' },
    });
    await vi.waitFor(() => expect(writtenRequests(proc, 'session/set_mode').length).toBe(2));
    const modeRequest = writtenRequests(proc, 'session/set_mode').at(-1);
    expect(modeRequest?.id).toBeDefined();
    emit(proc, {
      jsonrpc: '2.0',
      id: modeRequest?.id,
      error: { message: 'mode cannot be changed' },
    });
    await tick();

    expect(await followUpTurn(request)).toMatchObject({ status: 'failed' });
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);
  });

  it('settles a dequeued follow-up if the session stops while provider setup awaits an ack', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    const request = {
      sessionId: session.id,
      requestId: 'follow-up-stop-race',
      intent: 'queue' as const,
      message: 'next task',
    };
    await followUpTurn(request);

    emit(proc, { jsonrpc: '2.0', id: 't-before-stop', result: { stopReason: 'end_turn' } });
    await vi.waitFor(() => expect(writtenRequests(proc, 'session/set_mode').length).toBe(2));
    stopSession(session.id);
    await tick();

    expect(
      events.some(
        (item) =>
          item.event.type === 'follow_up_delivery' &&
          item.event.followUpRequestId === request.requestId &&
          item.event.followUpStatus === 'failed' &&
          item.event.followUpError?.includes('session stopped'),
      ),
    ).toBe(true);
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);
  });

  it('updates a delivered receipt if the provider later rejects its prompt', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'active work');
    const request = {
      sessionId: session.id,
      requestId: 'follow-up-provider-error',
      intent: 'queue' as const,
      message: 'next task',
    };
    await followUpTurn(request);
    const laterRequest = {
      ...request,
      requestId: 'follow-up-after-provider-error',
      message: 'task after that',
    };
    await followUpTurn(laterRequest);

    emit(proc, { jsonrpc: '2.0', id: 't-complete', result: { stopReason: 'end_turn' } });
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await tick();
    await tick();
    const queuedPrompt = writtenRequests(proc, 'session/prompt').at(-1);
    expect(queuedPrompt?.id).toBeDefined();
    emit(proc, {
      jsonrpc: '2.0',
      id: queuedPrompt?.id,
      error: { message: 'prompt rejected' },
    });

    expect(await followUpTurn(request)).toMatchObject({ status: 'failed' });
    expect(await followUpTurn(laterRequest)).toMatchObject({ status: 'failed' });
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(2);
    expect(
      events.some(
        (item) =>
          item.event.type === 'follow_up_delivery' &&
          item.event.followUpRequestId === request.requestId &&
          item.event.followUpStatus === 'failed' &&
          item.event.followUpError?.includes('prompt rejected'),
      ),
    ).toBe(true);
  });

  it('persists terminal outcomes before the next queued task is dispatched', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc, { threadId: 'thread-terminal' });
    await sendConfiguredMessage(proc, session.id, 'active work');
    await followUpTurn({
      sessionId: session.id,
      requestId: 'follow-up-terminal-order',
      intent: 'queue',
      message: 'next task',
    });

    emit(proc, { jsonrpc: '2.0', id: 't-terminal-order', result: { stopReason: 'end_turn' } });
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await tick();
    await tick();

    const persistedAt = mocks.timeline.indexOf('persist:turn_outcome');
    const deliveredAt = mocks.timeline.indexOf('event:turn_outcome');
    const followUpAt = mocks.timeline.lastIndexOf('event:follow_up_delivery');
    expect(persistedAt).toBeGreaterThanOrEqual(0);
    expect(persistedAt).toBeLessThan(deliveredAt);
    expect(deliveredAt).toBeLessThan(followUpAt);
    expect(mocks.persistedEventTypes).toContain('follow_up_delivery');
    expect(events.find((item) => item.event.type === 'follow_up_delivery')?.event.persistedBy).toBe(
      'main',
    );
  });

  it('rejects read-only ACP sessions because ask mode cannot enforce the contract', async () => {
    const start = startSession(['/repo'], ['r1'], 'coder', {
      provider: 'cursor',
      codexMode: 'read-only',
    });
    await expect(start).rejects.toThrow('cannot guarantee a provider-enforced read-only session');
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('sends immediately when the ACP session is idle', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);

    const sending = steerTurn(session.id, 'hello', []);
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    const result = await sending;
    expect(result).toMatchObject({
      disposition: 'sent',
      queueDepth: 0,
      requestId: expect.any(String),
      startedAt: expect.any(String),
    });
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(1);
  });

  it('registers ACP permission requests as pending approvals for companion/statusbar (H8)', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'run a thing');

    emit(proc, {
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: {
        sessionId: 'acp-1',
        toolCall: { title: 'Run tests', kind: 'execute', rawInput: { command: 'npm test' } },
        options: [{ optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' }],
      },
    });

    const pending = listPendingApprovalRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      sessionId: session.id,
      kind: 'permissions',
    });
  });
  it('auto-approves Cursor tool requests only while the thread has Full access', async () => {
    mocks.settings.codexMode = 'full-access';
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'run tests');
    emit(proc, {
      jsonrpc: '2.0',
      id: 'full-perm',
      method: 'session/request_permission',
      params: {
        sessionId: 'acp-1',
        toolCall: { title: 'Run tests', kind: 'execute' },
        options: [{ optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' }],
      },
    });
    expect(listPendingApprovalRequests()).toHaveLength(0);
    expect(
      proc.written.some((line) => line.includes('full-perm') && line.includes('allow-once')),
    ).toBe(true);
    expect(events.some((e) => e.event.type === 'approval_request')).toBe(false);
  });

  it('uses Codex automatic approval review without changing the workspace sandbox', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc, { provider: 'codex' });
    await sendMessage(session.id, 'implement', [], {
      permissionMode: 'on-request',
      permissionProfile: 'auto-review',
    });
    expect(writtenRequests(proc, 'turn/start').at(-1)?.params).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxPolicy: { type: 'workspaceWrite' },
    });
    emit(proc, {
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { id: 'first', status: 'completed' } },
    });
    await sendMessage(session.id, 'next', [], {
      permissionMode: 'on-request',
      permissionProfile: 'default',
    });
    expect(writtenRequests(proc, 'turn/start').at(-1)?.params).toMatchObject({
      approvalsReviewer: 'user',
    });
  });
  it('reads the access modes advertised by the live ACP session', async () => {
    const proc = createFakeAcpProcess();
    mocks.spawnResults.push(proc);
    const starting = startSession(['/repo'], ['r1'], 'coder', { provider: 'devin' });
    await waitForSpawn();
    emit(proc, INIT_RESULT(true));
    emit(proc, {
      jsonrpc: '2.0',
      id: 's1',
      result: {
        sessionId: 'acp-1',
        modes: {
          availableModes: [{ id: 'accept-edits', name: 'Code' }],
          currentModeId: 'accept-edits',
        },
      },
    });
    const session = await starting;
    expect(session.capabilities?.accessModes).toEqual(['accept-edits']);
    await expect(
      sendMessage(session.id, 'run', [], { permissionMode: 'full-access' }),
    ).rejects.toThrow('does not advertise');
    expect(writtenRequests(proc, 'session/prompt')).toHaveLength(0);
  });
  it('keeps effective and selected access unchanged when ACP rejects a transition', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc);
    await sendConfiguredMessage(proc, session.id, 'first');
    emit(proc, { jsonrpc: '2.0', id: 'first', result: { stopReason: 'end_turn' } });
    const before = getAgentToolSessionContext(session.id);
    const changing = sendMessage(session.id, 'next', [], { permissionMode: 'full-access' });
    const rejected = expect(changing).rejects.toThrow('rejected');
    await vi.waitFor(() => expect(writtenRequests(proc, 'session/set_mode')).toHaveLength(2));
    expect(getAgentToolSessionContext(session.id)).toEqual(before);
    emit(proc, {
      jsonrpc: '2.0',
      id: writtenRequests(proc, 'session/set_mode').at(-1)?.id,
      error: { message: 'blocked' },
    });
    await rejected;
    expect(getAgentToolSessionContext(session.id)).toEqual(before);
    expect(getCodexSession(session.id)?.mode).toBe('workspace-auto');
  });
  it('preserves automatic approval review across a Plan turn and an optionless queued follow-up', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc, {
      provider: 'codex',
      codexMode: 'on-request',
      permissionProfile: 'auto-review',
    });
    await sendMessage(session.id, 'plan', [], { collaborationMode: 'plan' });
    await acknowledgeLastRequest(proc, 'turn/start');
    expect(getAgentToolSessionContext(session.id)?.mode).toBe('read-only');
    await followUpTurn({
      sessionId: session.id,
      requestId: 'after-plan',
      intent: 'queue',
      message: 'implement',
    });
    emit(proc, {
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { id: 'plan', status: 'completed' } },
    });
    await vi.waitFor(() => expect(writtenRequests(proc, 'turn/start')).toHaveLength(2));
    expect(writtenRequests(proc, 'turn/start').at(-1)?.params).toMatchObject({
      approvalsReviewer: 'auto_review',
      sandboxPolicy: { type: 'workspaceWrite' },
    });
  });
  it('selects Claude’s eligible model before enabling Auto review', async () => {
    const proc = createFakeAcpProcess();
    const session = await startAcpSession(proc, {
      provider: 'claude',
      codexMode: 'on-request',
      permissionProfile: 'auto-review',
    });
    const sending = sendMessage(session.id, 'work', [], { model: 'opus' });
    await vi.waitFor(() =>
      expect(writtenRequests(proc, 'session/set_config_option')).toHaveLength(1),
    );
    expect(writtenRequests(proc, 'session/set_mode')).toHaveLength(0);
    await acknowledgeLastRequest(proc, 'session/set_config_option');
    await acknowledgeLastRequest(proc, 'session/set_mode');
    await sending;
    expect(writtenRequests(proc, 'session/set_mode').at(-1)?.params).toMatchObject({
      modeId: 'auto',
    });
  });
});
