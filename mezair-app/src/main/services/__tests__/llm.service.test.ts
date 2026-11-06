import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureOpenAI, OpenAI } from 'openai';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  callPreferredLocalModel: vi.fn(),
  classifyPromptForLocalModel: vi.fn(),
  completionCreate: vi.fn(),
  runUtilityCli: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: mocks.readFileSync,
}));

vi.mock('../utility-cli.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utility-cli.js')>()),
  runUtilityCli: mocks.runUtilityCli,
}));

vi.mock('../settings.service.js', () => ({
  getSettings: mocks.getSettings,
}));

vi.mock('../local-llm.service.js', () => ({
  callPreferredLocalModel: mocks.callPreferredLocalModel,
  classifyPromptForLocalModel: mocks.classifyPromptForLocalModel,
  isLikelyLocalModelRefusal: (value: string) =>
    /(?:i apologize|i'm sorry|cannot assist|can't assist|unable to assist)/i.test(value),
}));

vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(function OpenAIMock() {
    return {
      chat: {
        completions: {
          create: mocks.completionCreate,
        },
      },
    };
  }),
  AzureOpenAI: vi.fn().mockImplementation(function AzureOpenAIMock() {
    return {
      chat: {
        completions: {
          create: mocks.completionCreate,
        },
      },
    };
  }),
}));

import {
  buildCodexExecArgs,
  buildCursorPrintArgs,
  callLlm,
  resetLlmClient,
} from '../llm.service.js';

function openAiSettings() {
  return {
    llmProvider: 'openai',
    localLlmMode: 'prefer-simple',
    localLlmProvider: 'ollama',
    localLlmEndpoint: 'http://127.0.0.1:11434/v1',
    localLlmModel: 'llama3.2',
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-5.5',
    reasoningLevel: 'medium',
  };
}

