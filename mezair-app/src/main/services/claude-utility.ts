import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectClaudeCli } from './claude-bridge.service.js';
import { claudeSpawnEnv } from './agent-spawn-env.js';
import { resolveClaudeModel } from '../../shared/claude-models.js';

/** App utilities need text only: no tools, MCP servers, hooks, or saved chat. */
export async function callClaudeUtility(
  prompt: string,
  model?: string,
  cwd?: string,
  options?: {
    signal?: AbortSignal;
    textOnly?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high';
  },
): Promise<string> {
  const status = await detectClaudeCli();
  if (!status.path) throw new Error('Install Claude Code to use this provider.');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  options?.signal?.throwIfAborted();
  options?.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => abortController.abort(), 120_000);
  const tempDir = options?.textOnly
    ? mkdtempSync(join(tmpdir(), 'mezair-claude-utility-'))
    : undefined;
  let session: ReturnType<typeof query> | undefined;
  try {
    session = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: status.path,
        env: claudeSpawnEnv(),
        cwd: tempDir ?? cwd,
        model: resolveClaudeModel(model),
        settingSources: options?.textOnly ? [] : ['user'],
        ...(options?.reasoningEffort ? { effort: options.reasoningEffort } : {}),
        settings: { disableAllHooks: true },
        tools: [],
        mcpServers: {},
        strictMcpConfig: true,
        persistSession: false,
        abortController,
      },
    });
    for await (const message of session) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success' && !message.is_error && message.result.trim()) {
        if (message.result.length > 65_536)
          throw new Error('AI response exceeded its output limit.');
        return message.result.trim();
      }
      throw new Error(
        'errors' in message ? message.errors.join('\n') : 'Claude Code returned no text.',
      );
    }
    throw new Error('Claude Code returned no result.');
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abort);
    session?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
