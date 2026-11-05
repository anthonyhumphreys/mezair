import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  codex: vi.fn(),
  claude: vi.fn(),
  gateway: vi.fn(),
  models: vi.fn(),
}));
vi.mock('../settings.service.js', () => ({ getSettings: mocks.settings }));
vi.mock('../codex-bridge.service.js', () => ({ detectCodexCli: mocks.codex }));
vi.mock('../claude-bridge.service.js', () => ({ getClaudeCliStatus: mocks.claude }));
vi.mock('../llm-gateway.service.js', () => ({ getLlmGatewayStatus: mocks.gateway }));
vi.mock('openai', () => ({
  OpenAI: class {
    models = { list: mocks.models };
  },
}));

import {
  getThemeDesignOptions,
  recommendThemeModel,
  resetThemeDesignOptionsCache,
} from '../theme-design-models';

const model = (id: string) => ({ id, label: id });
beforeEach(() => {
  vi.clearAllMocks();
  resetThemeDesignOptionsCache();
  mocks.settings.mockReturnValue({
    llmProvider: 'codex',
    enabledLlmProviders: ['codex'],
    openaiModel: 'gpt-5.6-sol',
  });
  mocks.codex.mockResolvedValue({
    installed: true,
    authConfigured: true,
    models: [
      { id: 'gpt-5.6-sol', displayName: 'Older Sol' },
      { id: 'gpt-6.1-sol', displayName: 'Current Sol' },
      { id: 'gpt-9-hidden', displayName: 'Hidden', hidden: true },
    ],
  });
  mocks.claude.mockResolvedValue({
    installed: true,
    authenticated: true,
    models: [model('sonnet'), model('claude-sonnet-5'), model('haiku')],
  });
  mocks.gateway.mockResolvedValue({ connected: false, models: [] });
  mocks.models.mockResolvedValue({
    data: [{ id: 'gpt-6.1' }, { id: 'gpt-6.1-mini' }, { id: 'image-generation' }],
  });
});