describe('callLlm local model routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLlmClient();
    mocks.getSettings.mockReturnValue(openAiSettings());
    mocks.classifyPromptForLocalModel.mockResolvedValue('local');
    mocks.completionCreate.mockResolvedValue({
      choices: [{ message: { content: 'fallback response' } }],
    });
  });

  it('uses model defaults instead of chat sampling and reasoning overrides for text-only utilities', async () => {
    await callLlm('Return a theme palette', 3000, 0.4, 0, {
      provider: 'openai',
      model: 'gpt-5.5',
      textOnly: true,
    });
    const body = mocks.completionCreate.mock.calls[0][0];
    expect(body).toMatchObject({ model: 'gpt-5.5', max_completion_tokens: 3000 });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('uses the selected local model when the classifier routes locally', async () => {
    mocks.callPreferredLocalModel.mockResolvedValue({
      ok: true,
      content: 'local response',
      unavailable: false,
    });

    const response = await callLlm('draft a short fix prompt', 1024, 0.3, 0, {
      taskClass: 'prompt-draft',
    });

    expect(response).toBe('local response');
    expect(mocks.classifyPromptForLocalModel).toHaveBeenCalledTimes(1);
    expect(mocks.callPreferredLocalModel).toHaveBeenCalledTimes(1);
    expect(mocks.completionCreate).not.toHaveBeenCalled();
  });

  it('falls back when the classifier routes to the cloud backend', async () => {
    mocks.classifyPromptForLocalModel.mockResolvedValue('cloud');

    const response = await callLlm('draft a short fix prompt', 1024, 0.3, 0, {
      taskClass: 'prompt-draft',
    });

    expect(response).toBe('fallback response');
    expect(mocks.callPreferredLocalModel).not.toHaveBeenCalled();
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back when classification is unavailable', async () => {
    mocks.classifyPromptForLocalModel.mockResolvedValue(null);

    const response = await callLlm('draft a short fix prompt', 1024, 0.3, 0, {
      taskClass: 'prompt-draft',
    });

    expect(response).toBe('fallback response');
    expect(mocks.callPreferredLocalModel).not.toHaveBeenCalled();
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back when a local JSON task returns non-JSON', async () => {
    mocks.callPreferredLocalModel.mockResolvedValue({
      ok: true,
      content: 'probably JSON, if you squint',
      unavailable: false,
    });

    const response = await callLlm('return json', 1024, 0.3, 0, { taskClass: 'simple-json' });

    expect(response).toBe('fallback response');
    expect(mocks.callPreferredLocalModel).toHaveBeenCalledTimes(1);
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back when the local model refuses an eligible task', async () => {
    mocks.callPreferredLocalModel.mockResolvedValue({
      ok: true,
      content: 'I apologize, but I cannot assist with that request.',
      unavailable: false,
    });

    const response = await callLlm('draft a short fix prompt', 1024, 0.3, 0, {
      taskClass: 'prompt-draft',
    });

    expect(response).toBe('fallback response');
    expect(mocks.callPreferredLocalModel).toHaveBeenCalledTimes(1);
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
  });

  it('does not attempt local routing without a task class', async () => {
    const response = await callLlm('review this diff', 1024, 0.2, 0);

    expect(response).toBe('fallback response');
    expect(mocks.classifyPromptForLocalModel).not.toHaveBeenCalled();
    expect(mocks.callPreferredLocalModel).not.toHaveBeenCalled();
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
  });

  it('calls LLMGateway directly with its key and selected model without a coding runtime', async () => {
    mocks.getSettings.mockReturnValue({
      ...openAiSettings(),
      llmProvider: 'llmgateway',
      llmGatewayApiKey: 'gateway-test-key',
      openaiApiKey: undefined,
      openaiModel: 'deepseek-v4-flash',
    });
    await expect(callLlm('Summarize this', 1024, 0.2, 0)).resolves.toBe('fallback response');
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'gateway-test-key',
      baseURL: 'https://api.llmgateway.io/v1',
      defaultHeaders: { 'x-source': 'mezair' },
    });
    expect(mocks.completionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-v4-flash',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('requires a gateway model instead of silently selecting an OpenAI model', async () => {
    mocks.getSettings.mockReturnValue({
      ...openAiSettings(),
      llmProvider: 'llmgateway',
      llmGatewayApiKey: 'gateway-test-key',
      openaiModel: '',
    });
    await expect(callLlm('Summarize this', 1024, 0.2, 0)).rejects.toThrow(
      'Choose an LLMGateway model',
    );
    expect(mocks.completionCreate).not.toHaveBeenCalled();
  });

  it('uses an explicit designer model when LLMGateway has no global model selected', async () => {
    mocks.getSettings.mockReturnValue({
      ...openAiSettings(),
      llmProvider: 'llmgateway',
      llmGatewayApiKey: 'gateway-test-key',
      openaiModel: '',
    });

    await expect(
      callLlm('Return a theme palette', 3000, 0.4, 0, {
        provider: 'llmgateway',
        model: 'deepseek-v4-flash',
        textOnly: true,
      }),
    ).resolves.toBe('fallback response');
    expect(mocks.completionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'deepseek-v4-flash' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses the explicit saved Foundry route for designer Azure calls', async () => {
    mocks.getSettings.mockReturnValue({
      ...openAiSettings(),
      llmProvider: 'openai',
      openaiApiKey: undefined,
      openaiModel: '',
    });

    await expect(
      callLlm('Return a theme palette', 3000, 0.4, 0, {
        provider: 'azure',
        model: 'theme-deployment',
        textOnly: true,
        azureFoundry: {
          endpoint: 'https://foundry.example.test',
          apiKey: 'saved-foundry-key',
          apiVersion: '2025-01-01-preview',
          deploymentName: 'theme-deployment',
        },
      }),
    ).resolves.toBe('fallback response');

    expect(AzureOpenAI).toHaveBeenCalledWith({
      endpoint: 'https://foundry.example.test',
      apiKey: 'saved-foundry-key',
      apiVersion: '2025-01-01-preview',
    });
    expect(mocks.completionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'theme-deployment' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const completionCalls = mocks.completionCreate.mock.calls.length;
    await expect(
      callLlm('Return a theme palette', 3000, 0.4, 0, {
        provider: 'azure',
        model: 'other-deployment',
        textOnly: true,
        azureFoundry: {
          endpoint: 'https://foundry.example.test',
          apiKey: 'saved-foundry-key',
          apiVersion: '2025-01-01-preview',
          deploymentName: 'theme-deployment',
        },
      }),
    ).rejects.toThrow('must match the configured deployment');
    expect(mocks.completionCreate).toHaveBeenCalledTimes(completionCalls);
  });

  it('does not attempt local routing when max tokens exceed the local cap', async () => {
    const response = await callLlm('review this diff', 8192, 0.2, 0, {
      taskClass: 'code-review',
    });

    expect(response).toBe('fallback response');
    expect(mocks.classifyPromptForLocalModel).not.toHaveBeenCalled();
    expect(mocks.callPreferredLocalModel).not.toHaveBeenCalled();
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
  });
});

describe('Cursor CLI routing', () => {
  it('passes the selected Cursor model without shell interpolation', () => {
    expect(buildCursorPrintArgs('Review this change', 'cursor-grok-4.5-medium')).toEqual([
      '-p',
      '--model',
      'cursor-grok-4.5-medium',
      'Review this change',
    ]);
  });
});

describe('Codex CLI routing', () => {
  it('does not load tools, hooks or global integrations for isolated text generation', () => {
    const args = buildCodexExecArgs('/tmp/output.txt', 'chosen-model', true);
    expect(args).toEqual(
      expect.arrayContaining([
        '--ignore-user-config',
        '--ignore-rules',
        '--ephemeral',
        'features.shell_tool=false',
        'features.apps=false',
        'features.browser_use=false',
        'features.hooks=false',
        'web_search="disabled"',
        'project_doc_max_bytes=0',
        'features.skip_host_skill_discovery=true',
        'skills.include_instructions=false',
        'skills.bundled.enabled=false',
        'cloud.skills.enabled=false',
        '--model',
        'chosen-model',
      ]),
    );
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('uses the supported read-only sandbox for non-interactive prompts', () => {
    expect(buildCodexExecArgs('/tmp/last-message.txt')).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--output-last-message',
      '/tmp/last-message.txt',
      '-',
    ]);
  });
});

describe('utility request budgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLlmClient();
  });
  it('uses an explicit background reasoning budget rather than the chat budget', async () => {
    mocks.getSettings.mockReturnValue({
      llmProvider: 'openai',
      openaiApiKey: 'test',
      openaiModel: 'gpt-6.1-sol',
      reasoningLevel: 'ultra',
    });
    mocks.completionCreate.mockResolvedValue({ choices: [{ message: { content: 'summary' } }] });
    await callLlm('Summarise', 1000, 0.2, 0, {
      provider: 'openai',
      reasoningEffort: 'low',
      priority: 'background',
    });
    expect(mocks.completionCreate.mock.calls.at(-1)?.[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      reasoning_effort: 'low',
    });
    expect(mocks.completionCreate.mock.calls.at(-1)?.[0]).not.toHaveProperty('temperature');
  });
  it('aborts a stalled API request at the overall deadline', async () => {
    mocks.getSettings.mockReturnValue({
      llmProvider: 'openai',
      openaiApiKey: 'test',
      openaiModel: 'gpt-6.1-sol',
    });
    mocks.completionCreate.mockImplementationOnce(
      (_body, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );
    await expect(callLlm('Summarise', 1000, 0.2, 0, { timeoutMs: 20 })).rejects.toThrow(
      'timed out',
    );
  });
  it('passes the chosen reasoning budget to Codex instead of inheriting CLI settings', () => {
    expect(buildCodexExecArgs('/tmp/result', 'gpt-6.1-sol', true, 'medium')).toContain(
      'model_reasoning_effort="medium"',
    );
  });
});

