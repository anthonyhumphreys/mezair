import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type {
  FactoryDefinition,
  FactoryRun,
  FactoryProvider,
  FactoryPrObservation,
} from '../../shared/factories.js';
import {
  factoryDelivery,
  factoryMatchesRemote,
  factoryIssueLabel,
} from '../../shared/factories.js';
import {
  factoryProviderDefaults,
  type FactoryProviderDependencies,
} from './factory-provider.service.js';
import { createFactoryCheckoutOperations } from './factory-checkout.service.js';
import { getSettings } from './settings.service.js';

const SHA = /^[a-f0-9]{40,64}$/;
const DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const REVIEWER_POLICY = 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd';
const noHooks = process.platform === 'win32' ? 'NUL' : '/dev/null';
const safeId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 24);
type Credentials = { token: string; kind: 'pat' | 'bearer' };
interface Pull {
  pullRequestId: number;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  isDraft: boolean;
  sourceRefName: string;
  targetRefName: string;
  repository: { id: string; name: string; project: { id: string; name: string } };
  forkSource?: unknown;
  lastMergeSourceCommit: { commitId: string };
  lastMergeCommit?: { commitId: string };
  mergeId?: string;
  mergeStatus?: string;
  completionQueueTime?: string;
  mergeFailureMessage?: string;
  autoCompleteSetBy?: { id?: string } | null;
  createdBy?: { id: string };
  reviewers?: Array<{ id: string; vote: number; isContainer?: boolean }>;
}
interface Policy {
  status: string;
  configuration: {
    id: number;
    isEnabled: boolean;
    isBlocking: boolean;
    type: { id?: string; displayName: string };
    settings?: {
      minimumApproverCount?: number;
      creatorVoteCounts?: boolean;
      resetOnSourcePush?: boolean;
      requireVoteOnLastIteration?: boolean;
      requireVoteOnEachIteration?: boolean;
    };
  };
}
interface Status {
  id: number;
  context: { name: string; genre?: string };
  state: string;
  iterationId?: number;
}
interface Iteration {
  id: number;
  sourceRefCommit: { commitId: string };
}
interface Thread {
  id: number;
  pullRequestThreadContext?: { iterationContext?: { secondComparingIteration?: number } };
  comments?: Array<{ id: number; content?: string; commentType?: string }>;
}
export interface AdoFactoryProviderDependencies extends FactoryProviderDependencies {
  credentialManager?(): Promise<'manager' | 'manager-core' | null>;
  credentials(factory: FactoryDefinition): Promise<Credentials>;
  request(
    factory: FactoryDefinition,
    path: string,
    method?: string,
    body?: unknown,
  ): Promise<unknown>;
}

