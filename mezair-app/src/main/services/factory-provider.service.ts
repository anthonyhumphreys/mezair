import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  FactoryDefinition,
  FactoryRun,
  FactoryIssue,
  FactoryProvider,
  FactoryPrObservation,
} from '../../shared/factories.js';
import type { ValidationSurfaceData } from '../../shared/surfaces/kinds/validation.js';
import { getDb } from '../db/database.js';
import { providerSpawnEnv } from './agent-spawn-env.js';
import { getSettings } from './settings.service.js';
import { captureReviewSnapshot } from './review-snapshot.service.js';
import { runVerificationCommand } from './mesh-worktree.service.js';
import { getKnownSecretsForPublication } from './share.service.js';
import { factoryWorkItemIntake } from './factory-workitems.service.js';
import {
  factoryIssueLabel,
  factoryDelivery,
  factoryReadyLabel,
  factoryMatchesRemote,
} from '../../shared/factories.js';

import { createFactoryCheckoutOperations } from './factory-checkout.service.js';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40,64}$/;
const safeId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 24);
const NO_HOOKS = process.platform === 'win32' ? 'NUL' : '/dev/null';
type Json = Record<string, unknown>;
interface Pull extends Json {
  number: number;
  html_url: string;
  node_id: string;
  body: string;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  merge_commit_sha?: string;
  mergeable_state?: string;
  auto_merge?: { enabled_by?: unknown; merge_method?: string } | null;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
}
export interface FactoryProviderDependencies {
  intake: Pick<FactoryProvider, 'listIssues' | 'readIssue'>;
  command(
    executable: string,
    args: string[],
    cwd?: string,
    environment?: Record<string, string>,
    input?: string,
  ): Promise<string>;
  repoPath(repoId: string): string;
  rootPath(): string;
  validation(run: FactoryRun): Promise<ValidationSurfaceData[]>;
  verify: typeof runVerificationCommand;
  currentMode(): ReturnType<typeof getSettings>['codexMode'];
  snapshot: typeof captureReviewSnapshot;
  knownSecrets(): Promise<string[]>;
  /** Rechecked before every remote mutation; injected by the controller. */
  authorize?(
    factory: FactoryDefinition,
    run: FactoryRun,
    action: 'publish' | 'merge',
  ): Promise<void>;
}
export const factoryProviderDefaults: FactoryProviderDependencies = {
  intake: factoryWorkItemIntake,
  async command(executable, args, cwd, environment, input) {
    try {
      const env = providerSpawnEnv(
        executable === 'git'
          ? {
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
              GIT_TERMINAL_PROMPT: '0',
            }
          : undefined,
      );
      const options = {
        cwd,
        env: { ...env, ...environment },
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
      };
      const result =
        input === undefined
          ? await exec(executable, args, options)
          : await new Promise<{ stdout: string }>((resolve, reject) => {
              const child = execFile(executable, args, options, (error, stdout) =>
                error ? reject(error) : resolve({ stdout }),
              );
              child.stdin?.on('error', () => {});
              child.stdin?.end(input);
            });
      return result.stdout.trim();
    } catch {
      throw new Error(
        `Factory ${executable} operation failed; reconcile provider state before retrying.`,
      );
    }
  },
  repoPath(id) {
    const row = getDb().prepare('SELECT path FROM repos WHERE id = ?').get(id) as
      { path: string } | undefined;
    if (!row) throw new Error('Factory repository is unavailable.');
    return row.path;
  },
  rootPath: () => path.join(path.dirname(getDb().name), 'factory-worktrees'),
  async validation(run) {
    if (!run.workflowRunId) return [];
    const rows = getDb()
      .prepare(
        `SELECT intent_json FROM agent_ui_intents WHERE workspace_id = ? AND kind = 'surface' AND json_extract(intent_json, '$.payload.surfaceKind') = 'validation' AND json_extract(intent_json, '$.payload.data.workflowRunId') = ?`,
      )
      .all(run.workspaceId, run.workflowRunId) as { intent_json: string }[];
    return rows.flatMap((row) => {
      const intent = JSON.parse(row.intent_json) as {
        payload: { supersededBy?: string; data: ValidationSurfaceData };
      };
      return intent.payload.supersededBy ? [] : [intent.payload.data];
    });
  },
  verify: runVerificationCommand,
  currentMode: () => getSettings().codexMode,
  snapshot: captureReviewSnapshot,
  knownSecrets: getKnownSecretsForPublication,
};