describe('CLI utility routing', () => {
  it.each(['codex', 'cursor', 'devin'] as const)(
    'uses the configured %s model with cancellation',
    async (provider) => {
      mocks.getSettings.mockReturnValue({
        llmProvider: provider,
        openaiModel: 'chosen-model',
        reasoningLevel: 'ultra',
      });
      mocks.runUtilityCli.mockResolvedValue('generated text');
      await expect(
        callLlm('draft', 3000, 0.2, 0, {
          provider,
          reasoningEffort: 'medium',
          textOnly: provider === 'codex',
        }),
      ).resolves.toBe('generated text');
      const [, args, options] = mocks.runUtilityCli.mock.calls.at(-1)!;
      expect(args).toContain('chosen-model');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      if (provider === 'codex') {
        expect(args).toContain('--ignore-user-config');
        expect(args).toContain('model_reasoning_effort="medium"');
        expect(options.cwd).toContain('codex');
      }
    },
  );
});

describe('Azure utility model routing', () => {
  it('uses the configured Azure deployment instead of an unrelated chat model', async () => {
    resetLlmClient();
    mocks.getSettings.mockReturnValue({
      llmProvider: 'azure',
      openaiModel: 'unrelated-chat-model',
    });
    mocks.readFileSync.mockReturnValue(
      'model = "azure-deployment"\n[model_providers.azure]\nbase_url = "https://example.openai.azure.com/openai"\nenv_key = "MEZAIR_TEST_AZURE_KEY"',
    );
    vi.stubEnv('MEZAIR_TEST_AZURE_KEY', 'test-key');
    mocks.completionCreate.mockResolvedValue({ choices: [{ message: { content: 'summary' } }] });
    try {
      await callLlm('Summarise', 1000, 0.2, 0, { provider: 'azure', textOnly: true });
      expect(mocks.completionCreate.mock.calls.at(-1)?.[0].model).toBe('azure-deployment');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