function source(factory: FactoryDefinition) {
  const value = factoryDelivery(factory.definition);
  if (
    value.provider !== 'ado' ||
    !/^https:\/\/dev\.azure\.com\/[a-z0-9-]+$/i.test(value.organizationUrl) ||
    [value.project, value.repo].some(
      (part) =>
        !part ||
        part.length > 200 ||
        ['.', '..'].includes(part) ||
        /[/\\?#]/.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32),
    )
  )
    throw new Error('Invalid Azure DevOps factory delivery source.');
  return {
    ...value,
    endpoint: `/${encodeURIComponent(value.project)}/_apis/git/repositories/${encodeURIComponent(value.repo)}`,
    remoteUrl: `${value.organizationUrl}/${encodeURIComponent(value.project)}/_git/${encodeURIComponent(value.repo)}`,
  };
}
function authorization(credentials: Credentials): string {
  if (!credentials.token || /[\r\n]/.test(credentials.token))
    throw new Error('Azure DevOps credentials are unavailable.');
  return credentials.kind === 'pat'
    ? `Basic ${Buffer.from(`:${credentials.token}`).toString('base64')}`
    : `Bearer ${credentials.token}`;
}

/** GCM owns stored credentials. The controller only holds short-lived API tokens in memory. */
export function createAdoFactoryProvider(
  overrides: Partial<AdoFactoryProviderDependencies> = {},
): FactoryProvider {
  const io = { ...factoryProviderDefaults, ...overrides };
  const context = new AsyncLocalStorage<{
    factory: FactoryDefinition;
    credentials?: Promise<Credentials>;
    manager?: Promise<'manager' | 'manager-core' | null>;
    guard?: () => Promise<void>;
  }>();
  const managerEnvironment = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL ?? path.join(os.homedir(), '.gitconfig'),
    GCM_INTERACTIVE: '0',
    GCM_TRACE: '0',
    GCM_TRACE_SECRETS: '0',
    GIT_TRACE: '0',
    GIT_TRACE_CURL: '0',
    GIT_CURL_VERBOSE: '0',
  };
  async function credentialManager(): Promise<'manager' | 'manager-core' | null> {
    if (overrides.credentialManager) return overrides.credentialManager();
    for (const helper of ['manager', 'manager-core'] as const) {
      try {
        if (
          (
            await io.command(
              'git',
              [`credential-${helper}`, '--version'],
              undefined,
              managerEnvironment,
            )
          ).trim()
        )
          return helper;
      } catch {
        /* Try the next supported GCM executable. */
      }
    }
    return null;
  }
  function manager() {
    const current = context.getStore();
    if (!current) return credentialManager();
    current.manager ??= credentialManager();
    return current.manager;
  }
  async function credentials(factory: FactoryDefinition): Promise<Credentials> {
    if (overrides.credentials) return overrides.credentials(factory);
    const settings = getSettings(),
      src = source(factory);
    const helper = await manager();
    if (helper) {
      try {
        const target = new URL(src.remoteUrl);
        const output = await io.command(
          'git',
          [`credential-${helper}`, 'get'],
          undefined,
          { ...managerEnvironment, GCM_AZREPOS_CREDENTIALTYPE: 'oauth' },
          `protocol=https\nhost=${target.host}\npath=${target.pathname.slice(1)}\n\n`,
        );
        const token = output
          .split(/\r?\n/)
          .find((line) => line.startsWith('password='))
          ?.slice('password='.length);
        if (token) return { token, kind: 'bearer' };
      } catch {
        /* An existing Azure CLI session can supply API authentication. */
      }
    }
    try {
      const token = await io.command('az', [
        'account',
        'get-access-token',
        '--resource',
        DEVOPS_RESOURCE,
        '--query',
        'accessToken',
        '--output',
        'tsv',
        '--only-show-errors',
      ]);
      if (token.trim()) return { token: token.trim(), kind: 'bearer' };
    } catch {
      /* Retain compatibility with credentials already saved in the settings vault. */
    }
    const connection = settings.workItemConnections?.find(
      (connection) =>
        connection.provider === 'ado' &&
        connection.adoOrganizationUrl?.replace(/\/$/, '').toLowerCase() ===
          src.organizationUrl.toLowerCase() &&
        connection.adoPat,
    );
    const pat =
      connection?.adoPat ??
      (settings.adoOrganizationUrl?.replace(/\/$/, '').toLowerCase() ===
      src.organizationUrl.toLowerCase()
        ? settings.adoPat
        : undefined) ??
      process.env.AZURE_DEVOPS_EXT_PAT;
    if (pat) return { token: pat, kind: 'pat' };
    throw new Error(
      'Sign in to this Azure DevOps organisation through Git Credential Manager or az login.',
    );
  }
  async function auth(factory: FactoryDefinition) {
    const current = context.getStore();
    if (!current || current.factory !== factory) return credentials(factory);
    current.credentials ??= credentials(factory);
    return current.credentials;
  }
  async function request<T>(
    factory: FactoryDefinition,
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    if (overrides.request) {
      if (method !== 'GET') await context.getStore()?.guard?.();
      return (await overrides.request(factory, path, method, body)) as T;
    }
    const src = source(factory);
    const header = authorization(await auth(factory));
    if (method !== 'GET') await context.getStore()?.guard?.();
    const response = await fetch(
      `${src.organizationUrl}${path}${path.includes('?') ? '&' : '?'}api-version=7.1`,
      {
        method,
        headers: {
          Authorization: header,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Azure DevOps factory request failed: HTTP ${response.status}. Reconcile before retrying.`,
      );
    if (response.headers.get('x-ms-continuationtoken')) {
      await response.body?.cancel();
      throw new Error('Azure DevOps returned incomplete factory evidence.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Azure DevOps returned no response body.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024)
          throw new Error('Azure DevOps response exceeds the factory read limit.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }
  async function list<T>(factory: FactoryDefinition, path: string): Promise<T[]> {
    const result = await request<{ value: T[] }>(factory, path);
    if (!Array.isArray(result.value) || result.value.length >= 100)
      throw new Error('Unable to establish bounded Azure DevOps evidence.');
    return result.value;
  }
  const git = async (cwd: string, ...args: string[]) => {
    let environment: Record<string, string> | undefined;
    const credentialOptions: string[] = [];
    if (args.includes('fetch') || args.includes('push')) {
      const current = context.getStore();
      if (!current) throw new Error('Azure DevOps delivery context is unavailable.');
      const src = source(current.factory);
      args = args.map((arg) => (arg === 'origin' ? src.remoteUrl : arg));
      const helper = await manager();
      if (helper) {
        credentialOptions.push(
          '-c',
          `credential.helper=${helper}`,
          '-c',
          'credential.useHttpPath=true',
        );
        environment = managerEnvironment;
      } else {
        environment = {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: `http.${src.organizationUrl}/.extraheader`,
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: ${authorization(await auth(current.factory))}`,
        };
      }
      await current.guard?.();
    }
    return io.command(
      'git',
      [
        '-c',
        `core.hooksPath=${noHooks}`,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        '-c',
        'credential.helper=',
        ...credentialOptions,
        '-c',
        'http.followRedirects=false',
        '-c',
        'http.sslVerify=true',
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'protocol.file.allow=never',
        '-C',
        cwd,
        ...args,
      ],
      cwd,
      environment,
    );
  };
  const marker = (run: FactoryRun) => `<!-- mezair-factory-run:${safeId(run.id)} -->`;
  function assertPull(factory: FactoryDefinition, run: FactoryRun, value: Pull) {
    const src = source(factory),
      branch = run.checkout?.branch ?? run.pullRequest?.branch;
    if (
      !branch ||
      !Number.isSafeInteger(value.pullRequestId) ||
      value.pullRequestId < 1 ||
      value.repository?.name.toLowerCase() !== src.repo.toLowerCase() ||
      value.repository.project?.name.toLowerCase() !== src.project.toLowerCase() ||
      value.forkSource ||
      value.sourceRefName !== `refs/heads/${branch}` ||
      value.targetRefName !== `refs/heads/${src.baseBranch}` ||
      !SHA.test(value.lastMergeSourceCommit?.commitId) ||
      !value.description?.includes(marker(run))
    )
      throw new Error('Azure DevOps PR source, branch, target or factory ownership changed.');
    if (run.pullRequest?.repositoryId && run.pullRequest.repositoryId !== value.repository.id)
      throw new Error('Azure DevOps repository identity changed.');
  }
  async function pull(factory: FactoryDefinition, run: FactoryRun): Promise<Pull> {
    if (!run.pullRequest) throw new Error('No factory pull request.');
    const value = await request<Pull>(
      factory,
      `${source(factory).endpoint}/pullRequests/${run.pullRequest.number}`,
    );
    assertPull(factory, run, value);
    if (value.pullRequestId !== run.pullRequest.number)
      throw new Error('Azure DevOps returned a different PR.');
    return value;
  }
  const checkout = createFactoryCheckoutOperations(io, {
    git,
    assertOrigin(factory, remote) {
      if (!factoryMatchesRemote(factory.definition, remote))
        throw new Error('Factory origin changed.');
    },
    readPrHead: async (factory, run) => (await pull(factory, run)).lastMergeSourceCommit.commitId,
  });
  async function authorize(
    factory: FactoryDefinition,
    run: FactoryRun,
    action: 'publish' | 'merge',
  ) {
    if (
      factory.status !== 'active' ||
      !factory.definition.publication.enabled ||
      io.currentMode() === 'read-only'
    )
      throw new Error('Factory publication is inactive or read-only.');
    await io.authorize?.(factory, run, action);
  }
  async function observe(
    factory: FactoryDefinition,
    run: FactoryRun,
  ): Promise<FactoryPrObservation> {
    const value = await pull(factory, run),
      src = source(factory),
      head = value.lastMergeSourceCommit.commitId;
    const root = `${src.endpoint}/pullRequests/${value.pullRequestId}`;
    const iterations = await list<Iteration>(factory, `${root}/iterations`);
    const iteration = iterations
      .filter((iteration) => iteration.sourceRefCommit?.commitId === head)
      .at(-1);
    if (!iteration) throw new Error('Azure DevOps did not establish the current PR iteration.');
    const [policies, statuses, threads] = await Promise.all([
      list<Policy>(
        factory,
        `/${encodeURIComponent(src.project)}/_apis/policy/evaluations?artifactId=${encodeURIComponent(`vstfs:///CodeReview/CodeReviewId/${value.repository.project.id}/${value.pullRequestId}`)}&$top=100`,
      ),
      list<Status>(factory, `${root}/iterations/${iteration.id}/statuses`),
      list<Thread>(factory, `${root}/threads`),
    ]);
    const checks: FactoryPrObservation['checks'] = [];
    for (const policy of policies.filter(
      (policy) => policy.configuration.isEnabled && policy.configuration.isBlocking,
    )) {
      checks.push({
        name: `Policy: ${policy.configuration.type.displayName} (${policy.configuration.id})`,
        headSha: head,
        status: ['approved', 'notApplicable'].includes(policy.status)
          ? 'passed'
          : ['rejected', 'broken'].includes(policy.status)
            ? 'failed'
            : 'pending',
      });
    }
    const currentStatuses = [...statuses].sort((a, b) => b.id - a.id);
    const names = new Set([
      ...factory.definition.merge.requiredChecks,
      ...currentStatuses.map((status) =>
        status.context.genre
          ? `${status.context.genre}/${status.context.name}`
          : status.context.name,
      ),
    ]);
    for (const name of names) {
      const status = currentStatuses.find(
        (status) =>
          status.context.name === name || `${status.context.genre}/${status.context.name}` === name,
      );
      checks.push({
        name,
        headSha: head,
        status: !status
          ? 'pending'
          : ['succeeded', 'notApplicable'].includes(status.state)
            ? 'passed'
            : ['failed', 'error'].includes(status.state)
              ? 'failed'
              : 'pending',
      });
    }
    const reviewers = (value.reviewers ?? []).filter(
      (reviewer) => !reviewer.isContainer && reviewer.id !== value.createdBy?.id,
    );
    // PR reviewer votes have no commit identity. Let a blocking provider policy
    // establish approval after the latest source push instead of attributing an
    // old vote to the current head (isReapprove is not a freshness indicator).
    const headApprovalPolicy = policies.find(({ configuration }) => {
      const settings = configuration.settings;
      return (
        configuration.isEnabled &&
        configuration.isBlocking &&
        configuration.type.id?.toLowerCase() === REVIEWER_POLICY &&
        (settings?.minimumApproverCount ?? 0) > 0 &&
        settings?.creatorVoteCounts === false &&
        (settings.resetOnSourcePush === true ||
          settings.requireVoteOnLastIteration === true ||
          settings.requireVoteOnEachIteration === true)
      );
    });
    if (factory.definition.merge.requireApproval && !headApprovalPolicy)
      checks.push({
        name: 'Configure a blocking reviewer policy requiring approval after new pushes',
        headSha: head,
        status: 'pending',
      });
    const review: FactoryPrObservation['review'] = reviewers.some((reviewer) => reviewer.vote < 0)
      ? 'changes-requested'
      : !factory.definition.merge.requireApproval
        ? 'not-required'
        : headApprovalPolicy?.status === 'approved' &&
            reviewers.some((reviewer) => reviewer.vote >= 5)
          ? 'approved'
          : 'pending';
    const feedback = threads
      .filter(
        (thread) =>
          thread.pullRequestThreadContext?.iterationContext?.secondComparingIteration ===
          iteration.id,
      )
      .flatMap((thread) =>
        (thread.comments ?? [])
          .filter((comment) => comment.content && comment.commentType !== 'system')
          .map((comment) => ({
            id: `${thread.id}:${comment.id}`,
            body: comment.content!.slice(0, 4000),
            headSha: head,
          })),
      )
      .slice(-40);
    const fresh = await pull(factory, run);
    if (fresh.lastMergeSourceCommit.commitId !== head)
      throw new Error('PR head changed while observing Azure DevOps checks.');
    return {
      headSha: head,
      state:
        value.status === 'completed' ? 'merged' : value.status === 'abandoned' ? 'closed' : 'open',
      draft: value.isDraft,
      checks,
      review,
      feedback,
      mergeCommitSha: value.status === 'completed' ? value.lastMergeCommit?.commitId : undefined,
      mergeQueued: value.status === 'active' && Boolean(value.completionQueueTime),
      mergeAutoEnabled: Boolean(value.autoCompleteSetBy?.id),
      observedAt: new Date().toISOString(),
    };
  }
  const operations: FactoryProvider = {
    listIssues: (factory, since) => io.intake.listIssues(factory, since),
    readIssue: (factory, id) => io.intake.readIssue(factory, id),
    prepareCheckout: checkout.prepareCheckout,
    verifyCheckout: (factory, run, _key, guard) =>
      checkout.evidence(factory, run, factory.definition.checks, false, guard),
    async publishPullRequest(factory, run, _key, guard) {
      await authorize(factory, run, 'publish');
      const cwd = await checkout.checkoutIdentity(factory, run),
        src = source(factory);
      const head = await git(cwd, 'rev-parse', 'HEAD'),
        tree = await git(cwd, 'rev-parse', 'HEAD^{tree}');
      if (
        !run.evidence?.passed ||
        run.evidence.headSha !== head ||
        run.evidence.treeSha !== tree ||
        (await git(cwd, 'status', '--porcelain'))
      )
        throw new Error('Publication needs current verified committed source.');
      await checkout.scanCandidateDiff(cwd, run.checkout!.baseSha, head);
      const candidates = (
        await list<Pull>(
          factory,
          `${src.endpoint}/pullRequests?searchCriteria.status=all&searchCriteria.sourceRefName=${encodeURIComponent(`refs/heads/${run.checkout!.branch}`)}&searchCriteria.targetRefName=${encodeURIComponent(`refs/heads/${src.baseBranch}`)}&$top=100`,
        )
      ).filter((value) => value.description?.includes(marker(run)));
      if (candidates.length > 1 || (candidates[0] && candidates[0].status !== 'active'))
        throw new Error('The factory PR is duplicated or closed.');
      await authorize(factory, run, 'publish');
      await guard?.();
      await git(cwd, 'push', src.remoteUrl, `HEAD:refs/heads/${run.checkout!.branch}`);
      await guard?.();
      const created =
        candidates[0] ??
        (await request<Pull>(factory, `${src.endpoint}/pullRequests`, 'POST', {
          sourceRefName: `refs/heads/${run.checkout!.branch}`,
          targetRefName: `refs/heads/${src.baseBranch}`,
          title: `${run.issue.title.slice(0, 200)} (${factoryIssueLabel(run.issue)})`,
          description: `Work item: ${run.issue.url}\n\n${marker(run)}`,
          isDraft: factory.definition.publication.draft,
        }));
      assertPull(factory, run, created);
      const verified = await request<Pull>(
        factory,
        `${src.endpoint}/pullRequests/${created.pullRequestId}`,
      );
      assertPull(factory, run, verified);
      if (verified.lastMergeSourceCommit.commitId !== head)
        throw new Error('Published PR head does not match the verified candidate.');
      return {
        number: verified.pullRequestId,
        url: `${src.remoteUrl}/pullrequest/${verified.pullRequestId}`,
        headSha: head,
        branch: run.checkout!.branch,
        baseBranch: src.baseBranch,
        draft: verified.isDraft,
        repositoryId: verified.repository.id,
      };
    },
    readPullRequest: observe,
    async requestMerge(factory, run, _key, guard) {
      await authorize(factory, run, 'merge');
      const expected = run.pullRequest?.headSha;
      const check = (value: FactoryPrObservation) => {
        if (
          !expected ||
          value.headSha !== expected ||
          !run.evidence?.passed ||
          run.evidence.headSha !== expected
        )
          throw new Error('Merge evidence is stale.');
        if (
          value.state !== 'open' ||
          value.checks.some((check) => check.status !== 'passed') ||
          !['approved', 'not-required'].includes(value.review)
        )
          throw new Error('Required Azure DevOps checks or reviews are not satisfied.');
      };
      let observed = await observe(factory, run);
      if (observed.state === 'merged' && observed.headSha === expected)
        return {
          requestedHeadSha: expected!,
          state: 'merged',
          mergeCommitSha: observed.mergeCommitSha,
        };
      check(observed);
      if (factory.definition.merge.mode === 'human-approved' && run.mergeApprovalHead !== expected)
        throw new Error('Current-head human merge approval is required.');
      const root = `${source(factory).endpoint}/pullRequests/${run.pullRequest!.number}`;
      if (observed.mergeQueued || run.mergeReceipt?.state === 'requested') {
        const current = await pull(factory, run);
        if (['failure', 'conflicts', 'rejectedByPolicy'].includes(current.mergeStatus ?? ''))
          throw new Error('Azure DevOps rejected merge; reconcile before retrying.');
        return {
          requestedHeadSha: expected!,
          state: 'requested',
          providerRequestId: current.mergeId,
        };
      }
      if (observed.draft) {
        await guard?.();
        await request(factory, root, 'PATCH', { isDraft: false });
        observed = await observe(factory, run);
        check(observed);
        if (observed.draft) throw new Error('Azure DevOps PR is still a draft.');
      }
      await authorize(factory, run, 'merge');
      await guard?.();
      const result = await request<Pull>(factory, root, 'PATCH', {
        status: 'completed',
        lastMergeSourceCommit: { commitId: expected },
        completionOptions: {
          mergeStrategy:
            factory.definition.merge.method === 'merge'
              ? 'noFastForward'
              : factory.definition.merge.method,
          bypassPolicy: false,
          deleteSourceBranch: false,
          transitionWorkItems: false,
        },
      });
      assertPull(factory, run, result);
      if (result.lastMergeSourceCommit.commitId !== expected)
        throw new Error('Azure DevOps completion head changed.');
      if (
        result.status !== 'completed' &&
        ['failure', 'conflicts', 'rejectedByPolicy'].includes(result.mergeStatus ?? '')
      )
        throw new Error('Azure DevOps rejected the merge.');
      return {
        requestedHeadSha: expected!,
        state: result.status === 'completed' ? 'merged' : 'requested',
        providerRequestId: result.mergeId,
        mergeCommitSha:
          result.status === 'completed' ? result.lastMergeCommit?.commitId : undefined,
      };
    },
    async cancelMerge(factory, run, _key, guard) {
      let value = await pull(factory, run);
      if (value.status === 'completed') return;
      if (value.autoCompleteSetBy?.id) {
        await guard?.();
        await request(
          factory,
          `${source(factory).endpoint}/pullRequests/${value.pullRequestId}`,
          'PATCH',
          { autoCompleteSetBy: null },
        );
        value = await pull(factory, run);
        if (value.autoCompleteSetBy?.id)
          throw new Error('Azure DevOps automatic completion cancellation is uncertain.');
      }
      if (
        (run.mergeReceipt?.state === 'requested' || value.completionQueueTime) &&
        value.status === 'active' &&
        !['failure', 'conflicts', 'rejectedByPolicy'].includes(value.mergeStatus ?? '')
      )
        throw new Error(
          'Azure DevOps completion is still pending; cancellation remains uncertain.',
        );
    },
    async verifyMerged(factory, run, _key, guard) {
      const value = await pull(factory, run);
      if (
        value.status !== 'completed' ||
        !value.lastMergeCommit?.commitId ||
        !SHA.test(value.lastMergeCommit.commitId)
      )
        throw new Error('Azure DevOps has not confirmed merge.');
      return checkout.verifyMerged(factory, run, value.lastMergeCommit.commitId, guard);
    },
  };
  return {
    listIssues: (factory, since) =>
      context.run({ factory }, () => operations.listIssues(factory, since)),
    readIssue: (factory, id) => context.run({ factory }, () => operations.readIssue(factory, id)),
    prepareCheckout: (factory, run, key, guard) =>
      context.run({ factory, guard }, () => operations.prepareCheckout(factory, run, key, guard)),
    verifyCheckout: (factory, run, key, guard) =>
      context.run({ factory, guard }, () => operations.verifyCheckout(factory, run, key, guard)),
    publishPullRequest: (factory, run, key, guard) =>
      context.run({ factory, guard }, () =>
        operations.publishPullRequest(factory, run, key, guard),
      ),
    readPullRequest: (factory, run) =>
      context.run({ factory }, () => operations.readPullRequest(factory, run)),
    requestMerge: (factory, run, key, guard) =>
      context.run({ factory, guard }, () => operations.requestMerge(factory, run, key, guard)),
    cancelMerge: (factory, run, key, guard) =>
      context.run({ factory, guard }, () => operations.cancelMerge(factory, run, key, guard)),
    verifyMerged: (factory, run, key, guard) =>
      context.run({ factory, guard }, () => operations.verifyMerged(factory, run, key, guard)),
  };
}
