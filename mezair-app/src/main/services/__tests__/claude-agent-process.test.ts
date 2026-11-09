import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentProcess } from '../claude-agent-process';
import { parseClaudeAuthStatus } from '../claude-bridge.service';
import { resolveClaudeModel } from '../../../shared/claude-models';

const mocks = vi.hoisted(() => ({ query: vi.fn(), detect: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }));
vi.mock('../claude-bridge.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../claude-bridge.service')>()),
  detectClaudeCli: mocks.detect,
}));

class Messages {
  private pending: unknown[] = [];
  private wake?: () => void;
  private ended = false;
  push(value: unknown) {
    this.pending.push(value);
    this.wake?.();
  }
  close() {
    this.ended = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (!this.ended) {
      if (this.pending.length) yield this.pending.shift();
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }
}

let messages: Messages;
let proc: ClaudeAgentProcess;
let output: Array<Record<string, unknown>>;
let options: Options;
let sequence = 0;
const setModel = vi.fn();
const setPermissionMode = vi.fn();
const interrupt = vi.fn();

function send(method: string, params: Record<string, unknown> = {}) {
  const id = ++sequence;
  proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return id;
}

async function start(resume?: string) {
  send(resume ? 'session/load' : 'session/new', {
    cwd: '/tmp/claude-fixture',
    ...(resume ? { sessionId: resume } : {}),
    _meta: { systemPrompt: 'Persona prompt' },
    mcpServers: [
      {
        type: 'http',
        name: 'mezair',
        url: 'http://127.0.0.1:1/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer fixture-token' }],
      },
    ],
  });
  await vi.waitFor(() =>
    expect(output.some((line) => (line.result as { sessionId?: string })?.sessionId)).toBe(true),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  messages = new Messages();
  output = [];
  mocks.detect.mockResolvedValue({
    installed: true,
    path: '/local/bin/claude',
    authenticated: true,
  });
  mocks.query.mockImplementation((input) => {
    options = input.options;
    return {
      initializationResult: async () => ({}),
      setModel,
      setPermissionMode,
      interrupt,
      close: () => messages.close(),
      [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
    };
  });
  proc = new ClaudeAgentProcess({ HOME: '/fixture-home' }, 'auto');
  proc.stdout.on('data', (chunk) => output.push(JSON.parse(chunk.toString())));
});
afterEach(() => {
  proc.kill();
  messages.close();
});