describe('theme designer defaults', () => {
  it('chooses a current workhorse from the actual catalog without inventing IDs', () => {
    const options = [
      'gpt-5.6-sol',
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6-luna',
      'codex-auto-review',
    ].map(model);
    expect(recommendThemeModel('codex', options)).toBe('gpt-6.1-sol');
    expect(recommendThemeModel('codex', [model('gpt-5.6-sol')])).toBe('gpt-5.6-sol');
    expect(recommendThemeModel('codex', [])).toBeUndefined();
    expect(
      recommendThemeModel('claude', ['haiku', 'opus', 'sonnet', 'claude-sonnet-5'].map(model)),
    ).toBe('claude-sonnet-5');
  });

  it('replaces the old chat model default within the configured provider and hides unsupported models', async () => {
    const options = await getThemeDesignOptions();
    expect(options.defaultProvider).toBe('codex');
    expect(options.providers[0].defaultModel).toBe('gpt-6.1-sol');
    expect(options.providers[0].models.map((item) => item.id)).not.toContain('gpt-9-hidden');
    expect(mocks.settings().openaiModel).toBe('gpt-5.6-sol');
    expect(mocks.claude).not.toHaveBeenCalled();
  });

  it('falls back to a connected supported provider without invoking unsupported providers', async () => {
    mocks.settings.mockReturnValue({
      llmProvider: 'cursor',
      enabledLlmProviders: ['cursor', 'devin', 'codex', 'claude'],
    });
    mocks.claude.mockResolvedValue({
      installed: true,
      authenticated: false,
      models: [model('sonnet')],
    });
    const options = await getThemeDesignOptions();
    expect(options.providers.map((item) => item.id)).toEqual(['codex']);
    expect(options.defaultProvider).toBe('codex');
  });

  it('keeps an available preferred provider and shares concurrent metadata discovery', async () => {
    mocks.settings.mockReturnValue({
      llmProvider: 'claude',
      enabledLlmProviders: ['codex', 'claude'],
    });
    const [a, b] = await Promise.all([getThemeDesignOptions(), getThemeDesignOptions()]);
    expect(a).toEqual(b);
    expect(a.defaultProvider).toBe('claude');
    expect(a.providers.find((item) => item.id === 'claude')?.defaultModel).toBe('claude-sonnet-5');
    expect(mocks.codex).toHaveBeenCalledTimes(1);
    expect(mocks.claude).toHaveBeenCalledTimes(1);
  });

  it('only offers the configured Azure deployment, and discovers full OpenAI text models', async () => {
    mocks.settings.mockReturnValue({
      llmProvider: 'azure',
      enabledLlmProviders: ['azure', 'openai'],
      foundryEndpoint: 'https://example.openai.azure.com',
      foundryApiKey: 'test',
      foundryDeploymentName: 'team-deployment',
      openaiApiKey: 'test',
    });
    const options = await getThemeDesignOptions();
    expect(options.providers.find((item) => item.id === 'azure')?.models).toEqual([
      model('team-deployment'),
    ]);
    expect(options.providers.find((item) => item.id === 'openai')?.defaultModel).toBe('gpt-6.1');
    expect(
      options.providers.find((item) => item.id === 'openai')?.models.map((item) => item.id),
    ).not.toContain('image-generation');
  });

  it('reports no options when no supported provider is connected', async () => {
    mocks.codex.mockResolvedValue({ installed: false });
    expect(await getThemeDesignOptions()).toEqual({ providers: [] });
  });

  it('refreshes provider catalogs explicitly and coalesces concurrent refreshes', async () => {
    await getThemeDesignOptions();
    await Promise.all([getThemeDesignOptions(true), getThemeDesignOptions(true)]);
    expect(mocks.codex).toHaveBeenCalledTimes(2);
    expect(mocks.codex).toHaveBeenLastCalledWith(true);
    await getThemeDesignOptions();
    expect(mocks.codex).toHaveBeenCalledTimes(2);
  });

  it('refreshes catalogs when gateway billing mode or credentials change', async () => {
    const settings = {
      llmProvider: 'llmgateway',
      enabledLlmProviders: ['llmgateway'],
      llmGatewayApiKey: 'first-test-key',
      llmGatewayBillingMode: 'devpass',
    };
    mocks.settings.mockReturnValue(settings);
    mocks.gateway.mockResolvedValue({
      connected: true,
      models: [{ id: 'provider/model-a', displayName: 'A' }],
    });
    expect((await getThemeDesignOptions()).providers[0].defaultModel).toBe('provider/model-a');
    mocks.settings.mockReturnValue({ ...settings, llmGatewayBillingMode: 'payg' });
    mocks.gateway.mockResolvedValue({
      connected: true,
      models: [{ id: 'provider/model-b', displayName: 'B' }],
    });
    expect((await getThemeDesignOptions()).providers[0].defaultModel).toBe('provider/model-b');
    mocks.settings.mockReturnValue({
      ...settings,
      llmGatewayBillingMode: 'payg',
      llmGatewayApiKey: 'second-test-key',
    });
    const options = await getThemeDesignOptions();
    expect(mocks.gateway).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(options)).not.toContain('test-key');
  });

  it('only offers OpenAI models compatible with the Chat Completions utility', async () => {
    mocks.settings.mockReturnValue({ llmProvider: 'openai', openaiApiKey: 'test' });
    mocks.models.mockResolvedValue({
      data: [
        'gpt-6.1',
        'gpt-5.1',
        'gpt-5-pro',
        'gpt-5-codex',
        'gpt-3.5-turbo-instruct',
        'gpt-4o-search-preview',
        'o3-pro',
        'IMAGE-GENERATION',
      ].map((id) => ({ id })),
    });
    const options = await getThemeDesignOptions();
    expect(options.providers[0].models.map((item) => item.id).sort()).toEqual([
      'gpt-5.1',
      'gpt-6.1',
    ]);
    expect(options.providers[0].defaultModel).toBe('gpt-6.1');
  });
});
