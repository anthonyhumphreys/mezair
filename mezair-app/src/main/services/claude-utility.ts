import { detectClaudeCli } from './claude-bridge.service.js';
import { claudeSpawnEnv } from './agent-spawn-env.js';
import { resolveClaudeModel } from '../../shared/claude-models.js';

/** App utilities need text only: no tools, MCP servers, hooks, or saved chat. */
export async function callClaudeUtility(
  prompt: string,
  model?: string,
  cwd?: string,
): Promise<string> {
  const status = await detectClaudeCli();
  if (!status.path) throw new Error('Install Claude Code to use this provider.');
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 120_000);
  const session = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: status.path,
      env: claudeSpawnEnv(),
      cwd,
      model: resolveClaudeModel(model),
      settingSources: ['user'],
      settings: { disableAllHooks: true },
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      abortController,
    },
  });
  try {
    for await (const message of session) {
      if (message.type !== 'result') continue;
      if (message.subtype === 'success' && !message.is_error && message.result.trim())
        return message.result.trim();
      throw new Error(
        'errors' in message ? message.errors.join('\n') : 'Claude Code returned no text.',
      );
    }
    throw new Error('Claude Code returned no result.');
  } finally {
    clearTimeout(timeout);
    session.close();
  }
}
