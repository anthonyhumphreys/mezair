import { AzureOpenAI, OpenAI } from 'openai';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import { runUtilityCli, EmptyLlmResponseError } from './utility-cli.js';
import { UtilityScheduler } from './utility-scheduler.js';
import { callClaudeUtility } from './claude-utility.js';
import { getSettings } from './settings.service.js';
import { providerSpawnEnv } from './agent-spawn-env.js';
import type { AgentProvider } from '../../shared/types.js';
import { PRIMARY_CODEX_TEMP_PREFIX } from '../../shared/app-identity.js';
import { DEFAULT_CODEX_MODEL } from '../../shared/codex-models.js';
import {
  callPreferredLocalModel,
  classifyPromptForLocalModel,
  isLikelyLocalModelRefusal,
} from './local-llm.service.js';
import { LLM_GATEWAY_API_URL, LLM_GATEWAY_SOURCE } from '../../shared/llm-gateway.js';

let cachedClient: AzureOpenAI | OpenAI | null = null;
let cachedProvider: string | null = null;
const utilityScheduler = new UtilityScheduler();

export interface LlmCallOptions {
  cwd?: string;
  taskClass?:
    | 'simple-json'
    | 'short-summary'
    | 'prompt-draft'
    | 'code-review'
    | 'security'
    | 'compliance'
    | 'long-context';
  onProgress?: (message: string) => void;
  /** Route this call through a specific connected provider instead of the primary. */
  provider?: AgentProvider;
  /** Model override for this call. Falls back to the provider's configured model. */
  model?: string;
  /** Saved Azure AI Foundry connection for isolated theme design calls. */
  azureFoundry?: {
    endpoint: string;
    apiKey: string;
    apiVersion: string;
    deploymentName: string;
  };
  /** Isolated data generation: supported providers only, in a temporary cwd. */
  textOnly?: boolean;
  priority?: 'foreground' | 'background';
  signal?: AbortSignal;
  timeoutMs?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

const LOCAL_LLM_MAX_PROMPT_CHARS = 12_000;

function isLikelyJsonResponse(value: string): boolean {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\[[\s\S]*\]|\{[\s\S]*\})$/);
  if (!match) return false;

  try {
    JSON.parse(match[1]);
    return true;
  } catch {
    return false;
  }
}

function isLocalLlmEligible(prompt: string, maxTokens: number, options?: LlmCallOptions): boolean {
  if (!options?.taskClass) return false;
  if (prompt.length > LOCAL_LLM_MAX_PROMPT_CHARS) return false;
  if (maxTokens > 4096) return false;
  return true;
}

async function tryLocalLlm(
  prompt: string,
  maxTokens: number,
  options?: LlmCallOptions,
): Promise<string | null> {
  const settings = getSettings();
  if (settings.localLlmMode !== 'prefer-simple') return null;
  if (!isLocalLlmEligible(prompt, maxTokens, options)) return null;

  options?.onProgress?.('Checking whether the selected local model can handle this...');
  const route = await classifyPromptForLocalModel(prompt);
  if (route !== 'local') {
    if (route === 'cloud') {
      console.log('[LLM] On-device classifier routed prompt to the configured backend');
    } else {
      console.warn('[LLM] On-device classification unavailable; using configured backend');
    }
    return null;
  }

  options?.onProgress?.('Trying the selected local model...');
  const result = await callPreferredLocalModel(prompt, maxTokens);
  if (!result.ok || !result.content?.trim()) {
    const fallbackReason = result.error ? ` (${result.error})` : '';
    console.warn(`[LLM] Local model fallback${fallbackReason}`);
    options?.onProgress?.('Local model unavailable; falling back to configured LLM...');
    return null;
  }

  const content = result.content.trim();
  if (isLikelyLocalModelRefusal(content)) {
    console.warn('[LLM] Local model returned a refusal; falling back');
    options?.onProgress?.('Local model refused the request; falling back to configured LLM...');
    return null;
  }

  if (options?.taskClass === 'simple-json' && !isLikelyJsonResponse(content)) {
    console.warn('[LLM] Local model returned non-JSON for a JSON task; falling back');
    options?.onProgress?.('Local model returned invalid JSON; falling back to configured LLM...');
    return null;
  }

  console.log(`[LLM] Local model response accepted (${content.length} chars)`);
  return content;
}