/** All provider writes occur here, never through issue/comment-authored commands. */
export function createGitHubFactoryProvider(
  overrides: Partial<FactoryProviderDependencies> = {},
): FactoryProvider {
  const io = { ...factoryProviderDefaults, ...overrides };
  const git = (cwd: string, ...args: string[]) =>
    io.command(
      'git',
      [
        '-c',
        `core.hooksPath=${NO_HOOKS}`,
        '-c',
        'core.fsmonitor=false',
        // Sealing must never invoke repository-configured signing commands with delivery credentials.
        '-c',
        'commit.gpgSign=false',
        '-c',
        'tag.gpgSign=false',
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'protocol.file.allow=never',
        '-C',
        cwd,
        ...args,
      ],
      cwd,
    );
  function source(factory: FactoryDefinition) {
    const delivery = factoryDelivery(factory.definition);
    if (delivery.provider !== 'github') throw new Error('This delivery adapter requires GitHub.');
    const value = { ...delivery, label: factoryReadyLabel(factory.definition) };
    const host = value.host.toLowerCase();
    const owner = value.owner.toLowerCase();
    const repo = value.repo.toLowerCase();
    if (
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(
        host,
      ) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner) ||
      !/^[a-z0-9_.-]{1,100}$/.test(repo) ||
      repo === '.' ||
      repo === '..' ||
      value.label.length > 100 ||
      !value.baseBranch.trim() ||
      value.baseBranch.length > 255
    ) {
      throw new Error('Invalid factory GitHub source.');
    }
    return {
      ...value,
      host,
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      endpoint: `repos/${owner}/${repo}`,
    };
  }
  async function api<T>(
    factory: FactoryDefinition,
    endpoint: string,
    method = 'GET',
    fields?: Json,
  ): Promise<T> {
    const { host } = source(factory);
    const args = [
      'api',
      '--hostname',
      host,
      '--method',
      method,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
      endpoint,
    ];
    for (const [key, value] of Object.entries(fields ?? {}))
      args.push('-F', `${key}=${String(value)}`);
    return JSON.parse(await io.command('gh', args)) as T;
  }
  async function pages<T>(factory: FactoryDefinition, endpoint: string): Promise<T[]> {
    const output: T[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await api<T[]>(
        factory,
        `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub page.');
      output.push(...batch);
      if (batch.length < 100) return output;
    }
    throw new Error('GitHub result exceeded the bounded factory intake. Narrow the issue label.');
  }
  function issue(value: Json): FactoryIssue {
    const labels = ((value.labels as { name: string }[]) ?? []).map((x) => x.name);
    if (
      !Number.isSafeInteger(value.number) ||
      typeof value.title !== 'string' ||
      (typeof value.body !== 'string' && value.body !== null)
    )
      throw new Error('Invalid GitHub issue.');
    return {
      number: value.number as number,
      title: (value.title as string).slice(0, 1000),
      body: String(value.body ?? '').slice(0, 60000),
      url: String(value.html_url),
      labels,
      state: value.state === 'open' ? 'open' : 'closed',
      createdAt: String(value.created_at),
      updatedAt: String(value.updated_at),
    };
  }
  function assertPull(factory: FactoryDefinition, run: FactoryRun, pull: Pull) {
    const src = source(factory),
      expectedBranch = run.checkout?.branch ?? run.pullRequest?.branch;
    if (
      !expectedBranch ||
      pull.head.ref !== expectedBranch ||
      pull.head.repo?.full_name.toLowerCase() !== src.fullName.toLowerCase() ||
      pull.base.repo.full_name.toLowerCase() !== src.fullName.toLowerCase() ||
      pull.base.ref !== src.baseBranch ||
      !SHA.test(pull.head.sha)
    )
      throw new Error('The factory PR source, branch or base changed.');
    if (!pull.body?.includes(marker(run)))
      throw new Error('The pull request is not owned by this factory run.');
  }
  const marker = (run: FactoryRun) => `<!-- mezair-factory-run:${safeId(run.id)} -->`;
  async function pull(factory: FactoryDefinition, run: FactoryRun): Promise<Pull> {
    if (!run.pullRequest) throw new Error('No factory pull request.');
    const value = await api<Pull>(
      factory,
      `${source(factory).endpoint}/pulls/${run.pullRequest.number}`,
    );
    assertPull(factory, run, value);
    return value;
  }
  async function mergeState(
    factory: FactoryDefinition,
    nodeId: string,
  ): Promise<{ mergeQueued: boolean; mergeAutoEnabled: boolean }> {
    const result = await api<{
      data?: {
        node?: {
          isInMergeQueue?: boolean;
          mergeQueueEntry?: { id?: string } | null;
          autoMergeRequest?: { enabledAt?: string } | null;
        } | null;
      };
    }>(factory, 'graphql', 'POST', {
      query:
        'query($id:ID!){node(id:$id){... on PullRequest { isInMergeQueue mergeQueueEntry { id } autoMergeRequest { enabledAt } }}}',
      id: nodeId,
    });
    const node = result.data?.node;
    if (!node) throw new Error('GitHub merge queue state could not be confirmed.');
    return {
      mergeQueued: node.isInMergeQueue === true || Boolean(node.mergeQueueEntry),
      mergeAutoEnabled: Boolean(node.autoMergeRequest),
    };
  }
  async function authorize(
    factory: FactoryDefinition,
    run: FactoryRun,
    action: 'publish' | 'merge',
  ) {
    if (factory.status !== 'active' || !factory.definition.publication.enabled)
      throw new Error('Factory publication is inactive.');
    if (io.currentMode() === 'read-only') throw new Error('Current access is read-only.');
    await io.authorize?.(factory, run, action);
  }
  const checkout = createFactoryCheckoutOperations(io, {
    git,
    assertOrigin(factory, remote) {
      if (!factoryMatchesRemote(factory.definition, remote))
        throw new Error('Factory origin changed.');
    },
    readPrHead: async (factory, run) => (await pull(factory, run)).head.sha,
  });
  const { checkoutIdentity, evidence, scanCandidateDiff, prepareCheckout } = checkout;
  async function observe(
    factory: FactoryDefinition,
    run: FactoryRun,
  ): Promise<FactoryPrObservation> {
    const value = await pull(factory, run),
      root = source(factory).endpoint,
      sha = value.head.sha;
    if (run.mergeReceipt?.providerRequestId && !value.merged) {
      const asyncMerge = await api<{ status: string }>(
        factory,
        `${root}/pulls/${value.number}/merge-async/${encodeURIComponent(run.mergeReceipt.providerRequestId)}`,
      );
      if (asyncMerge.status === 'failed')
        throw new Error('GitHub rejected the asynchronous merge request; reconcile before retry.');
    }
    const [checkRuns, statuses, reviews, rules, merge] = await Promise.all([
      api<{ check_runs: Json[] }>(factory, `${root}/commits/${sha}/check-runs?per_page=100`),
      api<{ statuses: Json[] }>(factory, `${root}/commits/${sha}/status?per_page=100`),
      pages<Json>(factory, `${root}/pulls/${value.number}/reviews`),
      api<Json[]>(factory, `${root}/rules/branches/${encodeURIComponent(value.base.ref)}`),
      mergeState(factory, value.node_id),
    ]);
    if (
      !Array.isArray(rules) ||
      checkRuns.check_runs.length >= 100 ||
      statuses.statuses.length >= 100
    )
      throw new Error('Unable to establish bounded required-check evidence.');
    const checks: FactoryPrObservation['checks'] = [];
    const required = new Set(factory.definition.merge.requiredChecks);
    for (const rule of rules)
      if (rule.type === 'required_status_checks')
        for (const check of (rule.parameters as { required_status_checks?: { context: string }[] })
          ?.required_status_checks ?? [])
          required.add(check.context);
    const byName = new Map<string, Json>();
    for (const check of checkRuns.check_runs)
      if (!byName.has(String(check.name))) byName.set(String(check.name), check);
    for (const status of statuses.statuses)
      if (!byName.has(String(status.context))) byName.set(String(status.context), status);
    for (const name of new Set([...required, ...byName.keys()])) {
      const check = byName.get(name),
        state = check?.conclusion ?? check?.state;
      checks.push({
        name,
        headSha: sha,
        status:
          !check || (check.status && check.status !== 'completed')
            ? 'pending'
            : ['success', 'neutral', 'skipped'].includes(String(state))
              ? 'passed'
              : [
                    'failure',
                    'error',
                    'cancelled',
                    'timed_out',
                    'action_required',
                    'startup_failure',
                  ].includes(String(state))
                ? 'failed'
                : 'pending',
      });
    }
    const latest = new Map<string, Json>();
    for (const review of reviews) {
      const user = review.user as { login?: string; type?: string };
      if (user?.login && user.type !== 'Bot' && review.commit_id === sha)
        latest.set(user.login, review);
    }
    let requiredApprovals = factory.definition.merge.requireApproval ? 1 : 0;
    for (const rule of rules)
      if (rule.type === 'pull_request')
        requiredApprovals = Math.max(
          requiredApprovals,
          Number((rule.parameters as Json)?.required_approving_review_count ?? 0),
        );
    const currentReviews = [...latest.values()],
      changes = currentReviews.some((x) => x.state === 'CHANGES_REQUESTED'),
      approvals = currentReviews.filter((x) => x.state === 'APPROVED').length;
    const comments = await pages<Json>(factory, `${root}/pulls/${value.number}/comments`);
    const feedback = comments
      .filter((x) => x.commit_id === sha && typeof x.body === 'string')
      .slice(-40)
      .map((x) => ({
        id: String(x.id),
        body: String(x.body).slice(0, 4000),
        headSha: sha,
        url: String(x.html_url),
      }));
    const fresh = await pull(factory, run);
    if (fresh.head.sha !== sha) throw new Error('PR head changed while observing checks.');
    return {
      headSha: sha,
      state: value.merged ? 'merged' : value.state === 'closed' ? 'closed' : 'open',
      draft: value.draft,
      checks,
      review: changes
        ? 'changes-requested'
        : approvals >= requiredApprovals
          ? requiredApprovals
            ? 'approved'
            : 'not-required'
          : 'pending',
      feedback,
      mergeCommitSha: value.merged ? value.merge_commit_sha : undefined,
      mergeQueued: merge.mergeQueued,
      mergeAutoEnabled: merge.mergeAutoEnabled,
      observedAt: new Date().toISOString(),
    };
  }
  return {
    async listIssues(factory, since) {
      if (factory.definition.workItems) return io.intake.listIssues(factory, since);
      const src = source(factory),
        query = `${src.endpoint}/issues?state=open&sort=created&direction=asc${src.label ? `&labels=${encodeURIComponent(src.label)}` : ''}${since ? `&since=${encodeURIComponent(since)}` : ''}`;
      const values = await pages<Json>(factory, query),
        unique = new Map<number | string, FactoryIssue>();
      for (const value of values)
        if (!value.pull_request) {
          const item = issue(value);
          if ((!src.label || item.labels.includes(src.label)) && item.state === 'open')
            unique.set(item.number, item);
        }
      return [...unique.values()];
    },
    async readIssue(factory, number) {
      if (factory.definition.workItems) return io.intake.readIssue(factory, number);
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
        throw new Error('Invalid issue number.');
      const value = await api<Json>(factory, `${source(factory).endpoint}/issues/${number}`);
      if (value.pull_request) throw new Error('A pull request is not a factory issue.');
      return issue(value);
    },
    prepareCheckout,
    verifyCheckout: (factory, run, _intentKey, guard) =>
      evidence(factory, run, factory.definition.checks, false, guard),
    async publishPullRequest(factory, run, _intentKey, guard) {
      await authorize(factory, run, 'publish');
      const cwd = await checkoutIdentity(factory, run),
        src = source(factory),
        checkout = run.checkout!;
      const head = await git(cwd, 'rev-parse', 'HEAD'),
        tree = await git(cwd, 'rev-parse', 'HEAD^{tree}');
      if (
        !run.evidence?.passed ||
        run.evidence.headSha !== head ||
        run.evidence.treeSha !== tree ||
        (await git(cwd, 'status', '--porcelain'))
      )
        throw new Error('Publication needs current verified committed source.');
      await scanCandidateDiff(cwd, checkout.baseSha, head);
      const found = (
        await pages<Pull>(
          factory,
          `${src.endpoint}/pulls?state=all&head=${encodeURIComponent(`${src.owner}:${checkout.branch}`)}&base=${encodeURIComponent(src.baseBranch)}`,
        )
      ).filter((pr) => pr.body?.includes(marker(run)));
      if (found.length > 1) throw new Error('Multiple provider PRs match this factory run.');
      if (found[0] && found[0].state === 'closed')
        throw new Error('The existing factory PR is closed.');
      await authorize(factory, run, 'publish');
      await guard?.();
      await git(
        cwd,
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        '-c',
        'http.sslVerify=true',
        'push',
        `https://${src.host}/${src.fullName}.git`,
        `HEAD:refs/heads/${checkout.branch}`,
      );
      await guard?.();
      const candidate =
        found[0] ??
        (await api<Pull>(factory, `${src.endpoint}/pulls`, 'POST', {
          title: `${run.issue.title.slice(0, 200)} (${factoryIssueLabel(run.issue)})`,
          body: `${!factory.definition.workItems ? `Closes #${run.issue.number}` : factory.definition.workItems.provider === 'github' ? `Closes ${run.issue.url}` : `Work item: ${run.issue.url}`}\n\n${marker(run)}`,
          head: checkout.branch,
          base: src.baseBranch,
          draft: factory.definition.publication.draft,
        }));
      assertPull(factory, run, candidate);
      // Existing PR objects predate the push; re-read to bind the receipt.
      const verified = await api<Pull>(factory, `${src.endpoint}/pulls/${candidate.number}`);
      assertPull(factory, run, verified);
      if (verified.head.sha !== head)
        throw new Error('Published PR head does not match the verified candidate.');
      return {
        number: verified.number,
        url: verified.html_url,
        headSha: head,
        branch: checkout.branch,
        baseBranch: src.baseBranch,
        draft: verified.draft,
      };
    },
    readPullRequest: observe,
    async requestMerge(factory, run, _intentKey, guard) {
      await authorize(factory, run, 'merge');
      const observation = await observe(factory, run),
        expected = run.pullRequest?.headSha;
      if (
        !expected ||
        observation.headSha !== expected ||
        !run.evidence?.passed ||
        run.evidence.headSha !== expected
      )
        throw new Error('Merge evidence is stale.');
      if (observation.state === 'merged')
        return {
          requestedHeadSha: expected,
          state: 'merged',
          mergeCommitSha: observation.mergeCommitSha,
        };
      if (
        observation.state !== 'open' ||
        observation.checks.some((x) => x.status !== 'passed') ||
        !['approved', 'not-required'].includes(observation.review)
      )
        throw new Error('Required checks or reviews are not satisfied.');
      if (factory.definition.merge.mode === 'human-approved' && run.mergeApprovalHead !== expected)
        throw new Error('Current-head human merge approval is required.');
      if (observation.draft) {
        await authorize(factory, run, 'merge');
        await guard?.();
        await io.command('gh', [
          'pr',
          'ready',
          String(run.pullRequest!.number),
          '--repo',
          `${source(factory).host}/${source(factory).fullName}`,
        ]);
      }
      const fresh = await observe(factory, run);
      if (
        fresh.headSha !== expected ||
        fresh.state !== 'open' ||
        fresh.draft ||
        fresh.checks.some((x) => x.status !== 'passed') ||
        !['approved', 'not-required'].includes(fresh.review)
      )
        throw new Error('Merge conditions changed.');
      await authorize(factory, run, 'merge');
      await guard?.();
      const response = await api<{ status: string; details?: { sha?: string; uuid?: string } }>(
        factory,
        `${source(factory).endpoint}/pulls/${run.pullRequest!.number}/merge-async`,
        'PUT',
        {
          sha: expected,
          merge_method: factory.definition.merge.method,
          merge_action: 'default',
          bypass_rules: false,
        },
      );
      if (!['pending', 'merged', 'enqueued'].includes(response.status))
        throw new Error('GitHub did not accept the merge request.');
      const requestId = response.details?.uuid;
      const validRequestId =
        typeof requestId === 'string' &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId);
      if (response.status === 'pending' && !validRequestId)
        throw new Error(
          'GitHub accepted an asynchronous merge without a valid request identifier; reconcile provider state before retrying.',
        );
      if (response.status === 'enqueued' && !validRequestId) {
        const state = await mergeState(factory, (await pull(factory, run)).node_id);
        if (!state.mergeQueued)
          throw new Error(
            'GitHub reported an enqueued merge without a queue entry; reconcile provider state before retrying.',
          );
      }
      return {
        providerRequestId: response.details?.uuid,
        requestedHeadSha: expected,
        state:
          response.status === 'merged'
            ? 'merged'
            : response.status === 'enqueued'
              ? 'queued'
              : 'requested',
        mergeCommitSha: response.status === 'merged' ? response.details?.sha : undefined,
      };
    },
    async cancelMerge(factory, run, _intentKey, guard) {
      const pr = await pull(factory, run);
      if (pr.merged) return;
      if (run.mergeReceipt?.state === 'merged')
        throw new Error(
          'Merge receipt and provider pull request disagree; reconcile before cancellation.',
        );
      if (run.mergeReceipt?.state === 'requested') {
        const requestId = run.mergeReceipt.providerRequestId;
        if (!requestId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))
          throw new Error(
            'The asynchronous merge request has no valid identifier; cancellation remains uncertain.',
          );
        const status = await api<{ status: string }>(
          factory,
          `${source(factory).endpoint}/pulls/${pr.number}/merge-async/${encodeURIComponent(requestId)}`,
        );
        if (status.status === 'merged') {
          if ((await pull(factory, run)).merged) return;
          throw new Error(
            'The asynchronous merge request reports merged before the pull request does; reconcile provider state.',
          );
        }
        if (status.status === 'failed') return;
        if (status.status === 'pending')
          throw new Error(
            'GitHub still reports the asynchronous merge request as pending; cancellation is uncertain.',
          );
        if (status.status !== 'enqueued')
          throw new Error(
            'GitHub returned an unknown asynchronous merge status; cancellation is uncertain.',
          );
      }
      const current = await mergeState(factory, pr.node_id);
      const disableAutoMerge = current.mergeAutoEnabled || Boolean(pr.auto_merge);
      const dequeue = current.mergeQueued;
      if (run.mergeReceipt?.state === 'requested' && !dequeue && !disableAutoMerge)
        throw new Error(
          'GitHub reports an enqueued merge but no queue entry; cancellation remains uncertain.',
        );
      if (!disableAutoMerge && !dequeue) return;
      if (disableAutoMerge) {
        await guard?.();
        await api(factory, 'graphql', 'POST', {
          query:
            'mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){pullRequest{id}}}',
          id: pr.node_id,
        });
      }
      if (dequeue) {
        await guard?.();
        await api(factory, 'graphql', 'POST', {
          query:
            'mutation($id:ID!){dequeuePullRequest(input:{pullRequestId:$id}){mergeQueueEntry{id}}}',
          id: pr.node_id,
        });
      }
      const settled = await pull(factory, run),
        settledState = await mergeState(factory, settled.node_id);
      if (settledState.mergeAutoEnabled || settledState.mergeQueued || settled.auto_merge)
        throw new Error(
          'GitHub still reports a queued or automatic merge request; cancellation is uncertain.',
        );
    },
    async verifyMerged(factory, run, _intentKey, guard) {
      const value = await pull(factory, run);
      if (!value.merged || !value.merge_commit_sha || !SHA.test(value.merge_commit_sha))
        throw new Error('The provider has not confirmed merge.');
      return checkout.verifyMerged(factory, run, value.merge_commit_sha, guard);
    },
  };
}
const githubProvider = createGitHubFactoryProvider();
let adoProvider: FactoryProvider | undefined;
async function deliveryProvider(factory: FactoryDefinition): Promise<FactoryProvider> {
  if (factoryDelivery(factory.definition).provider === 'github') return githubProvider;
  adoProvider ??= (await import('./factory-ado-provider.service.js')).createAdoFactoryProvider();
  return adoProvider;
}
export const factoryProvider: FactoryProvider = {
  listIssues: async (factory, since) =>
    (await deliveryProvider(factory)).listIssues(factory, since),
  readIssue: async (factory, number) =>
    (await deliveryProvider(factory)).readIssue(factory, number),
  prepareCheckout: async (factory, run, key, guard) =>
    (await deliveryProvider(factory)).prepareCheckout(factory, run, key, guard),
  verifyCheckout: async (factory, run, key, guard) =>
    (await deliveryProvider(factory)).verifyCheckout(factory, run, key, guard),
  publishPullRequest: async (factory, run, key, guard) =>
    (await deliveryProvider(factory)).publishPullRequest(factory, run, key, guard),
  readPullRequest: async (factory, run) =>
    (await deliveryProvider(factory)).readPullRequest(factory, run),
  requestMerge: async (factory, run, key, guard) =>
    (await deliveryProvider(factory)).requestMerge(factory, run, key, guard),
  cancelMerge: async (factory, run, key, guard) =>
    (await deliveryProvider(factory)).cancelMerge(factory, run, key, guard),
  verifyMerged: async (factory, run, key, guard) =>
    (await deliveryProvider(factory)).verifyMerged(factory, run, key, guard),
};
