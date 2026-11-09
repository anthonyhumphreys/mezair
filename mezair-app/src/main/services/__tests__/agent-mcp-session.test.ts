import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeProcess extends EventEmitter {
  pid: number;
  stdin: {
    writable: boolean;
    destroyed: boolean;
    writableEnded: boolean;
    write: (c: string) => boolean;
    on: () => unknown;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  written: string[];
}

function createFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.written = [];
  proc.pid = undefined as unknown as number;
  proc.stdin = {
    writable: true,
    destroyed: false,
    writableEnded: false,
    write: (chunk: string) => {
      proc.written.push(chunk);
      return true;
    },
    on: () => proc.stdin,
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

const emit = (proc: FakeProcess, payload: Record<string, unknown>) =>
  proc.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`));

const requests = (proc: FakeProcess, method: string) =>
  proc.written
    .flatMap((chunk) => chunk.split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((msg) => msg.method === method);

const mocks = vi.hoisted(() => ({
  settings: {
    llmProvider: 'codex',
    enabledLlmProviders: ['cursor', 'devin', 'codex', 'openai', 'azure', 'llmgateway'],
    codexMode: 'on-request',
    openaiModel: 'gpt-5.5',
    reasoningLevel: 'medium',
    userRole: 'ba-brm',
  } as Record<string, unknown>,
  membershipAllowed: true,
  onSpawn: undefined as (() => void) | undefined,
  runtime: vi.fn(async () => '/bin/codex'),
  spawnResults: [] as FakeProcess[],
  threads: new Map<
    string,
    { id?: string; repoIds?: string[]; temporary?: boolean; purpose?: string; workspaceId?: string }
  >(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const proc = mocks.spawnResults.shift();
    if (!proc) throw new Error('No fake process queued');
    mocks.onSpawn?.();
    return proc;
  }),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mezair-test', getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../chat-continuation.service.js', () => ({
  captureThreadContinuation: () => ({
    context: 'Saved conversation checkpoint',
    messages: [],
    artifactRefs: [],
  }),
  prependThreadContinuation: (context: string | undefined, message: string) =>
    context ? `${context}\nNewest user request:\n${message}` : message,
}));
vi.mock('../chat-session-scope.js', () => ({
  assertWorkspaceRepositoryMembership: () => {
    if (!mocks.membershipAllowed) throw new Error('repository is no longer in this workspace');
  },
}));
vi.mock('../settings.service.js', () => ({ getSettings: () => mocks.settings }));
vi.mock('../persona.service.js', () => ({
  getPersonaById: (id: string) => ({
    capabilities: { canWriteFiles: id !== 'reader', canRunCommands: true, canReadFiles: true },
  }),
  buildSystemPrompt: () => 'system prompt',
  buildDesignSystemPrompt: () => 'design prompt',
  buildScaffoldSystemPrompt: () => 'scaffold prompt',
  buildTemporaryChatSystemPrompt: () => 'temporary prompt',
}));
vi.mock('../mesh-ownership.service.js', () => ({ assertSessionTurnAllowed: () => undefined }));
vi.mock('../dojo-analytics.service.js', () => ({
  listDojoPrices: () => [],
  recordDojoExecutionEvent: () => undefined,
}));
vi.mock('../companion-events.service.js', () => ({ emitCompanionEvent: () => undefined }));
vi.mock('../chat-persistence.service.js', () => ({
  getChatThread: (id: string) => mocks.threads.get(id) ?? null,
  isTemporaryChatThread: (id: string) => mocks.threads.get(id)?.temporary === true,
  updateChatThreadAttention: () => undefined,
  setChatThreadProviderThreadId: vi.fn(),
}));
import { setChatThreadProviderThreadId } from '../chat-persistence.service.js';
vi.mock('../chat-evidence.service.js', () => ({ saveChatEvent: vi.fn() }));
vi.mock('../agent-ui-intent.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent-ui-intent.service.js')>()),
  expireAgentUIIntentsForSession: () => [],
  getAgentUIIntent: () => null,
}));
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
vi.mock('../codex-runtime.service.js', () => ({ resolveCodexRuntime: mocks.runtime }));

import { spawn } from 'node:child_process';
import {
  getAgentToolSessionContext,
  followUpTurn,
  steerTurn,
  emitLocalAssistantTurn,
  invalidateThreadAccess,
  captureThreadAccessFence,
  sendMessage,
  emitLocalAssistantTurnEnd,
  deliverStructuredAgentFeedback,
  startSession,
  stopAllSessions,
  stopSession,
} from '../codex-session.service.js';
import {
  getAgentMcpTokenForSession,
  resetAgentMcpRegistryForTests,
  resolveAgentMcpToken,
  setAgentMcpEndpoint,
} from '../agent-mcp/registry.js';
import { ROLE_FEATURES } from '../../../shared/types.js';

const URL = 'http://127.0.0.1:45555/mcp';

function lastSpawn(): { command: string; args: string[]; env: Record<string, string> } {
  const call = vi.mocked(spawn).mock.calls.at(-1)!;
  return {
    command: call[0] as string,
    args: call[1] as string[],
    env: (call[2] as { env: Record<string, string> }).env,
  };
}

async function startCodex(
  options: Parameters<typeof startSession>[3] = {},
  repoIds = ['r1', 'r2'],
  personaId = 'coder',
) {
  const proc = createFakeProcess();
  mocks.spawnResults.push(proc);
  const before = vi.mocked(spawn).mock.calls.length;
  if (options.threadId && !mocks.threads.has(options.threadId))
    mocks.threads.set(options.threadId, { id: options.threadId, repoIds });
  const started = startSession(
    repoIds.map((_, index) => (index === 0 ? '/repo' : `/repo-${index}`)),
    repoIds,
    personaId,
    { provider: 'codex', ...options },
  );
  await vi.waitFor(() => expect(vi.mocked(spawn).mock.calls.length).toBeGreaterThan(before));
  emit(proc, { jsonrpc: '2.0', method: 'thread/started', params: { thread: { id: 'th-1' } } });
  return { proc, session: await started };
}

async function startAcp(provider: 'cursor' | 'devin', mcpCapabilities?: Record<string, boolean>) {
  const proc = createFakeProcess();
  mocks.spawnResults.push(proc);
  mocks.threads.set('thread-1', { id: 'thread-1', repoIds: ['r1'] });
  const started = startSession(['/repo'], ['r1'], 'coder', { provider, threadId: 'thread-1' });
  await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalled());
  expect(requests(proc, 'session/new')).toHaveLength(0);
  emit(proc, {
    jsonrpc: '2.0',
    id: 'init',
    result: { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities } },
  });
  emit(proc, { jsonrpc: '2.0', id: 's1', result: { sessionId: 'acp-1' } });
  return { proc, session: await started };
}

describe('codex-session agent MCP wiring', () => {
  beforeEach(() => {
    mocks.membershipAllowed = true;
    mocks.settings.activeWorkspaceId = undefined;
    mocks.onSpawn = undefined;
    mocks.runtime.mockResolvedValue('/bin/codex');
    resetAgentMcpRegistryForTests();
    setAgentMcpEndpoint({ url: URL, port: 45555, shimPath: '/app/scripts/mezair-mcp-shim.mjs' });
    mocks.settings.userRole = 'ba-brm';
    mocks.threads.clear();
  });

  afterEach(() => {
    stopAllSessions();
    vi.clearAllMocks();
  });

  it.each(['codex', 'cursor'] as const)(
    'fences threadless %s restarts in their originating workspace',
    async (provider) => {
      mocks.settings.activeWorkspaceId = 'origin-workspace';
      const proc = createFakeProcess();
      mocks.spawnResults.push(proc);
      const started = startSession(['/repo'], ['r1'], 'design', { provider, designMode: 'design' });
      const rejected = expect(started).rejects.toThrow('no longer in this workspace');
      if (provider === 'codex')
        mocks.onSpawn = () => {
          mocks.membershipAllowed = false;
        };
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      mocks.settings.activeWorkspaceId = 'other-workspace';
      mocks.membershipAllowed = false;
      if (provider === 'cursor') {
        emit(proc, {
          jsonrpc: '2.0',
          id: 'init',
          result: { protocolVersion: 1, agentCapabilities: {} },
        });
        emit(proc, { jsonrpc: '2.0', id: 's1', result: { sessionId: 'native' } });
      } else
        emit(proc, {
          jsonrpc: '2.0',
          method: 'thread/started',
          params: { thread: { id: 'native' } },
        });
      await rejected;
      expect(requests(proc, provider === 'codex' ? 'thread/start' : 'session/new')).toHaveLength(0);
      mocks.settings.activeWorkspaceId = undefined;
    },
  );

  it('rechecks membership after asynchronous runtime resolution, before spawning', async () => {
    mocks.threads.set('startup', { repoIds: ['r1'], workspaceId: 'ws' });
    let release!: (runtime: string) => void;
    mocks.runtime.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const started = startSession(['/repo'], ['r1'], 'coder', {
      threadId: 'startup',
      provider: 'codex',
    });
    const rejected = expect(started).rejects.toThrow('no longer in this workspace');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    mocks.membershipAllowed = false;
    release('/bin/codex');
    await rejected;
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([{}, { providerThreadId: 'native' }, { forkFromProviderThreadId: 'native' }])(
    'fences Codex startup content and cleans up after a scope change: %j',
    async (options) => {
      const proc = createFakeProcess();
      mocks.spawnResults.push(proc);
      mocks.threads.set('startup', { repoIds: ['r1'], workspaceId: 'ws' });
      mocks.onSpawn = () => {
        mocks.membershipAllowed = false;
      };
      await expect(
        startSession(['/repo'], ['r1'], 'coder', {
          threadId: 'startup',
          provider: 'codex',
          ...options,
        }),
      ).rejects.toThrow('no longer in this workspace');
      for (const method of ['thread/start', 'thread/resume', 'thread/fork'])
        expect(requests(proc, method)).toHaveLength(0);
      expect(proc.kill).toHaveBeenCalled();
    },
  );

  it.each(['cursor', 'devin'] as const)(
    'fences late %s new/load without throwing through stdout',
    async (provider) => {
      for (const providerThreadId of [undefined, 'native']) {
        const proc = createFakeProcess();
        mocks.spawnResults.push(proc);
        mocks.membershipAllowed = true;
        mocks.threads.set('startup', { repoIds: ['r1'], workspaceId: 'ws' });
        const before = vi.mocked(spawn).mock.calls.length;
        const started = startSession(['/repo'], ['r1'], 'coder', {
          threadId: 'startup',
          provider,
          providerThreadId,
        });
        const rejected = expect(started).rejects.toThrow('no longer in this workspace');
        await vi.waitFor(() => expect(vi.mocked(spawn).mock.calls.length).toBeGreaterThan(before));
        mocks.membershipAllowed = false;
        expect(() =>
          emit(proc, {
            jsonrpc: '2.0',
            id: 'init',
            result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
          }),
        ).not.toThrow();
        await rejected;
        expect(requests(proc, 'session/new')).toHaveLength(0);
        expect(requests(proc, 'session/load')).toHaveLength(0);
        expect(proc.kill).toHaveBeenCalled();
      }
    },
  );

  it('denies detached-workspace guide, feedback, local output and tool context', async () => {
    mocks.threads.set('detachable', { repoIds: ['r1', 'r2'], workspaceId: 'ws' });
    const { proc, session } = await startCodex({ threadId: 'detachable' });
    await sendMessage(session.id, 'Allowed before removal');
    const request = requests(proc, 'turn/start').at(-1)!;
    emit(proc, { jsonrpc: '2.0', id: request.id, result: { turn: { id: 'active-turn' } } });
    emit(proc, { jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 'active-turn' } } });
    mocks.membershipAllowed = false;
    await expect(steerTurn(session.id, 'Not allowed after removal')).rejects.toThrow(
      'no longer in this workspace',
    );
    expect(
      await followUpTurn({
        sessionId: session.id,
        requestId: 'detached-guide',
        intent: 'guide',
        message: 'Not allowed',
      }),
    ).toMatchObject({ status: 'failed' });
    await expect(deliverStructuredAgentFeedback(session.id, 'Not allowed')).rejects.toThrow(
      'no longer in this workspace',
    );
    expect(() => emitLocalAssistantTurn(session.id, 'Do not emit')).toThrow(
      'no longer in this workspace',
    );
    expect(getAgentToolSessionContext(session.id)).toBeUndefined();
    expect(requests(proc, 'turn/steer')).toHaveLength(0);
  });

  it('injects the mezair server into Codex app-server args and the token into env only', async () => {
    const { session } = await startCodex({ threadId: 'thread-1' });
    const { command, args, env } = lastSpawn();
    const token = getAgentMcpTokenForSession(session.id)!;
    expect(command).toBe('codex');
    expect(args).toEqual([
      'app-server',
      '-c',
      `mcp_servers.mezair.url="${URL}"`,
      '-c',
      'mcp_servers.mezair.bearer_token_env_var="MEZAIR_MCP_TOKEN"',
      '-c',
      'mcp_servers.mezair.tool_timeout_sec=660',
    ]);
    expect(env.MEZAIR_MCP_TOKEN).toBe(token);
    expect(args.join(' ')).not.toContain(token);
  });

  it('resolves the live session context and revokes the token on stop', async () => {
    const { session } = await startCodex({
      threadId: 'thread-1',
      workspace: { workspaceId: 'ws-1' },
    });
    const token = getAgentMcpTokenForSession(session.id)!;
    expect(resolveAgentMcpToken(token)?.context).toEqual({
      sessionId: session.id,
      appThreadId: 'thread-1',
      workspaceId: 'ws-1',
      repoIds: ['r1', 'r2'],
      provider: 'codex',
      mode: 'on-request',
      permissionProfile: 'default',
      accessRevision: 0,
      authorityId: expect.any(Number),
      features: ROLE_FEATURES['ba-brm'],
    });
    mocks.settings.userRole = undefined;
    expect(getAgentToolSessionContext(session.id)?.features).toEqual([]);

    stopSession(session.id);
    expect(getAgentMcpTokenForSession(session.id)).toBeUndefined();
    expect(resolveAgentMcpToken(token)).toBeUndefined();
    expect(getAgentToolSessionContext(session.id)).toBeUndefined();
  });

  it('retires old credentials before accepting an access reduction and issues a fresh bearer on restart', async () => {
    const { session } = await startCodex({
      threadId: 'thread-1',
      workspace: { workspaceId: 'ws-1' },
      codexMode: 'full-access',
    });
    const oldToken = getAgentMcpTokenForSession(session.id)!;
    expect(resolveAgentMcpToken(oldToken)?.context.mode).toBe('full-access');
    const invalidating = invalidateThreadAccess('thread-1');
    expect(resolveAgentMcpToken(oldToken)).toBeUndefined();
    await invalidating;
    const next = await startCodex({
      threadId: 'thread-1',
      workspace: { workspaceId: 'ws-1' },
      codexMode: 'read-only',
    });
    const newToken = getAgentMcpTokenForSession(next.session.id)!;
    expect(newToken).not.toBe(oldToken);
    expect(resolveAgentMcpToken(newToken)?.context.mode).toBe('read-only');
    await expect(
      sendMessage(next.session.id, 'escalate', [], { permissionMode: 'full-access' }),
    ).rejects.toThrow('fresh permissions');
    expect(resolveAgentMcpToken(oldToken)).toBeUndefined();
    expect(resolveAgentMcpToken(newToken)?.context.mode).toBe('read-only');
  });
  it('fences discovery that began before the session startup call', async () => {
    const assertStartAccess = captureThreadAccessFence('discovering-thread');
    await invalidateThreadAccess('discovering-thread');
    expect(assertStartAccess).toThrow('access changed');
    expect(captureThreadAccessFence('discovering-thread')).not.toThrow();
  });
  it('fences an access change during startup before a process or usable token can escape', async () => {
    const starting = startSession(['/repo'], ['r1'], 'coder', {
      provider: 'codex',
      threadId: 'starting-thread',
    });
    const rejected = expect(starting).rejects.toThrow('access changed');
    await invalidateThreadAccess('starting-thread');
    await rejected;
    expect(spawn).not.toHaveBeenCalled();
  });
  it('continues Plan feedback with the selected profile while retaining the read-only clamp', async () => {
    const { proc, session } = await startCodex({
      threadId: 'plan-feedback',
      permissionProfile: 'auto-review',
    });
    await sendMessage(session.id, 'Plan it', [], {
      permissionMode: 'on-request',
      permissionProfile: 'auto-review',
      collaborationMode: 'plan',
    });
    const first = requests(proc, 'turn/start').at(-1)!;
    emit(proc, { jsonrpc: '2.0', id: first.id, result: { turn: { id: 'plan-turn' } } });
    emit(proc, {
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { turn: { id: 'plan-turn', status: 'completed' } },
    });
    await expect(deliverStructuredAgentFeedback(session.id, 'Refine this step')).resolves.toBe(
      true,
    );
    const followup = requests(proc, 'turn/start').at(-1)!;
    expect(followup).not.toBe(first);
    expect(followup.params).toMatchObject({
      sandboxPolicy: { type: 'readOnly' },
      approvalsReviewer: 'auto_review',
    });
    expect(getAgentToolSessionContext(session.id)?.mode).toBe('read-only');
  });
  it('revokes the token when the provider process exits', async () => {
    const { proc, session } = await startCodex();
    expect(getAgentMcpTokenForSession(session.id)).toBeDefined();
    proc.emit('exit', 1, null);
    expect(getAgentMcpTokenForSession(session.id)).toBeUndefined();
  });

  it.each(['read-only', 'workspace-auto', 'full-access'] as const)(
    'normalizes inactive startup approval profiles for %s',
    async (mode) => {
      const { proc, session } = await startCodex({
        codexMode: mode,
        permissionProfile: 'auto-review',
      });
      expect(requests(proc, 'thread/start').at(-1)?.params).toMatchObject({
        approvalsReviewer: 'user',
      });
      await expect(
        sendMessage(session.id, 'Continue', [], { permissionMode: mode }),
      ).resolves.toBeUndefined();
    },
  );
  it('exposes issued access separately from a persona read-only clamp', async () => {
    const { session } = await startCodex({ codexMode: 'on-request' }, ['r1'], 'reader');
    expect(session).toMatchObject({ mode: 'read-only', requestedMode: 'on-request' });
    await expect(
      sendMessage(session.id, 'Continue', [], { permissionMode: 'on-request' }),
    ).resolves.toBeUndefined();
    await expect(
      sendMessage(session.id, 'Change requested access', [], { permissionMode: 'read-only' }),
    ).rejects.toThrow('fresh permissions');
  });
  it('pins read-only sessions to read-only tool context', async () => {
    const { session } = await startCodex({ codexMode: 'read-only' });
    expect(getAgentToolSessionContext(session.id)?.mode).toBe('read-only');
  });

  it('gives temporary chats no token and keeps every MCP server disabled', async () => {
    mocks.threads.set('tmp', { temporary: true });
    const { session } = await startCodex({ threadId: 'tmp', temporaryChat: true }, []);
    const { args, env } = lastSpawn();
    expect(args).toEqual(['app-server', '-c', 'mcp_servers={}']);
    expect(env.MEZAIR_MCP_TOKEN).toBeUndefined();
    expect(getAgentMcpTokenForSession(session.id)).toBeUndefined();
    expect(getAgentToolSessionContext(session.id)).toBeUndefined();
  });

  it('starts sessions without MCP when the endpoint is not running', async () => {
    setAgentMcpEndpoint(undefined);
    const { session } = await startCodex();
    expect(lastSpawn().args).toEqual(['app-server']);
    expect(getAgentMcpTokenForSession(session.id)).toBeUndefined();
  });

  it('attaches the http server to ACP session/new when advertised', async () => {
    const { proc, session } = await startAcp('cursor', { http: true, sse: true });
    const token = getAgentMcpTokenForSession(session.id)!;
    expect(lastSpawn().args).toEqual(['acp']);
    expect(lastSpawn().env.MEZAIR_MCP_TOKEN).toBeUndefined();
    expect(requests(proc, 'session/new')[0].params).toMatchObject({
      mcpServers: [
        {
          type: 'http',
          name: 'mezair',
          url: URL,
          headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
        },
      ],
    });
  });

  it('falls back to the stdio shim when the ACP agent does not advertise http', async () => {
    const { proc, session } = await startAcp('devin');
    const token = getAgentMcpTokenForSession(session.id)!;
    expect(requests(proc, 'session/new')[0].params).toMatchObject({
      mcpServers: [
        {
          name: 'mezair',
          command: process.execPath,
          args: ['/app/scripts/mezair-mcp-shim.mjs'],
          env: [
            { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
            { name: 'MEZAIR_MCP_URL', value: URL },
            { name: 'MEZAIR_MCP_TOKEN', value: token },
          ],
        },
      ],
    });
  });

  it('attaches the server to ACP session/load on resume', async () => {
    const proc = createFakeProcess();
    mocks.spawnResults.push(proc);
    const started = startSession(['/repo'], ['r1'], 'coder', {
      provider: 'cursor',
      providerThreadId: 'acp-old',
    });
    await vi.waitFor(() => expect(vi.mocked(spawn)).toHaveBeenCalled());
    emit(proc, {
      jsonrpc: '2.0',
      id: 'init',
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
      },
    });
    emit(proc, { jsonrpc: '2.0', id: 's1', result: { sessionId: 'acp-old' } });
    const session = await started;
    expect(requests(proc, 'session/load')[0].params).toMatchObject({
      sessionId: 'acp-old',
      mcpServers: [{ type: 'http', name: 'mezair', url: URL }],
    });
    expect(getAgentMcpTokenForSession(session.id)).toBeDefined();
  });
});

describe('provider continuation', () => {
  afterEach(() => {
    stopAllSessions();
    vi.clearAllMocks();
    mocks.threads.clear();
  });
  it('seeds a fresh provider from the conversation exactly once', async () => {
    mocks.threads.set('thread-1', {});
    const { proc, session } = await startCodex({ threadId: 'thread-1' });
    expect(session.continuity).toBe('transcript-seeded');
    await sendMessage(session.id, 'Continue');
    expect(JSON.stringify(requests(proc, 'turn/start').at(-1))).toContain(
      'Saved conversation checkpoint',
    );
    await sendMessage(session.id, 'Next');
    expect(JSON.stringify(requests(proc, 'turn/start').at(-1))).not.toContain(
      'Saved conversation checkpoint',
    );
  });
  it('keeps native resume without duplicating the transcript', async () => {
    mocks.threads.set('thread-1', {});
    const { proc, session } = await startCodex({
      threadId: 'thread-1',
      providerThreadId: 'native-thread',
    });
    expect(session.continuity).toBe('resumed');
    await sendMessage(session.id, 'Continue');
    expect(JSON.stringify(requests(proc, 'turn/start').at(-1))).not.toContain(
      'Saved conversation checkpoint',
    );
  });
  it('refreshes a native provider after an on-device reply exactly once', async () => {
    mocks.threads.set('thread-1', {});
    const { proc, session } = await startCodex({
      threadId: 'thread-1',
      providerThreadId: 'native-thread',
    });
    emitLocalAssistantTurnEnd(session.id);
    expect(setChatThreadProviderThreadId).toHaveBeenCalledWith('thread-1', null, 'codex');
    await sendMessage(session.id, 'Continue after the on-device answer');
    expect(JSON.stringify(requests(proc, 'turn/start').at(-1))).toContain(
      'Saved conversation checkpoint',
    );
    await sendMessage(session.id, 'Next');
    expect(JSON.stringify(requests(proc, 'turn/start').at(-1))).not.toContain(
      'Saved conversation checkpoint',
    );
  });
});
