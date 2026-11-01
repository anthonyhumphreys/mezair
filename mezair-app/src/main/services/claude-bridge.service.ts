import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClaudeCliStatus } from '../../shared/types.js';
import { CLAUDE_MODEL_OPTIONS } from '../../shared/claude-models.js';
import { claudeSpawnEnv } from './agent-spawn-env.js';

let cached: { at: number; status: ClaudeCliStatus } | undefined;
let catalog: { at: number; models: ClaudeCliStatus['models'] } | undefined;
let catalogRequest: Promise<ClaudeCliStatus['models']> | undefined;

/** Discover the CLI's model catalog through SDK controls, without sending a prompt. */
export async function getClaudeCliStatus(force = false): Promise<ClaudeCliStatus> {
  const status = await detectClaudeCli(force);
  if (!status.path || status.authenticated !== true) return status;
  if (!force && catalog && Date.now() - catalog.at < 300_000)
    return { ...status, models: catalog.models };
  catalogRequest ??= discoverClaudeModels(status.path).finally(() => {
    catalogRequest = undefined;
  });
  try {
    const models = await catalogRequest;
    catalog = { at: Date.now(), models };
    return { ...status, models };
  } catch {
    // Stable CLI aliases and custom model ids remain usable when discovery fails.
    return status;
  }
}

async function discoverClaudeModels(executable: string): Promise<ClaudeCliStatus['models']> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 10_000);
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = query({
    prompt: (async function* () {
      await waiting;
      yield* []; // No inference input: only SDK control requests are sent.
    })(),
    options: {
      pathToClaudeCodeExecutable: executable,
      env: claudeSpawnEnv(),
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
    const models = await session.supportedModels();
    return [
      CLAUDE_MODEL_OPTIONS[0],
      ...models.map((model) => ({ id: model.value, label: model.displayName })),
    ];
  } finally {
    clearTimeout(timeout);
    release?.();
    session.close();
  }
}

export async function detectClaudeCli(force = false): Promise<ClaudeCliStatus> {
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.status;
  const execFileAsync = promisify(execFile);
  let status: ClaudeCliStatus;
  const env = claudeSpawnEnv();
  try {
    const [{ stdout: location }, { stdout: version }] = await Promise.all([
      execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
        env,
        timeout: 5000,
      }),
      execFileAsync('claude', ['--version'], { env, timeout: 5000 }),
    ]);
    const authenticated = await execFileAsync('claude', ['auth', 'status'], { env, timeout: 5000 })
      .then(({ stdout }) => parseClaudeAuthStatus(stdout))
      .catch((error: unknown) => {
        const stdout = (error as { stdout?: unknown }).stdout;
        return typeof stdout === 'string' ? parseClaudeAuthStatus(stdout) : undefined;
      });
    status = {
      installed: true,
      path: location.trim().split(/\r?\n/)[0],
      version: version.trim(),
      authenticated,
      models: CLAUDE_MODEL_OPTIONS.map((model) => ({ ...model })),
    };
  } catch {
    status = { installed: false, models: [] };
  }
  cached = { at: Date.now(), status };
  return status;
}

export function parseClaudeAuthStatus(output: string): boolean | undefined {
  try {
    const value: unknown = JSON.parse(output);
    if (
      value &&
      typeof value === 'object' &&
      'loggedIn' in value &&
      typeof value.loggedIn === 'boolean'
    )
      return value.loggedIn;
  } catch {
    /* Older CLIs may not support JSON status. */
  }
  return undefined;
}

export async function startClaudeAuthLogin(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['auth', 'login'], {
      env: claudeSpawnEnv(),
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', (error) => resolve({ ok: false, error: error.message }));
    child.once('spawn', () => {
      cached = undefined;
      child.unref();
      resolve({ ok: true });
    });
  });
}
