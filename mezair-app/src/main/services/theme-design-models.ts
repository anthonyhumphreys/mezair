import { OpenAI } from 'openai';
import { createHash } from 'node:crypto';
import type { AgentProvider, AppSettings } from '../../shared/types.js';
import type { ThemeDesignOptions, ThemeDesignProviderOption } from '../../shared/theme-design.js';
import { detectCodexCli } from './codex-bridge.service.js';
import { getClaudeCliStatus } from './claude-bridge.service.js';
import { getLlmGatewayStatus } from './llm-gateway.service.js';
import { getSettings } from './settings.service.js';

type Model = { id: string; label: string };
const LABELS: Partial<Record<AgentProvider, string>> = {
  codex: 'Codex',
  claude: 'Claude Code',
  openai: 'OpenAI',
  azure: 'Azure AI Foundry',
  llmgateway: 'LLMGateway',
};
let cached:
  | { key: string; expires: number; pending: boolean; value: Promise<ThemeDesignOptions> }
  | undefined;

export function resetThemeDesignOptionsCache(): void {
  cached = undefined;
}

function version(id: string): number {
  const match = id.match(
    /(?:gpt-|claude-(?:sonnet-|opus-)?|sonnet-|opus-|gemini-)(\d+)(?:[.-](\d+))?/i,
  );
  return match ? Number(match[1]) * 100 + Number(match[2] ?? 0) : 0;
}

/** Prefer a current general-purpose workhorse; specialist and economy models remain selectable. */
export function recommendThemeModel(
  provider: AgentProvider,
  models: readonly Model[],
): string | undefined {
  const score = ({ id }: Model) => {
    const value = id.toLowerCase();
    if (
      /review|daybreak|image|audio|realtime|embedding|transcrib|moderation|tts|whisper/.test(value)
    )
      return -1000;
    if (/mini|nano|haiku|luna|spark|reserve|flash|preview/.test(value))
      return -100 + version(value);
    const preferred =
      provider === 'claude' || provider === 'llmgateway'
        ? /sonnet/.test(value)
        : /(?:sol|gpt-\d)/.test(value) && !/astra|terra|codex/.test(value);
    return (
      (preferred
        ? 10_000
        : /opus|astra|terra|gemini.*pro/.test(value)
          ? 5000
          : value === 'auto'
            ? -500
            : 1000) + version(value)
    );
  };
  return [...models].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]?.id;
}

function cleanModels(models: readonly Model[], provider: AgentProvider): Model[] {
  const unique = new Map<string, Model>();
  for (const model of models.slice(0, 2048)) {
    if (
      !model.id ||
      model.id.length > 200 ||
      Array.from(model.id).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      continue;
    const id = model.id.toLowerCase();
    if (
      /image|audio|embedding|transcrib|moderation|tts|whisper|realtime|daybreak|auto-review/.test(
        id,
      )
    )
      continue;
    if (
      (provider === 'openai' || provider === 'llmgateway') &&
      (/(?:gpt-|openai\/).*(?:-pro(?:-|$)|codex|instruct|deep-research|search)/.test(id) ||
        /(?:^|\/)o\d/.test(id))
    )
      continue;
    unique.set(model.id, { id: model.id, label: model.label.slice(0, 200) || model.id });
  }
  return [...unique.values()];
}

async function discover(
  provider: AgentProvider,
  settings: AppSettings,
  force: boolean,
): Promise<ThemeDesignProviderOption | undefined> {
  let models: Model[] = [];
  if (provider === 'codex') {
    const status = await detectCodexCli(force);
    if (!status.installed || !status.authConfigured) return;
    models = (status.models ?? [])
      .filter((model) => !model.hidden)
      .map((model) => ({ id: model.id, label: model.displayName }));
    if (!models.length && status.configuredModel)
      models = [{ id: status.configuredModel, label: `${status.configuredModel} (configured)` }];
  } else if (provider === 'claude') {
    const status = await getClaudeCliStatus(force);
    if (!status.installed || status.authenticated !== true) return;
    models = status.models;
  } else if (provider === 'llmgateway') {
    const status = await getLlmGatewayStatus(force, settings.llmGatewayBillingMode);
    if (!status.connected) return;
    models = status.models
      .filter((model) => !model.hidden)
      .map((model) => ({ id: model.id, label: model.displayName }));
  } else if (provider === 'openai') {
    if (!settings.openaiApiKey) return;
    try {
      const client = new OpenAI({ apiKey: settings.openaiApiKey, timeout: 8000, maxRetries: 0 });
      const catalog = await client.models.list();
      models = catalog.data
        .filter((model) => /^(gpt-|chatgpt-|o\d)/.test(model.id))
        .map((model) => ({ id: model.id, label: model.id }));
    } catch {
      if (settings.llmProvider === 'openai' && settings.openaiModel)
        models = [{ id: settings.openaiModel, label: `${settings.openaiModel} (configured)` }];
    }
  } else if (provider === 'azure') {
    if (!settings.foundryEndpoint || !settings.foundryApiKey || !settings.foundryDeploymentName)
      return;
    models = [{ id: settings.foundryDeploymentName, label: settings.foundryDeploymentName }];
  } else return;
  models = cleanModels(models, provider);
  const defaultModel = recommendThemeModel(provider, models);
  if (!defaultModel) return;
  models.sort(
    (a, b) =>
      Number(b.id === defaultModel) - Number(a.id === defaultModel) ||
      a.label.localeCompare(b.label),
  );
  return { id: provider, label: LABELS[provider]!, models: models.slice(0, 80), defaultModel };
}

/** Model metadata only; no prompt or user repository content is sent during discovery. */
export async function getThemeDesignOptions(force = false): Promise<ThemeDesignOptions> {
  const settings = getSettings();
  const enabled = [
    ...new Set([settings.llmProvider, ...(settings.enabledLlmProviders ?? [])]),
  ].filter((provider) => LABELS[provider]);
  const key = JSON.stringify([
    enabled,
    settings.openaiModel,
    settings.foundryEndpoint,
    settings.foundryDeploymentName,
    settings.llmGatewayBillingMode,
    createHash('sha256')
      .update(
        JSON.stringify([settings.openaiApiKey, settings.foundryApiKey, settings.llmGatewayApiKey]),
      )
      .digest('hex'),
  ]);
  if (cached?.key === key && (cached.pending || (!force && cached.expires > Date.now())))
    return cached.value;
  const value = Promise.allSettled(
    enabled.map((provider) => discover(provider, settings, force)),
  ).then((results) => {
    const providers = results.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
    return {
      providers,
      ...(providers.length
        ? {
            defaultProvider:
              providers.find((provider) => provider.id === settings.llmProvider)?.id ??
              providers[0].id,
          }
        : {}),
    };
  });
  const entry = { key, expires: Date.now() + 30_000, pending: true, value };
  cached = entry;
  void value.then(
    () => {
      entry.pending = false;
    },
    () => {
      entry.pending = false;
    },
  );
  return value;
}