describe('Claude Code provider', () => {
  it('rechecks scope after CLI detection before creating the SDK query', async () => {
    let allowed = true;
    const guard = () => {
      if (!allowed) throw new Error('Scope removed');
    };
    proc.kill();
    proc = new ClaudeAgentProcess({}, 'auto', guard);
    proc.stdout.on('data', (chunk) => output.push(JSON.parse(chunk.toString())));
    let finish!: (status: { installed: boolean; path: string }) => void;
    mocks.detect.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    send('session/new', { cwd: '/tmp/fixture' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    allowed = false;
    finish({ installed: true, path: '/bin/claude' });
    await vi.waitFor(() =>
      expect(output.some((line) => JSON.stringify(line).includes('Scope removed'))).toBe(true),
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rechecks scope at the actual SDK child spawn boundary', async () => {
    let allowed = true;
    proc.kill();
    proc = new ClaudeAgentProcess({}, 'auto', () => {
      if (!allowed) throw new Error('Scope removed');
    });
    proc.stdout.on('data', (chunk) => output.push(JSON.parse(chunk.toString())));
    await start();
    allowed = false;
    expect(() =>
      options.spawnClaudeCodeProcess!({
        command: '/never-spawn',
        args: [],
        cwd: '/tmp',
        env: {},
      } as never),
    ).toThrow('Scope removed');
  });

  it('parses only credential-free login status', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"email":"private@example.test"}')).toBe(true);
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe(false);
    expect(parseClaudeAuthStatus('unexpected output')).toBeUndefined();
  });

  it('preserves the CLI default and supports explicit model selection', () => {
    expect(resolveClaudeModel('auto')).toBeUndefined();
    expect(resolveClaudeModel('gpt-6.1-sol')).toBeUndefined();
    expect(resolveClaudeModel('haiku')).toBe('haiku');
    expect(resolveClaudeModel('fable')).toBe('fable');
    expect(resolveClaudeModel('default')).toBe('default');
    expect(resolveClaudeModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it.each([
    ['auto', 'auto'],
    ['dont-ask', 'dontAsk'],
  ] as const)('applies native %s approvals before prompting', async (modeId, expected) => {
    await start();
    send('session/set_mode', { modeId });
    await vi.waitFor(() => expect(setPermissionMode).toHaveBeenCalledWith(expected));
  });
  it('uses the installed CLI, user settings, persona prompt and stdin MCP config', async () => {
    await start();
    expect(options.pathToClaudeCodeExecutable).toBe('/local/bin/claude');
    expect(options.model).toBeUndefined();
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
    expect(options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'Persona prompt',
    });
    expect(options.mcpServers?.mezair).toMatchObject({
      type: 'http',
      headers: { Authorization: 'Bearer fixture-token' },
    });
    expect(options.env).toEqual({ HOME: '/fixture-home' });
  });

  it('resumes the same native session rather than silently starting fresh', async () => {
    await start('native-session');
    expect(options.resume).toBe('native-session');
    expect(options.sessionId).toBeUndefined();
  });

  it('cannot spawn a late SDK child after stop during CLI detection', async () => {
    let finishDetection: (value: unknown) => void = () => undefined;
    mocks.detect.mockReturnValue(
      new Promise((resolve) => {
        finishDetection = resolve;
      }),
    );
    send('session/new', { cwd: '/tmp/claude-fixture' });
    proc.kill();
    finishDetection({ installed: true, path: '/local/bin/claude', authenticated: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('records successful edits from actual before and after file contents', async () => {
    await start();
    const directory = await mkdtemp(join(tmpdir(), 'mezair-claude-edit-test-'));
    const file = join(directory, 'example.txt');
    try {
      await writeFile(file, 'before\n');
      const base = {
        session_id: 'session',
        transcript_path: '',
        cwd: directory,
        tool_name: 'Edit',
        tool_use_id: 'edit-1',
        tool_input: { file_path: file, old_string: 'before', new_string: 'after' },
      };
      await options.hooks!.PreToolUse![0].hooks[0](
        { ...base, hook_event_name: 'PreToolUse' },
        'edit-1',
        { signal: new AbortController().signal },
      );
      expect(output.some((line) => JSON.stringify(line).includes('oldText'))).toBe(false);
      await writeFile(file, 'after\n');
      await options.hooks!.PostToolUse![0].hooks[0](
        { ...base, hook_event_name: 'PostToolUse', tool_response: {} },
        'edit-1',
        { signal: new AbortController().signal },
      );
      expect(output).toContainEqual(
        expect.objectContaining({
          params: {
            sessionId: expect.any(String),
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'edit-1',
              content: [{ type: 'diff', path: file, oldText: 'before\n', newText: 'after\n' }],
            },
          },
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('applies selected models and restores the CLI default after a change', async () => {
    await start();
    send('session/set_config_option', { configId: 'model', value: 'opus' });
    send('session/set_config_option', { configId: 'model', value: 'auto' });
    await vi.waitFor(() => expect(setModel).toHaveBeenCalledTimes(2));
    expect(setModel.mock.calls).toEqual([['opus'], [undefined]]);
    send('session/set_mode', { modeId: 'accept-edits' });
    await vi.waitFor(() => expect(setPermissionMode).toHaveBeenCalledWith('acceptEdits'));
  });

  it('streams parent text once and leaves subagent text in its own tool', async () => {
    await start();
    messages.push({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start' },
    });
    messages.push({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    });
    messages.push({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'Hello' }] },
    });
    messages.push({
      type: 'assistant',
      parent_tool_use_id: 'child',
      message: { content: [{ type: 'text', text: 'Child text' }] },
    });
    await vi.waitFor(() =>
      expect(output.filter((line) => line.method === 'session/update')).toHaveLength(1),
    );
  });

  it('keeps the SDK permission callback pending until the user responds', async () => {
    await start();
    const permission = options.canUseTool!(
      'Bash',
      { command: 'git status' },
      { requestId: 'request-1', signal: new AbortController().signal, toolUseID: 'tool-1' },
    );
    const request = output.find((line) => line.method === 'session/request_permission')!;
    expect(request).toBeDefined();
    proc.stdin.write(
      `${JSON.stringify({ id: request.id, result: { outcome: { outcome: 'selected', optionId: 'deny' } } })}\n`,
    );
    await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('returns native question answers through Mezair input controls', async () => {
    await start();
    const permission = options.canUseTool!(
      'AskUserQuestion',
      { questions: [{ header: 'Theme', question: 'Which theme?', options: [{ label: 'Dark' }] }] },
      { requestId: 'request-1', signal: new AbortController().signal, toolUseID: 'question-1' },
    );
    const request = output.find((line) => line.method === 'item/tool/requestUserInput')!;
    proc.stdin.write(
      `${JSON.stringify({ id: request.id, result: { answers: { '0': { answers: ['Dark'] } } } })}\n`,
    );
    await expect(permission).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Which theme?': 'Dark' } },
    });
  });

  it('reports provider errors and interruption as distinct terminal outcomes', async () => {
    await start();
    const id = send('session/prompt', { prompt: [{ type: 'text', text: 'hello' }] });
    send('session/cancel');
    messages.push({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Interrupted'],
    });
    await vi.waitFor(() =>
      expect(output).toContainEqual({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } }),
    );
    expect(interrupt).toHaveBeenCalled();
    const failedId = send('session/prompt', { prompt: [{ type: 'text', text: 'hello again' }] });
    messages.push({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Usage limit reached'],
    });
    await vi.waitFor(() =>
      expect(output.find((line) => line.id === failedId)?.error).toMatchObject({
        message: 'Usage limit reached',
      }),
    );
  });

  it('denies a pending permission request when the session stops', async () => {
    await start();
    const permission = options.canUseTool!(
      'Bash',
      {},
      { requestId: 'request-1', signal: new AbortController().signal, toolUseID: 'tool-1' },
    );
    proc.kill();
    await expect(permission).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('counts cumulative SDK usage once across turns, including cache tokens', async () => {
    await start();
    const usage = (inputTokens: number, outputTokens: number) => ({
      inputTokens,
      outputTokens,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
    });
    send('session/prompt', { prompt: [{ type: 'text', text: 'one' }] });
    messages.push({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'OK',
      total_cost_usd: 0.01,
      modelUsage: { haiku: usage(20, 3) },
    });
    await vi.waitFor(() =>
      expect(output.some((line) => (line.result as { stopReason?: string })?.stopReason)).toBe(
        true,
      ),
    );
    const rejectedId = send('session/prompt', { prompt: [{ type: 'text', text: 'retry' }] });
    messages.push({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Usage limit'],
      modelUsage: {},
      total_cost_usd: 0,
    });
    await vi.waitFor(() =>
      expect(output.find((line) => line.id === rejectedId)?.error).toBeDefined(),
    );
    send('session/prompt', { prompt: [{ type: 'text', text: 'two' }] });
    messages.push({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'OK',
      total_cost_usd: 0.02,
      modelUsage: { haiku: usage(30, 5) },
    });
    await vi.waitFor(() =>
      expect(
        output.filter(
          (line) =>
            (line.params as { update?: { sessionUpdate?: string } })?.update?.sessionUpdate ===
            'usage_update',
        ),
      ).toHaveLength(2),
    );
    const updates = output
      .filter(
        (line) =>
          (line.params as { update?: { sessionUpdate?: string } })?.update?.sessionUpdate ===
          'usage_update',
      )
      .map((line) => (line.params as { update: unknown }).update);
    expect(updates).toEqual([
      expect.objectContaining({
        tokens: { inputTokens: 35, cachedInputTokens: 10, outputTokens: 3 },
        costDelta: 0.01,
      }),
      expect.objectContaining({
        tokens: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 },
        costDelta: 0.01,
      }),
    ]);
  });
});