/**
 * Read Codex CLI config.toml to get Azure endpoint, model, and env key.
 * Supports both the new model_providers format and the legacy openai_base_url.
 */
function readCodexConfig(): { baseUrl: string; model: string; envKey: string } | null {
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf-8');
    const modelMatch = toml.match(/^\s*model\s*=\s*"([^"]+)"/m);

    // New format: [model_providers.azure] section with base_url and env_key
    const providerBaseUrl = toml.match(/\[model_providers\.azure\][^[]*?base_url\s*=\s*"([^"]+)"/s);
    const providerEnvKey = toml.match(/\[model_providers\.azure\][^[]*?env_key\s*=\s*"([^"]+)"/s);
    if (providerBaseUrl) {
      return {
        baseUrl: providerBaseUrl[1],
        model: modelMatch?.[1] ?? DEFAULT_CODEX_MODEL,
        envKey: providerEnvKey?.[1] ?? 'AZURE_OPENAI_API_KEY',
      };
    }

    // Legacy format: top-level openai_base_url
    const legacyBaseUrl = toml.match(/^\s*openai_base_url\s*=\s*"([^"]+)"/m);
    if (legacyBaseUrl) {
      return {
        baseUrl: legacyBaseUrl[1],
        model: modelMatch?.[1] ?? DEFAULT_CODEX_MODEL,
        envKey: 'OPENAI_API_KEY',
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Resolve the utility model without inheriting a coding CLI's unrelated model/effort. */
export function getConfiguredUtilityModel(
  provider: AgentProvider = getSettings().llmProvider,
): string | undefined {
  const settings = getSettings();
  if (provider === 'azure') return readCodexConfig()?.model;
  if (provider !== settings.llmProvider)
    return provider === 'codex' ? DEFAULT_CODEX_MODEL : undefined;
  return (
    settings.openaiModel?.trim() ||
    (provider === 'codex' || provider === 'openai' ? DEFAULT_CODEX_MODEL : undefined)
  );
}

/**
 * Get or create the LLM client based on the configured provider.
 * Only used for API-backed providers. Codex and Cursor route through their CLIs.
 */
function getClient(
  provider: AgentProvider = getSettings().llmProvider ?? 'openai',
  modelOverride?: string,
  azureFoundry?: LlmCallOptions['azureFoundry'],
): {
  client: AzureOpenAI | OpenAI;
  model: string;
} {
  const settings = getSettings();
  console.log(`[LLM] getClient: provider=${provider}`);

  if (provider === 'azure' && azureFoundry) {
    const endpoint = azureFoundry.endpoint.trim();
    const apiKey = azureFoundry.apiKey.trim();
    const apiVersion = azureFoundry.apiVersion.trim();
    const deploymentName = azureFoundry.deploymentName.trim();
    if (!endpoint || !apiKey || !apiVersion || !deploymentName) {
      throw new Error(
        'Azure AI Foundry theme design needs a key, endpoint, API version, and deployment.',
      );
    }
    if (modelOverride?.trim() && modelOverride.trim() !== deploymentName) {
      throw new Error('Azure AI Foundry theme model must match the configured deployment.');
    }
    console.log('[LLM] Creating isolated Azure AI Foundry client');
    return {
      client: new AzureOpenAI({ endpoint, apiKey, apiVersion }),
      model: deploymentName,
    };
  }

  // Reset if provider changed
  if (cachedProvider !== provider) {
    console.log(`[LLM] Provider changed from ${cachedProvider} to ${provider}, resetting client`);
    cachedClient = null;
    cachedProvider = provider;
  }

  if (provider === 'azure') {
    // Azure config is read from Codex CLI's config.toml; API key from env.
    const codexConfig = readCodexConfig();
    if (!codexConfig) {
      throw new Error(
        'Azure AI Foundry: base_url not found in ~/.codex/config.toml.\n' +
          'See https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/codex',
      );
    }
    const apiKey = process.env[codexConfig.envKey];
    if (!apiKey) {
      throw new Error(`Azure AI Foundry: ${codexConfig.envKey} environment variable is not set.`);
    }
    if (!cachedClient) {
      // The SDK appends /openai/deployments/... — strip /openai and any trailing path.
      const endpoint = codexConfig.baseUrl.replace(/\/openai(\/.*)?$/, '');
      console.log(`[LLM] Creating Azure client: endpoint=${endpoint}`);
      cachedClient = new AzureOpenAI({
        endpoint,
        apiKey,
      });
    }
    return { client: cachedClient, model: codexConfig.model };
  }

  if (provider === 'llmgateway') {
    if (!settings.llmGatewayApiKey) {
      throw new Error('Connect LLMGateway in Settings before using this provider');
    }
    const model = modelOverride ?? settings.openaiModel?.trim();
    if (!model)
      throw new Error('Choose an LLMGateway model in Settings before using this provider.');
    if (!cachedClient) {
      console.log('[LLM] Creating LLMGateway client');
      cachedClient = new OpenAI({
        apiKey: settings.llmGatewayApiKey,
        baseURL: LLM_GATEWAY_API_URL,
        defaultHeaders: { 'x-source': LLM_GATEWAY_SOURCE },
      });
    }
    return { client: cachedClient, model };
  }

  // OpenAI API key
  if (!settings.openaiApiKey) {
    throw new Error('OpenAI API key must be configured in settings');
  }
  if (!cachedClient) {
    console.log('[LLM] Creating OpenAI client with API key');
    cachedClient = new OpenAI({
      apiKey: settings.openaiApiKey,
    });
  }
  return { client: cachedClient, model: settings.openaiModel || DEFAULT_CODEX_MODEL };
}

export function buildCursorPrintArgs(prompt: string, model = 'auto'): string[] {
  return ['-p', '--model', model, prompt];
}

/**
 * Non-interactive Devin call. `auto` permission mode keeps the one-shot run
 * read-only, and workspace trust is skipped because print mode cannot show the
 * trust prompt and would fail in untrusted directories.
 */
export function buildDevinPrintArgs(prompt: string, model?: string): string[] {
  const args = ['--print', '--permission-mode', 'auto', '--respect-workspace-trust', 'false'];
  const trimmed = model?.trim();
  if (trimmed && trimmed !== 'auto') args.push('--model', trimmed);
  args.push('--', prompt);
  return args;
}

export function buildCodexExecArgs(
  outputPath: string,
  model?: string,
  textOnly = false,
  reasoningEffort?: LlmCallOptions['reasoningEffort'],
): string[] {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--output-last-message',
    outputPath,
  ];
  if (textOnly) {
    args.push('--ignore-user-config', '--ignore-rules', '--ephemeral');
    for (const feature of [
      'shell_tool',
      'shell_snapshot',
      'view_image',
      'image_generation',
      'apps',
      'browser_use',
      'computer_use',
      'plugins',
      'remote_plugin',
      'plugin_discovery_prefetch',
      'hooks',
      'multi_agent',
      'multi_agent_v2',
      'skill_search',
      'code_mode',
      'code_mode_host',
    ]) {
      args.push('-c', `features.${feature}=false`);
    }
    args.push(
      '-c',
      'web_search="disabled"',
      '-c',
      'project_doc_max_bytes=0',
      '-c',
      'features.skip_host_skill_discovery=true',
      '-c',
      'skills.include_instructions=false',
      '-c',
      'skills.bundled.enabled=false',
      '-c',
      'cloud.skills.enabled=false',
    );
  }
  const trimmed = model?.trim();
  if (trimmed) args.push('--model', trimmed);
  if (reasoningEffort) args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  args.push('-');
  return args;
}

async function callCursor(
  prompt: string,
  options?: LlmCallOptions,
  model = 'auto',
): Promise<string> {
  options?.onProgress?.('Generating with Cursor…');
  return runUtilityCli('cursor-agent', buildCursorPrintArgs(prompt.replace(/\0/g, ''), model), {
    cwd: options?.cwd,
    env: providerSpawnEnv(),
    signal: options?.signal,
  });
}

async function callDevin(
  prompt: string,
  options?: LlmCallOptions,
  model?: string,
): Promise<string> {
  options?.onProgress?.('Generating with Devin…');
  return runUtilityCli('devin', buildDevinPrintArgs(prompt.replace(/\0/g, ''), model), {
    cwd: options?.cwd,
    env: providerSpawnEnv(),
    signal: options?.signal,
  });
}

async function callCodex(
  prompt: string,
  options?: LlmCallOptions,
  model?: string,
): Promise<string> {
  options?.onProgress?.('Generating with Codex…');
  const tempDir = mkdtempSync(join(tmpdir(), PRIMARY_CODEX_TEMP_PREFIX));
  try {
    const outputPath = join(tempDir, 'last-message.txt');
    return await runUtilityCli(
      'codex',
      buildCodexExecArgs(outputPath, model, options?.textOnly, options?.reasoningEffort),
      {
        cwd: options?.textOnly ? tempDir : options?.cwd,
        env: providerSpawnEnv({ OTEL_SDK_DISABLED: 'true' }),
        prompt: prompt.replace(/\0/g, ''),
        signal: options?.signal,
        outputPath,
        outputLimit: options?.textOnly ? 65_536 : 2_000_000,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Reset cached client — call when settings change. */
export function resetLlmClient(): void {
  cachedClient = null;
  cachedProvider = null;
}

/**
 * Make an LLM call. Routes through Codex CLI or OpenAI SDK depending on provider.
 */
async function callLlmUnqueued(
  userMessage: string,
  maxTokens: number,
  temperature: number,
  maxRetries = 3,
  options?: LlmCallOptions,
): Promise<string> {
  options?.signal?.throwIfAborted();
  const settings = getSettings();
  const provider = options?.provider ?? settings.llmProvider;
  if (options?.textOnly && (provider === 'cursor' || provider === 'devin'))
    throw new Error(
      'Theme design needs Codex, Claude Code, OpenAI, Azure or LLMGateway. Choose one in Providers to generate a theme.',
    );
  const modelOverride = options?.model?.trim() || getConfiguredUtilityModel(provider);
  let lastEmptyResponseMessage: string | null = null;

  // An explicit provider override is a deliberate routing choice — bypass the
  // prefer-simple local classifier so the call reaches the requested provider.
  if (!options?.provider) {
    const localResult = await tryLocalLlm(userMessage, maxTokens, options);
    if (localResult) return localResult;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    options?.signal?.throwIfAborted();
    let result: string;

    if (
      provider === 'codex' ||
      provider === 'cursor' ||
      provider === 'devin' ||
      provider === 'claude'
    ) {
      try {
        result =
          provider === 'claude'
            ? await callClaudeUtility(
                userMessage,
                modelOverride ||
                  (settings.llmProvider === 'claude' ? settings.openaiModel : 'auto'),
                options?.cwd,
                options,
              )
            : provider === 'cursor'
              ? await callCursor(userMessage, options, modelOverride || 'auto')
              : provider === 'devin'
                ? await callDevin(userMessage, options, modelOverride)
                : await callCodex(userMessage, options, modelOverride);
      } catch (err) {
        if (err instanceof EmptyLlmResponseError) {
          lastEmptyResponseMessage = err.message;

          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            const retryMessage = `CLI provider returned no content, retrying (${attempt + 2}/${maxRetries + 1})...`;
            console.warn(`[LLM] ${retryMessage}`);
            options?.onProgress?.(retryMessage);
            await wait(delay, undefined, { signal: options?.signal });
            continue;
          }
        }

        throw err;
      }
    } else {
      const { client, model } = getClient(provider, modelOverride, options?.azureFoundry);
      const effectiveModel = modelOverride ?? model;
      try {
        const body: Record<string, unknown> = {
          model: effectiveModel,
          messages: [{ role: 'user', content: userMessage }],
          max_completion_tokens: maxTokens,
          ...(options?.textOnly ? {} : { temperature }),
        };
        // Direct OpenAI API calls use the standard reasoning efforts. Codex-only max/ultra
        // travel through the Codex app-server path instead.
        if (
          !options?.textOnly &&
          effectiveModel.startsWith('gpt-5') &&
          settings.reasoningLevel &&
          settings.reasoningLevel !== 'max' &&
          settings.reasoningLevel !== 'ultra'
        ) {
          body.reasoning_effort = settings.reasoningLevel;
        }
        if (options?.reasoningEffort && /^gpt-[56]/.test(effectiveModel)) {
          body.reasoning_effort = options.reasoningEffort;
          delete body.temperature;
        }
        const response = await client.chat.completions.create(
          body as unknown as Parameters<typeof client.chat.completions.create>[0],
          { signal: options?.signal },
        );
        result = 'choices' in response ? (response.choices[0]?.message?.content ?? '') : '';
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 429 && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.log(`[LLM] Rate limited, retrying in ${Math.round(delay)}ms...`);
          options?.onProgress?.(
            `Rate limited by the LLM provider, retrying (${attempt + 2}/${maxRetries + 1})...`,
          );
          await wait(delay, undefined, { signal: options?.signal });
          continue;
        }
        throw err;
      }
    }

    if (result.length > 0) return result;

    // Empty response — retry if we have attempts left
    lastEmptyResponseMessage = 'LLM returned empty response';
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(
        `[LLM] Empty response (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms...`,
      );
      options?.onProgress?.(
        `Received an empty response, retrying (${attempt + 2}/${maxRetries + 1})...`,
      );
      await wait(delay, undefined, { signal: options?.signal });
      continue;
    }
  }

  throw new Error(lastEmptyResponseMessage ?? 'LLM returned empty response after all retries');
}

/** Utility deadlines include queue wait and retries; background indexing has its own slot. */
export async function callLlm(
  userMessage: string,
  maxTokens: number,
  temperature: number,
  maxRetries = 3,
  options?: LlmCallOptions,
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort(options?.signal?.reason ?? new Error('Request cancelled.'));
  if (options?.signal?.aborted) abort();
  else options?.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error('AI request timed out. Try again.')),
    options?.timeoutMs ?? 300_000,
  );
  try {
    return await utilityScheduler.run(
      () =>
        callLlmUnqueued(userMessage, maxTokens, temperature, maxRetries, {
          ...options,
          signal: controller.signal,
        }),
      {
        ...options,
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abort);
  }
}

/**
 * Test the configured LLM connection with a minimal request.
 */
export async function testLlmConnection(): Promise<{ ok: boolean; error?: string }> {
  console.log('[LLM] Testing connection...');
  try {
    const settings = getSettings();
    if (
      settings.llmProvider === 'codex' ||
      settings.llmProvider === 'cursor' ||
      settings.llmProvider === 'devin' ||
      settings.llmProvider === 'claude'
    ) {
      console.log(`[LLM] Test: running ${settings.llmProvider} CLI ping`);
      if (settings.llmProvider === 'claude') {
        await callClaudeUtility('respond with the word pong', settings.openaiModel);
      } else if (settings.llmProvider === 'cursor') {
        await callCursor('respond with the word pong', undefined, settings.openaiModel || 'auto');
      } else if (settings.llmProvider === 'devin') {
        await callDevin('respond with the word pong', undefined, settings.openaiModel);
      } else {
        await callCodex('respond with the word pong');
      }
      console.log(`[LLM] Test: ${settings.llmProvider} connection OK`);
      return { ok: true };
    }

    const { client, model } = getClient();
    console.log(`[LLM] Test: sending ping to model=${model}`);
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_completion_tokens: 5,
    });
    console.log('[LLM] Test: connection OK');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[LLM] Test: connection FAILED:', msg);
    return { ok: false, error: msg };
  }
}
