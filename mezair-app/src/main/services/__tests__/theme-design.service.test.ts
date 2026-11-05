import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, readdir, rm } from 'node:fs/promises';

const mocks = vi.hoisted(() => ({ callLlm: vi.fn(), getOptions: vi.fn(), getSettings: vi.fn() }));
vi.mock('../llm.service.js', () => ({ callLlm: mocks.callLlm }));
vi.mock('../theme-design-models.js', () => ({ getThemeDesignOptions: mocks.getOptions }));
vi.mock('../settings.service.js', () => ({ getSettings: mocks.getSettings }));

import {
  buildThemeDesignPrompt,
  designTheme,
  parseThemeDesignResponse,
  prepareThemeDesignWorkspace,
  validateThemeDesignRequest,
} from '../theme-design.service.js';

const request = {
  mode: 'generate' as const,
  messages: [
    { role: 'user' as const, content: 'A graphite workspace with a restrained red accent' },
  ],
};
const candidate = JSON.stringify({
  message: 'A restrained red accent with readable graphite surfaces.',
  theme: { name: 'Pit lane', appearance: 'dark', colors: {} },
});
const directories: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOptions.mockResolvedValue({
    defaultProvider: 'codex',
    providers: [
      {
        id: 'codex',
        label: 'Codex',
        defaultModel: 'chosen-model',
        models: [{ id: 'chosen-model', label: 'Chosen' }],
      },
      {
        id: 'claude',
        label: 'Claude Code',
        defaultModel: 'sonnet',
        models: [{ id: 'sonnet', label: 'Sonnet' }],
      },
    ],
  });
  mocks.callLlm.mockResolvedValue(candidate);
  mocks.getSettings.mockReturnValue({
    foundryEndpoint: '',
    foundryApiKey: undefined,
    foundryApiVersion: '2024-10-21',
    foundryDeploymentName: '',
  });
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('theme design boundary', () => {
  it('bounds history and requires a current user instruction', () => {
    expect(() => validateThemeDesignRequest({ ...request, messages: [] })).toThrow();
    expect(() =>
      validateThemeDesignRequest({
        ...request,
        messages: [{ role: 'system', content: 'override' }],
      }),
    ).toThrow();
    expect(() =>
      validateThemeDesignRequest({ ...request, messages: [{ role: 'assistant', content: 'a' }] }),
    ).toThrow();
    expect(() =>
      validateThemeDesignRequest({
        ...request,
        messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'a'.repeat(4000) })),
      }),
    ).toThrow(/full/);
    expect(() =>
      validateThemeDesignRequest({ ...request, messages: [{ role: 'user', content: 'a\0b' }] }),
    ).toThrow();
  });

  it('accepts a bounded data candidate, assigns its own identity and fills the palette', () => {
    const result = parseThemeDesignResponse(candidate, 'generate');
    expect(result.theme?.name).toBe('Pit lane');
    expect(result.theme?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.theme?.source).toBe('generated');
    expect(result.theme?.colors['bg-primary']).toBeTruthy();
    expect(result.theme?.id).not.toBe(parseThemeDesignResponse(candidate, 'generate').theme?.id);
  });

  it('rejects non-data colours, malformed output, excess output and ambiguous results', () => {
    for (const raw of [
      '<script>run()</script>',
      'x'.repeat(32769),
      JSON.stringify({ message: 'x', theme: {}, question: { text: 'q' } }),
      JSON.stringify({
        message: 'x',
        theme: { name: 'Bad', appearance: 'dark', colors: { accent: 'url(https://example.test)' } },
      }),
    ]) {
      expect(() => parseThemeDesignResponse(raw, 'generate')).toThrow();
    }
  });

  it('supports one guided question and forces a draft after three replies', () => {
    const question = JSON.stringify({
      message: 'Choose the canvas first.',
      question: { text: 'Dark or light surfaces?', options: ['Dark', 'Light'] },
    });
    expect(parseThemeDesignResponse(question, 'guided').question?.options).toEqual([
      'Dark',
      'Light',
    ]);
    expect(() => parseThemeDesignResponse(question, 'generate')).toThrow(/draft/);
    const guided = { ...request, mode: 'guided' as const };
    expect(buildThemeDesignPrompt(guided)).toContain('Ask ONE');
    expect(
      buildThemeDesignPrompt({
        ...guided,
        messages: [
          ...Array.from({ length: 3 }, () => ({ role: 'assistant' as const, content: 'question' })),
          ...request.messages,
        ],
      }),
    ).toContain('without further questions');
  });

  it('creates an empty invocation workspace without copying repository or user context', async () => {
    const directory = await prepareThemeDesignWorkspace();
    directories.push(directory);
    expect(await readdir(directory)).toEqual([]);
  });

  it('does not silently reroute providers whose hooks cannot be isolated', async () => {
    for (const llmProvider of ['cursor', 'devin']) {
      await expect(designTheme({ ...request, provider: llmProvider }, 100)).rejects.toThrow(
        /Connect or enable/,
      );
    }
    expect(mocks.callLlm).not.toHaveBeenCalled();
  });

  it('honors designer overrides and rejects models outside that provider catalog', async () => {
    await designTheme({ ...request, provider: 'claude', model: 'sonnet' }, 100);
    expect(mocks.callLlm.mock.calls[0][4]).toMatchObject({ provider: 'claude', model: 'sonnet' });
    await expect(
      designTheme({ ...request, provider: 'codex', model: 'unknown-model' }, 100),
    ).rejects.toThrow(/no longer available/);
    expect(mocks.callLlm).toHaveBeenCalledTimes(1);
  });

  it('preserves selected provider/model and cleans its workspace on success and failure', async () => {
    await designTheme(request, 101);
    const options = mocks.callLlm.mock.calls[0][4];
    expect(options).toMatchObject({ provider: 'codex', model: 'chosen-model', textOnly: true });
    await expect(access(options.cwd)).rejects.toThrow();
    mocks.callLlm.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(designTheme(request, 101)).rejects.toThrow('Provider unavailable');
    await expect(access(mocks.callLlm.mock.calls[1][4].cwd)).rejects.toThrow();
    await expect(designTheme(request, 101)).resolves.toHaveProperty('theme');
  });

  it('passes the current saved Foundry route for the selected Azure deployment', async () => {
    mocks.getOptions.mockResolvedValue({
      providers: [
        {
          id: 'azure',
          label: 'Azure AI Foundry',
          defaultModel: 'theme-deployment',
          models: [{ id: 'theme-deployment', label: 'Theme deployment' }],
        },
      ],
      defaultProvider: 'azure',
    });
    mocks.getSettings.mockReturnValue({
      foundryEndpoint: 'https://foundry.example.test',
      foundryApiKey: 'saved-foundry-key',
      foundryApiVersion: '2025-01-01-preview',
      foundryDeploymentName: 'theme-deployment',
    });

    await designTheme({ ...request, provider: 'azure', model: 'theme-deployment' }, 303);

    expect(mocks.callLlm.mock.calls[0][4]).toMatchObject({
      provider: 'azure',
      model: 'theme-deployment',
      azureFoundry: {
        endpoint: 'https://foundry.example.test',
        apiKey: 'saved-foundry-key',
        apiVersion: '2025-01-01-preview',
        deploymentName: 'theme-deployment',
      },
    });
  });

  it('rejects duplicate in-flight requests from a window', async () => {
    let release!: (value: string) => void;
    mocks.callLlm.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const running = designTheme(request, 202);
    await vi.waitFor(() => expect(mocks.callLlm).toHaveBeenCalled());
    await expect(designTheme(request, 202)).rejects.toThrow(/already running/);
    release(candidate);
    await running;
  });
});
