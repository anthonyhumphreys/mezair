import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import type {
  CanUseTool,
  McpServerConfig,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentProcess } from './agent-process.js';
import { detectClaudeCli } from './claude-bridge.service.js';
import { resolveClaudeModel } from '../../shared/claude-models.js';

type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

/**
 * Adapts the official SDK to Mezair's existing agent-client control stream.
 * Claude itself is not an ACP subprocess. Credentials stay in the local CLI;
 * session MCP credentials travel in the SDK's stdin initialization, never argv.
 */
export class ClaudeAgentProcess extends EventEmitter implements AgentProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  // Available after SDK initialization so the session can verify group teardown.
  get pid(): number | undefined {
    return this.child?.pid;
  }
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  private child?: ChildProcess;
  private query?: Query;
  private sessionId = '';
  private promptId?: string | number;
  private cancelled = false;
  private closed = false;
  private streamed = false;
  private buffer = '';
  private queued: SDKUserMessage[] = [];
  private wake?: () => void;
  private replies = new Map<string | number, (result: Record<string, unknown>) => void>();
  private tools = new Map<string, { name: string; input: Record<string, unknown> }>();
  private snapshots = new Map<string, { path: string; text: string | null | undefined }>();
  private usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  private cost = 0;
  private activeModel?: string;

  constructor(
    private readonly env: Record<string, string>,
    private readonly model: string,
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, done) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as RpcMessage;
            // Requests may run concurrently: a prompt must not block its approval reply.
            void this.handle(message).catch((error: unknown) => this.fail(message.id, error));
          } catch (error) {
            this.fail(undefined, error);
          }
        }
        done();
      },
    });
  }

  private send(message: Record<string, unknown>): void {
    if (!this.closed) this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private update(update: Record<string, unknown>): void {
    this.send({ method: 'session/update', params: { sessionId: this.sessionId, update } });
  }

  private fail(id: RpcMessage['id'], error: unknown): void {
    this.send({
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Claude Code request failed.',
      },
    });
  }

  private async handle(message: RpcMessage): Promise<void> {
    const { id, method, params = {} } = message;
    if (!method && id !== undefined) {
      this.replies.get(id)?.(message.result ?? {});
      return;
    }
    if (method === 'initialize') {
      // Defer so startSession can install its pending session-start state first.
      queueMicrotask(() =>
        this.send({
          id,
          result: {
            protocolVersion: 1,
            agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
          },
        }),
      );
    } else if (method === 'session/new' || method === 'session/load') {
      await this.start(params, method === 'session/load');
      this.send({ id, result: { sessionId: this.sessionId } });
    } else if (method === 'session/set_mode') {
      const modes = {
        agent: 'default',
        'accept-edits': 'acceptEdits',
        bypass: 'bypassPermissions',
        plan: 'plan',
        ask: 'plan',
      } as const;
      const mode = modes[params.modeId as keyof typeof modes];
      if (!mode) throw new Error('Unsupported Claude permission mode.');
      await this.requireQuery().setPermissionMode(mode);
      this.send({ id, result: {} });
    } else if (method === 'session/set_config_option') {
      await this.requireQuery().setModel(resolveClaudeModel(String(params.value ?? 'auto')));
      this.send({ id, result: {} });
    } else if (method === 'session/prompt') {
      if (this.promptId !== undefined) throw new Error('Claude Code is already running a turn.');
      const prompt = Array.isArray(params.prompt) ? params.prompt : [];
      const content: SDKUserMessage['message']['content'] = [];
      for (const block of prompt) {
        if (!block || typeof block !== 'object') continue;
        const item = block as Record<string, unknown>;
        if (item.type === 'text' && typeof item.text === 'string')
          content.push({ type: 'text', text: item.text });
        else if (item.type === 'resource_link' && typeof item.uri === 'string')
          content.push({ type: 'text', text: `Attached file: ${fileURLToPath(item.uri)}` });
      }
      this.promptId = id;
      this.cancelled = false;
      this.queued.push({
        type: 'user',
        session_id: this.sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content },
      });
      this.wake?.();
    } else if (method === 'session/cancel') {
      this.cancelled = true;
      await this.requireQuery().interrupt();
    } else {
      throw new Error(`Claude Code does not support ${method}.`);
    }
  }

  private requireQuery(): Query {
    if (!this.query) throw new Error('Claude Code session is not ready.');
    return this.query;
  }

  private async *prompts(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.queued.shift();
      if (next) yield next;
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
    }
  }

  private async start(params: Record<string, unknown>, resume: boolean): Promise<void> {
    if (this.query || this.closed) throw new Error('Claude Code session has already started.');
    const status = await detectClaudeCli(true);
    if (this.closed) throw new Error('Claude Code session was stopped.');
    if (!status.installed || !status.path)
      throw new Error('Install Claude Code to use this provider.');
    if (status.authenticated === false)
      throw new Error('Sign in to Claude Code in Settings or run claude auth login.');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    if (this.closed) throw new Error('Claude Code session was stopped.');
    const cwd = String(params.cwd);
    this.sessionId = resume ? String(params.sessionId) : randomUUID();
    const mcpServers: Record<string, McpServerConfig> = {};
    for (const entry of Array.isArray(params.mcpServers) ? params.mcpServers : []) {
      if (entry.type === 'http' && typeof entry.name === 'string') {
        mcpServers[entry.name] = {
          type: 'http',
          url: entry.url,
          headers: Object.fromEntries(
            entry.headers.map((header: { name: string; value: string }) => [
              header.name,
              header.value,
            ]),
          ),
        };
      }
    }
    const meta = params._meta as { systemPrompt?: string } | undefined;
    this.query = query({
      prompt: this.prompts(),
      options: {
        pathToClaudeCodeExecutable: status.path,
        cwd,
        env: this.env,
        model: resolveClaudeModel(this.model),
        ...(resume ? { resume: this.sessionId } : { sessionId: this.sessionId }),
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: meta?.systemPrompt },
        includePartialMessages: true,
        permissionMode: 'default',
        allowDangerouslySkipPermissions: true,
        mcpServers,
        canUseTool: this.canUseTool,
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  if (
                    input.hook_event_name !== 'PreToolUse' ||
                    !['Edit', 'Write'].includes(input.tool_name)
                  )
                    return {};
                  const file = (input.tool_input as { file_path?: string }).file_path;
                  if (file)
                    this.snapshots.set(input.tool_use_id, {
                      path: file,
                      text: await readSmallTextFile(file),
                    });
                  return {};
                },
              ],
            },
          ],
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== 'PostToolUse') return {};
                  const before = this.snapshots.get(input.tool_use_id);
                  if (before) {
                    const after = await readSmallTextFile(before.path);
                    this.update({
                      sessionUpdate: 'tool_call_update',
                      toolCallId: input.tool_use_id,
                      content: [
                        {
                          type: 'diff',
                          path: before.path,
                          ...(before.text !== undefined && typeof after === 'string'
                            ? { oldText: before.text, newText: after }
                            : {}),
                        },
                      ],
                    });
                    this.snapshots.delete(input.tool_use_id);
                  }
                  return {};
                },
              ],
            },
          ],
        },
        spawnClaudeCodeProcess: (options) => {
          if (this.closed) throw new Error('Claude Code session was stopped.');
          const child = spawn(options.command, options.args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            signal: options.signal,
          });
          this.child = child;
          child.once('exit', (code, signal) => this.finish(code, signal));
          // SDK consumes stderr; never forward potentially sensitive provider diagnostics.
          return child;
        },
      },
    });
    void this.consume();
    await this.query.initializationResult();
  }

  private canUseTool: CanUseTool = async (name, input, options) => {
    if (options.signal.aborted || this.closed)
      return { behavior: 'deny', message: 'Request cancelled.' };
    const id = randomUUID();
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const abort = () => done({});
      const done = (value: Record<string, unknown>) => {
        this.replies.delete(id);
        options.signal.removeEventListener('abort', abort);
        resolve(value);
      };
      this.replies.set(id, done);
      options.signal.addEventListener('abort', abort, { once: true });
      if (name === 'AskUserQuestion' && Array.isArray(input.questions)) {
        this.send({
          id,
          method: 'item/tool/requestUserInput',
          params: {
            threadId: this.sessionId,
            questions: input.questions.map((question: Record<string, unknown>, index: number) => ({
              id: String(index),
              header: question.header ?? 'Question',
              question: question.question,
              options: question.options,
              allowMultiple: question.multiSelect === true,
              isOther: true,
            })),
          },
        });
        return;
      }
      this.send({
        id,
        method: 'session/request_permission',
        params: {
          sessionId: this.sessionId,
          toolCall: {
            toolCallId: options.toolUseID,
            title: name,
            kind: name === 'Bash' ? 'execute' : 'other',
            rawInput: input,
          },
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      });
    });
    if (name === 'AskUserQuestion' && Array.isArray(input.questions) && result.answers) {
      const answers = result.answers as Record<string, { answers?: string[] }>;
      return {
        behavior: 'allow',
        updatedInput: {
          ...input,
          answers: Object.fromEntries(
            input.questions.map((question: Record<string, unknown>, index: number) => [
              String(question.question),
              answers[String(index)]?.answers?.join(', ') ?? '',
            ]),
          ),
        },
      };
    }
    const outcome = result.outcome as { outcome?: string; optionId?: string } | undefined;
    return outcome?.outcome === 'selected' && outcome.optionId === 'allow'
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user denied this tool request.' };
  };

  private async consume(): Promise<void> {
    try {
      for await (const message of this.requireQuery()) this.observe(message);
      if (!this.closed) this.finish(0, null);
    } catch (error) {
      if (this.closed) return;
      if (this.promptId !== undefined) {
        this.fail(this.promptId, error);
        this.promptId = undefined;
      }
      this.emit('error', error instanceof Error ? error : new Error('Claude Code session failed.'));
      this.kill();
    }
  }

  private observe(message: SDKMessage): void {
    // Subagent content belongs to its tool, not the parent assistant message.
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return;
    if (message.type === 'stream_event') {
      if (message.event.type === 'message_start') this.streamed = false;
      if (message.event.type === 'content_block_delta') {
        const delta = message.event.delta;
        if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
          this.streamed = true;
          this.update({
            sessionUpdate:
              delta.type === 'text_delta' ? 'agent_message_chunk' : 'agent_thought_chunk',
            content: {
              type: 'text',
              text: delta.type === 'text_delta' ? delta.text : delta.thinking,
            },
          });
        }
      }
    } else if (message.type === 'assistant') {
      this.activeModel = message.message.model;
      for (const block of message.message.content) {
        if (block.type === 'text' && !this.streamed)
          this.update({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: block.text },
          });
        if (block.type === 'tool_use') {
          const input = block.input as Record<string, unknown>;
          this.tools.set(block.id, { name: block.name, input });
          this.update({
            sessionUpdate: 'tool_call',
            toolCallId: block.id,
            title: block.name,
            kind: block.name === 'Bash' ? 'execute' : 'other',
            rawInput: input,
            status: 'in_progress',
          });
        }
      }
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result') continue;
        const tool = this.tools.get(block.tool_use_id);
        const content: Array<Record<string, unknown>> = [];
        if (
          tool &&
          !block.is_error &&
          ['Edit', 'Write', 'NotebookEdit'].includes(tool.name) &&
          typeof tool.input.file_path === 'string'
        ) {
          // A path is evidence of an edit; partial Edit strings are not whole-file patches.
          if (this.snapshots.has(block.tool_use_id))
            content.push({ type: 'diff', path: tool.input.file_path });
        }
        this.update({
          sessionUpdate: 'tool_call_update',
          toolCallId: block.tool_use_id,
          status: block.is_error ? 'failed' : 'completed',
          rawOutput:
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
          content,
        });
        this.tools.delete(block.tool_use_id);
        this.snapshots.delete(block.tool_use_id);
      }
    } else if (message.type === 'result') {
      if (this.promptId === undefined) return;
      const id = this.promptId;
      this.promptId = undefined;
      // Failed startup/limit results may omit accounting; keep the last baseline.
      if (Object.keys(message.modelUsage ?? {}).length > 0) {
        const totals = Object.values(message.modelUsage ?? {}).reduce(
          (sum, usage) => ({
            inputTokens:
              sum.inputTokens +
              usage.inputTokens +
              usage.cacheReadInputTokens +
              usage.cacheCreationInputTokens,
            cachedInputTokens: sum.cachedInputTokens + usage.cacheReadInputTokens,
            outputTokens: sum.outputTokens + usage.outputTokens,
          }),
          { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        );
        const delta = {
          inputTokens: totals.inputTokens - this.usage.inputTokens,
          cachedInputTokens: totals.cachedInputTokens - this.usage.cachedInputTokens,
          outputTokens: totals.outputTokens - this.usage.outputTokens,
        };
        // CLI /clear can reset cumulative counters.
        this.update({
          sessionUpdate: 'usage_update',
          tokens: delta.inputTokens < 0 || delta.outputTokens < 0 ? totals : delta,
          usageId: `${this.sessionId}:${id}`,
          model: this.activeModel,
          costDelta: Math.max(0, (message.total_cost_usd ?? 0) - this.cost),
        });
        this.usage = totals;
        this.cost = message.total_cost_usd ?? 0;
      }
      if (this.cancelled) this.send({ id, result: { stopReason: 'cancelled' } });
      else if (message.is_error || message.subtype !== 'success') {
        this.fail(id, new Error('errors' in message ? message.errors.join('\n') : message.result));
      } else this.send({ id, result: { stopReason: 'end_turn' } });
    }
  }

  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.closed = true;
    this.wake?.();
    for (const reply of this.replies.values()) reply({});
    this.replies.clear();
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.finish(null, typeof signal === 'string' ? signal : 'SIGTERM');
      return true;
    }
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, signal);
        return true;
      }
      return child.kill(signal);
    } catch {
      return false;
    }
  }

  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.closed = true;
    this.exitCode = code ?? (signal ? null : 0);
    this.signalCode = signal;
    this.wake?.();
    for (const reply of this.replies.values()) reply({});
    this.replies.clear();
    this.snapshots.clear();
    this.tools.clear();
    this.stdin.end();
    this.emit('exit', this.exitCode, signal);
  }
}

async function readSmallTextFile(file: string): Promise<string | null | undefined> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 1_000_000) return undefined;
    const value = await readFile(file, 'utf8');
    return value.includes('\0') ? undefined : value;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
}
