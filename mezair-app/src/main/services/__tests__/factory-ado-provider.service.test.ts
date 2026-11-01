import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FactoryDefinition, FactoryRun } from '../../../shared/factories.js';
const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../settings.service.js', () => ({ getSettings: () => settings.value }));
import {
  createAdoFactoryProvider,
  type AdoFactoryProviderDependencies,
} from '../factory-ado-provider.service.js';
const head = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  base = 'c'.repeat(40),
  merged = 'd'.repeat(40);
const id = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  settings.value = {};
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(changes: Partial<AdoFactoryProviderDependencies> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-ado-'));
  roots.push(root);
  const factory: FactoryDefinition = {
    id: 'factory',
    workspaceId: 'ws',
    revision: 1,
    activeRevision: 1,
    status: 'active',
    ownerId: 'owner',
    accountScope: 'scope',
    confirmation: 'reviewed',
    createdAt: '',
    updatedAt: '',
    workflow: {} as FactoryDefinition['workflow'],
    definition: {
      name: 'ADO factory',
      workspaceId: 'ws',
      repoId: 'repo',
      delivery: {
        provider: 'ado',
        organizationUrl: 'https://dev.azure.com/acme',
        project: 'App',
        repo: 'app',
        baseBranch: 'main',
      },
      readyLabel: '',
      workItems: {
        provider: 'jira',
        connectionId: 'jira',
        scope: 'https://acme.atlassian.net/APP',
      },
      includeExisting: true,
      workflowTemplateId: 'workflow',
      criteria: ['Checks pass'],
      checks: ['pnpm test'],
      postMergeChecks: ['pnpm test'],
      limits: { repairRounds: 2, maxRunMinutes: 90, maxCommands: 40, maxConcurrentRuns: 2 },
      publication: { enabled: true, draft: true },
      merge: {
        mode: 'auto-merge',
        method: 'squash',
        requiredChecks: ['build'],
        requireApproval: true,
      },
      access: {
        kind: 'organization',
        authorization: 'mezair',
        organizationId: 'org',
        visibility: 'organization',
        members: [],
      },
    },
  };
  const branch = `mezair/factory/${id(factory.id)}/${id('run')}`;
  const run: FactoryRun = {
    id: 'run',
    factoryId: factory.id,
    workspaceId: 'ws',
    revision: 1,
    snapshot: factory,
    issue: {
      number: 'APP-17',
      title: 'Fix',
      body: '',
      url: 'https://acme.atlassian.net/browse/APP-17',
      labels: [],
      state: 'open',
      createdAt: '',
      updatedAt: '',
    },
    stage: 'publishing',
    version: 1,
    repairRounds: 0,
    commandsUsed: 1,
    createdAt: '',
    updatedAt: '',
    deadlineAt: new Date(Date.now() + 600000).toISOString(),
    checkout: { path: path.join(root, id(factory.id), id('run')), branch, baseSha: base },
    evidence: {
      headSha: head,
      treeSha: tree,
      criteria: [],
      commands: [],
      passed: true,
      checkedAt: '',
    },
    pullRequest: {
      number: 42,
      url: '',
      headSha: head,
      branch,
      baseBranch: 'main',
      draft: false,
      repositoryId: 'repo-id',
    },
    receipts: [],
  };
  const pr = {
    pullRequestId: 42,
    description: `Work item\n<!-- mezair-factory-run:${id('run')} -->`,
    status: 'active',
    isDraft: false,
    sourceRefName: `refs/heads/${branch}`,
    targetRefName: 'refs/heads/main',
    repository: { id: 'repo-id', name: 'app', project: { id: 'project-id', name: 'App' } },
    lastMergeSourceCommit: { commitId: head },
    lastMergeCommit: { commitId: merged },
    createdBy: { id: 'executor' },
    reviewers: [{ id: 'reviewer', vote: 10 }],
    mergeStatus: 'succeeded',
  };
  const calls: Array<{ endpoint: string; method: string; body: unknown }> = [];
  let exists = false;
  let loseCreate = false;
  let buildState = 'succeeded';
  const request = vi.fn(
    async (
      _factory: FactoryDefinition,
      endpoint: string,
      method = 'GET',
      body?: unknown,
    ): Promise<unknown> => {
      calls.push({ endpoint, method, body });
      if (endpoint.includes('/iterations/') && endpoint.endsWith('/statuses'))
        return { value: [{ id: 1, context: { name: 'build' }, state: buildState }] };
      if (endpoint.endsWith('/iterations'))
        return { value: [{ id: 2, sourceRefCommit: { commitId: head } }] };
      if (endpoint.includes('/policy/evaluations'))
        return {
          value: [
            {
              status: 'approved',
              configuration: {
                id: 1,
                isEnabled: true,
                isBlocking: true,
                type: { displayName: 'Build' },
              },
            },
            {
              status: 'approved',
              configuration: {
                id: 2,
                isEnabled: true,
                isBlocking: true,
                type: {
                  id: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd',
                  displayName: 'Minimum approval count',
                },
                settings: {
                  minimumApproverCount: 1,
                  creatorVoteCounts: false,
                  resetOnSourcePush: true,
                },
              },
            },
          ],
        };
      if (endpoint.endsWith('/threads'))
        return {
          value: [
            {
              id: 1,
              pullRequestThreadContext: { iterationContext: { secondComparingIteration: 1 } },
              comments: [{ id: 1, content: 'Old comment' }],
            },
            {
              id: 2,
              pullRequestThreadContext: { iterationContext: { secondComparingIteration: 2 } },
              comments: [{ id: 1, content: 'Current comment' }],
            },
          ],
        };
      if (endpoint.includes('/pullRequests?'))
        return { value: exists ? [structuredClone(pr)] : [] };
      if (method === 'POST') {
        exists = true;
        Object.assign(pr, { description: (body as { description: string }).description });
        if (loseCreate) {
          loseCreate = false;
          throw new Error('Lost accepted response');
        }
      }
      if (method === 'PATCH') {
        const update = body as { isDraft?: boolean; status?: string };
        if (update.isDraft !== undefined) pr.isDraft = update.isDraft;
        if (update.status) pr.status = update.status;
      }
      return structuredClone(pr);
    },
  );
  const command = vi.fn<AdoFactoryProviderDependencies['command']>(async (_executable, args) => {
    if (args.includes('get-url')) return 'git@ssh.dev.azure.com:v3/acme/App/app';
    if (args.includes('symbolic-ref')) return branch;
    if (args.includes('rev-parse'))
      return args.at(-1) === 'HEAD^{tree}'
        ? tree
        : args.at(-1)?.startsWith('refs/mezair/')
          ? base
          : head;
    if (args.includes('diff'))
      return 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+safe\n';
    return '';
  });
  const dependencies: Partial<AdoFactoryProviderDependencies> = {
    request,
    command,
    credentials: async () => ({ token: 'api-test-secret', kind: 'bearer' }),
    credentialManager: async () => null,
    currentMode: () => 'on-request',
    knownSecrets: async () => [],
    rootPath: () => root,
    repoPath: () => '/repo',
    ...changes,
  };
  return {
    factory,
    run,
    pr,
    calls,
    request,
    command,
    dependencies,
    provider: createAdoFactoryProvider(dependencies),
    setBuild: (value: string) => {
      buildState = value;
    },
    loseCreate: () => {
      loseCreate = true;
    },
  };
}
describe('Azure DevOps factory delivery', () => {
  it('observes current-iteration checks, policies and feedback without GitHub', async () => {
    const value = await fixture();
    const result = await value.provider.readPullRequest(value.factory, value.run);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'build', status: 'passed', headSha: head }),
        expect.objectContaining({ name: 'Policy: Build (1)', status: 'passed' }),
      ]),
    );
    expect(result.review).toBe('approved');
    expect(result.feedback.map((comment) => comment.body)).toEqual(['Current comment']);
    expect(value.command).not.toHaveBeenCalled();
  });
  it('blocks failed checks and submits completion for the exact verified head without bypass', async () => {
    const value = await fixture();
    value.setBuild('failed');
    await expect(value.provider.requestMerge(value.factory, value.run, 'merge')).rejects.toThrow(
      'checks or reviews',
    );
    expect(value.calls.filter((call) => call.method === 'PATCH')).toEqual([]);
    value.setBuild('succeeded');
    value.pr.isDraft = true;
    const guard = vi.fn(async () => {});
    expect(
      await value.provider.requestMerge(value.factory, value.run, 'merge', guard),
    ).toMatchObject({ state: 'merged', requestedHeadSha: head, mergeCommitSha: merged });
    expect(
      value.calls.find((call) => (call.body as { status?: string })?.status === 'completed')?.body,
    ).toEqual({
      status: 'completed',
      lastMergeSourceCommit: { commitId: head },
      completionOptions: {
        mergeStrategy: 'squash',
        bypassPolicy: false,
        deleteSourceBranch: false,
        transitionWorkItems: false,
      },
    });
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('rejects stale candidate evidence and changed repository identity', async () => {
    const value = await fixture();
    value.run.evidence!.headSha = base;
    await expect(value.provider.requestMerge(value.factory, value.run, 'merge')).rejects.toThrow(
      'stale',
    );
    value.pr.repository.id = 'other-id';
    await expect(value.provider.readPullRequest(value.factory, value.run)).rejects.toThrow(
      'identity changed',
    );
  });
  it('reconciles an accepted but lost PR creation, links the source issue and never duplicates it', async () => {
    const value = await fixture();
    value.loseCreate();
    await expect(
      value.provider.publishPullRequest(value.factory, value.run, 'publish'),
    ).rejects.toThrow('Lost accepted');
    const result = await value.provider.publishPullRequest(value.factory, value.run, 'publish');
    expect(result).toMatchObject({ number: 42, headSha: head, repositoryId: 'repo-id' });
    expect(value.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    const posted = value.calls.find((call) => call.method === 'POST')!.body as {
      description: string;
    };
    expect(posted.description).toContain('https://acme.atlassian.net/browse/APP-17');
    expect(posted.description).not.toContain('Closes #');
    expect(value.command.mock.calls.some((call) => call[1].includes('push'))).toBe(true);
  });
  it('uses GCM directly for Git without exporting a token into the Git process', async () => {
    const value = await fixture({ credentialManager: async () => 'manager' });
    const run = { ...value.run, checkout: undefined, pullRequest: undefined };
    await value.provider.prepareCheckout(value.factory, run, 'checkout');
    const fetch = value.command.mock.calls.find((call) => call[1].includes('fetch'))!;
    expect(fetch[1]).toContain('credential.helper=manager');
    expect(fetch[1]).toContain('credential.useHttpPath=true');
    expect(fetch[1]).toContain('https://dev.azure.com/acme/App/_git/app');
    expect(fetch[3]).toMatchObject({ GCM_INTERACTIVE: '0', GCM_TRACE_SECRETS: '0' });
    expect(JSON.stringify(fetch)).not.toContain('api-test-secret');
    expect(fetch[3]).not.toHaveProperty('GIT_CONFIG_VALUE_0');
  });
  it('rechecks authority after GCM discovery before a network write', async () => {
    let revoked = false;
    const value = await fixture({
      credentialManager: async () => {
        revoked = true;
        return 'manager';
      },
    });
    const guard = async () => {
      if (revoked) throw new Error('Factory revoked');
    };
    await expect(
      value.provider.publishPullRequest(value.factory, value.run, 'publish', guard),
    ).rejects.toThrow('Factory revoked');
    expect(value.command.mock.calls.some((call) => call[1].includes('push'))).toBe(false);
    expect(value.calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('uses the newest status for a current-iteration check', async () => {
    const value = await fixture();
    const provider = createAdoFactoryProvider({
      ...value.dependencies,
      request: async (factory, endpoint, method, body) =>
        endpoint.endsWith('/statuses')
          ? {
              value: [
                { id: 1, context: { name: 'build' }, state: 'succeeded' },
                { id: 2, context: { name: 'build' }, state: 'failed' },
              ],
            }
          : value.request(factory, endpoint, method, body),
    });
    await expect(provider.requestMerge(value.factory, value.run, 'merge')).rejects.toThrow(
      'checks or reviews',
    );
    expect(value.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
  it('holds cancellation pending while an accepted completion remains unresolved', async () => {
    const value = await fixture();
    value.run.mergeReceipt = { state: 'requested', requestedHeadSha: head };
    await expect(value.provider.cancelMerge(value.factory, value.run, 'cancel')).rejects.toThrow(
      'pending',
    );
    value.pr.status = 'completed';
    await expect(
      value.provider.cancelMerge(value.factory, value.run, 'cancel'),
    ).resolves.toBeUndefined();
  });
  it('does not treat a retained reviewer vote as approval of the latest source commit', async () => {
    const value = await fixture();
    const provider = createAdoFactoryProvider({
      ...value.dependencies,
      request: async (factory, endpoint, method, body) => {
        const result = await value.request(factory, endpoint, method, body);
        if (endpoint.includes('/policy/evaluations')) {
          const policies = result as {
            value: Array<{ configuration: { settings?: { resetOnSourcePush: boolean } } }>;
          };
          for (const policy of policies.value)
            if (policy.configuration.settings)
              policy.configuration.settings.resetOnSourcePush = false;
        }
        return result;
      },
    });
    expect((await provider.readPullRequest(value.factory, value.run)).review).toBe('pending');
    await expect(provider.requestMerge(value.factory, value.run, 'merge')).rejects.toThrow(
      'checks or reviews',
    );
    expect(value.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
  it('gets API OAuth credentials from GCM over stdin without persisting or logging them', async () => {
    const value = await fixture();
    const command = vi.fn<AdoFactoryProviderDependencies['command']>(async (_executable, args) => {
      if (args.includes('get')) return 'username=me\npassword=gcm-oauth-secret\n';
      throw new Error('No Azure CLI should be needed');
    });
    const fetch = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
      const path = String(url)
        .split('dev.azure.com/acme')[1]
        .replace(/[?&]api-version=7.1/, '');
      return Response.json(await value.request(value.factory, path));
    });
    vi.stubGlobal('fetch', fetch);
    const provider = createAdoFactoryProvider({
      ...value.dependencies,
      credentials: undefined,
      request: undefined,
      credentialManager: async () => 'manager',
      command,
    });
    await provider.readPullRequest(value.factory, value.run);
    const call = command.mock.calls[0];
    expect(call[1]).toEqual(['credential-manager', 'get']);
    expect(call[4]).toBe('protocol=https\nhost=dev.azure.com\npath=acme/App/_git/app\n\n');
    expect(call[3]).toMatchObject({ GCM_AZREPOS_CREDENTIALTYPE: 'oauth' });
    expect(JSON.stringify(command.mock.calls)).not.toContain('gcm-oauth-secret');
    expect(JSON.stringify(value.factory)).not.toContain('gcm-oauth-secret');
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer gcm-oauth-secret' },
    });
  });
  it('refuses truncated API evidence instead of treating a first page as complete', async () => {
    const value = await fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(value.pr, { headers: { 'x-ms-continuationtoken': 'next-page' } }),
      ),
    );
    const provider = createAdoFactoryProvider({ ...value.dependencies, request: undefined });
    await expect(provider.readPullRequest(value.factory, value.run)).rejects.toThrow(
      'incomplete factory evidence',
    );
  });
});
