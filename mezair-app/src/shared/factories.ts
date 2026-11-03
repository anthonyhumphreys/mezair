import type { WorkflowTemplate, WorkItemConnection, WorkItemProvider } from './types.js';

export const FACTORY_WORK_ITEM_PROVIDERS: Record<WorkItemProvider, string> = {
  github: 'GitHub',
  ado: 'Azure DevOps',
  jira: 'Jira',
  linear: 'Linear',
};
/** Credential-free, pinned intake scope. Delivery continues to use the GitHub repository. */
export interface FactoryWorkItemSource {
  provider: WorkItemProvider;
  connectionId: string;
  scope: string;
}

export type FactoryDelivery =
  | { provider: 'github'; host: string; owner: string; repo: string; baseBranch: string }
  | { provider: 'ado'; organizationUrl: string; project: string; repo: string; baseBranch: string };

/** Legacy reviewed GitHub snapshots retain their original wire shape and fingerprint. */
export function factoryDelivery(definition: FactoryDefinitionInput): FactoryDelivery {
  if (definition.delivery) return definition.delivery;
  if (definition.github) {
    const { host, owner, repo, baseBranch } = definition.github;
    return { provider: 'github', host, owner, repo, baseBranch };
  }
  throw new Error('Choose a GitHub or Azure DevOps delivery repository.');
}
export function factoryReadyLabel(definition: FactoryDefinitionInput): string {
  return (definition.readyLabel ?? definition.github?.label ?? '').trim();
}
export function factoryDeliveryLabel(definition: FactoryDefinitionInput): string {
  const source = factoryDelivery(definition);
  return source.provider === 'github'
    ? `${source.owner}/${source.repo}`
    : `${source.organizationUrl.split('/').at(-1)}/${source.project}/${source.repo}`;
}
export function factoryDeliveryKey(definition: FactoryDefinitionInput): string {
  const source = factoryDelivery(definition);
  return JSON.stringify(
    source.provider === 'github'
      ? ['github', source.host.toLowerCase(), source.owner.toLowerCase(), source.repo.toLowerCase()]
      : [
          'ado',
          source.organizationUrl.toLowerCase(),
          source.project.toLowerCase(),
          source.repo.toLowerCase(),
        ],
  );
}
export function parseFactoryDeliveryRemote(
  remote: string,
  baseBranch = 'main',
): FactoryDelivery | null {
  const adoSsh = remote.match(
    /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  if (adoSsh)
    return {
      provider: 'ado',
      organizationUrl: `https://dev.azure.com/${decodeURIComponent(adoSsh[1])}`,
      project: decodeURIComponent(adoSsh[2]),
      repo: decodeURIComponent(adoSsh[3]),
      baseBranch,
    };
  const gitSsh = remote.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  try {
    const url = gitSsh
      ? new URL(`https://${gitSsh[1]}/${gitSsh[2]}/${gitSsh[3]}`)
      : new URL(remote);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const host = url.hostname.toLowerCase();
    if (url.password || url.search || url.hash || url.protocol !== 'https:') return null;
    if (host === 'dev.azure.com' && parts.length === 4 && parts[2] === '_git')
      return {
        provider: 'ado',
        organizationUrl: `https://dev.azure.com/${parts[0]}`,
        project: parts[1],
        repo: parts[3].replace(/\.git$/i, ''),
        baseBranch,
      };
    if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(host) && parts.length === 3 && parts[1] === '_git')
      return {
        provider: 'ado',
        organizationUrl: `https://dev.azure.com/${host.split('.')[0]}`,
        project: parts[0],
        repo: parts[2].replace(/\.git$/i, ''),
        baseBranch,
      };
    if (
      (host === 'github.com' ||
        host.endsWith('.github.com') ||
        host.startsWith('github.') ||
        host.includes('.github.')) &&
      parts.length === 2
    )
      return {
        provider: 'github',
        host,
        owner: parts[0],
        repo: parts[1].replace(/\.git$/i, ''),
        baseBranch,
      };
    return null;
  } catch {
    return null;
  }
}
export function factoryMatchesRemote(definition: FactoryDefinitionInput, remote: string): boolean {
  const delivery = parseFactoryDeliveryRemote(remote);
  return (
    delivery !== null &&
    factoryDeliveryKey({ ...definition, delivery }) === factoryDeliveryKey(definition)
  );
}

export function factoryConnectionSource(connection: WorkItemConnection): FactoryWorkItemSource {
  const required = (value: string | undefined) => {
    if (!value?.trim())
      throw new Error('Configure the Work Item connection project or team first.');
    return value.trim();
  };
  const origin = (value: string | undefined) => {
    const raw = required(value);
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid Work Item connection URL.');
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  };
  let scope: string;
  switch (connection.provider) {
    case 'github':
      scope = `${origin(connection.githubHost || 'https://github.com')}/${encodeURIComponent(required(connection.githubOwner).toLowerCase())}/${encodeURIComponent(required(connection.githubRepo).toLowerCase())}`;
      break;
    case 'ado':
      scope = `${origin(connection.adoOrganizationUrl)}/${encodeURIComponent(required(connection.adoProject))}`;
      break;
    case 'jira':
      scope = `${origin(connection.jiraHost)}/${encodeURIComponent(required(connection.jiraProject))}`;
      break;
    case 'linear':
      scope = `linear:team:${required(connection.linearTeamId)}`;
      break;
    default:
      throw new Error('Unsupported factory Work Item provider.');
  }
  return { provider: connection.provider, connectionId: connection.id, scope };
}

export function factoryIntakeDescription(definition: FactoryDefinitionInput): string {
  const source = definition.workItems;
  const scope = source
    ? `${FACTORY_WORK_ITEM_PROVIDERS[source.provider]} · ${source.scope}`
    : factoryDeliveryLabel(definition);
  const label = factoryReadyLabel(definition);
  return `${definition.includeExisting ? 'Open work items' : 'New open work items'}${label ? ` labelled ${label}` : ' with any label'} in ${scope}`;
}

export function factoryIssueKey(definition: FactoryDefinitionInput, issue: FactoryIssue): string {
  if (definition.workItems) {
    const { provider, scope } = definition.workItems;
    // Match the legacy key for GitHub so a connection-backed factory cannot reclaim an issue.
    if (provider === 'github') {
      const target = new URL(scope);
      return (
        `${target.host}${target.pathname}`.toLowerCase() +
        `#${String(issue.number).split('/').at(-1)}`
      );
    }
    return JSON.stringify([
      provider,
      provider === 'linear' ? scope : scope.toLowerCase(),
      provider === 'jira' ? String(issue.number).toUpperCase() : String(issue.number),
    ]);
  }
  const delivery = factoryDelivery(definition);
  if (delivery.provider !== 'github')
    throw new Error('Choose a Work Item connection for Azure DevOps delivery.');
  return `${delivery.host}/${delivery.owner}/${delivery.repo}`.toLowerCase() + `#${issue.number}`;
}

export function factoryIssueLabel(issue: FactoryIssue): string {
  const value = String(issue.number).split('/').at(-1) ?? String(issue.number);
  return /^\d+$/.test(value) ? `#${value}` : value;
}

export type FactoryRole = 'viewer' | 'operator' | 'owner';
export interface FactoryOrganizationOption {
  id: string;
  role: string;
}
export interface FactoryOrganizationMember {
  userId: string;
  role: string;
}
export interface FactoryDirectoryPolicy {
  authorization?: 'mezair' | 'source';
  organizationId: string;
  visibility: 'organization' | 'team' | 'restricted';
  teamId?: string;
  members: Array<{ userId: string; role: FactoryRole }>;
}
export interface FactoryDirectoryItem {
  id: string;
  revision: number;
  policy: FactoryDirectoryPolicy;
  role: FactoryRole;
  organizationAdmin: boolean;
  executionOwner: boolean;
  ownerId: string;
  accessPending: boolean;
  accessRequired?: boolean;
  updatedAt: number;
}
export type FactoryAction =
  'read' | 'read-source' | 'operate' | 'edit' | 'activate' | 'merge' | 'execute' | 'cancel';
export type FactoryAccess =
  | { kind: 'private' }
  | {
      kind: 'organization';
      authorization?: 'mezair' | 'source';
      organizationId: string;
      visibility: 'organization' | 'team' | 'restricted';
      teamId?: string;
      members: Array<{ userId: string; role: FactoryRole }>;
    };
export interface FactoryDefinitionInput {
  name: string;
  workspaceId: string;
  repoId: string;
  /** Kept only for compatibility with previously reviewed definitions. */
  github?: { host: string; owner: string; repo: string; label: string; baseBranch: string };
  delivery?: FactoryDelivery;
  readyLabel?: string;
  workItems?: FactoryWorkItemSource;
  /** Explicitly reviewed backlog intake; absent on legacy definitions. */
  includeExisting?: boolean;
  workflowTemplateId: string;
  criteria: string[];
  checks: string[];
  postMergeChecks: string[];
  limits: {
    repairRounds: number;
    maxRunMinutes: number;
    maxCommands: number;
    maxConcurrentRuns: number;
  };
  publication: { enabled: boolean; draft: boolean };
  merge: {
    mode: 'human-approved' | 'auto-merge';
    method: 'squash' | 'merge' | 'rebase';
    requiredChecks: string[];
    requireApproval: boolean;
  };
  access: FactoryAccess;
}
export interface FactoryActor {
  id: string;
  accountScope: string;
}
export interface FactoryPreview {
  definition: FactoryDefinitionInput;
  confirmation: string;
  summary: string[];
}
export interface FactoryDefinition {
  id: string;
  workspaceId: string;
  revision: number;
  activeRevision?: number;
  commandPending?: boolean;
  effectiveRole?: FactoryRole;
  accessPending?: boolean;
  sourceAccess?: boolean;
  organizationAdmin?: boolean;
  remote?: boolean;
  executionOwner?: boolean;
  registryVersion?: number;
  lastControlRequestId?: string;
  status: 'draft' | 'active' | 'paused' | 'inactive';
  ownerId: string;
  accountScope: string;
  definition: FactoryDefinitionInput;
  workflow: WorkflowTemplate;
  confirmation: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Present on permission-filtered remote metadata; protected fields must not be trusted/exposed. */
  redacted?: boolean;
}
export interface FactoryIssue {
  number: number | string;
  title: string;
  body: string;
  url: string;
  labels: string[];
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
}
export type FactoryRunStage =
  | 'received'
  | 'implementing'
  | 'validating'
  | 'publishing'
  | 'waiting-checks'
  | 'repairing'
  | 'awaiting-merge-approval'
  | 'merging'
  | 'verifying-merge'
  | 'completed'
  | 'blocked'
  | 'paused'
  | 'cancelled'
  | 'taken-over'
  | 'cancelling';
export interface FactoryCheckout {
  path: string;
  branch: string;
  baseSha: string;
}
export interface FactoryEvidence {
  headSha: string;
  treeSha: string;
  criteria: Array<{ criterion: string; status: 'passed' | 'failed' | 'blocked'; evidence: string }>;
  commands: Array<{ command: string; exitCode: number | null; output: string; timedOut?: boolean }>;
  passed: boolean;
  checkedAt: string;
}
export interface FactoryPullRequest {
  repositoryId?: string;
  number: number;
  url: string;
  headSha: string;
  branch: string;
  baseBranch: string;
  draft: boolean;
}
export interface FactoryPrObservation {
  headSha: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  checks: Array<{ name: string; status: 'pending' | 'passed' | 'failed'; headSha: string }>;
  review: 'approved' | 'changes-requested' | 'pending' | 'not-required';
  feedback: Array<{ id: string; body: string; headSha: string; url?: string }>;
  mergeCommitSha?: string;
  mergeQueued?: boolean;
  mergeAutoEnabled?: boolean;
  observedAt: string;
}
export interface FactoryMergeReceipt {
  providerRequestId?: string;
  requestedHeadSha: string;
  state: 'requested' | 'queued' | 'merged';
  mergeCommitSha?: string;
}
export interface FactoryReceipt {
  id: string;
  runId: string;
  key: string;
  kind: 'checkout' | 'workflow' | 'verify' | 'publish' | 'merge' | 'cancel-merge' | 'post-merge';
  status: 'intent' | 'succeeded' | 'uncertain' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
export interface FactoryRun {
  id: string;
  factoryId: string;
  revision: number;
  workspaceId: string;
  snapshot: FactoryDefinition;
  issue: FactoryIssue;
  stage: FactoryRunStage;
  pendingControl?: 'pause' | 'cancel' | 'takeover';
  pendingControlId?: string;
  workerCommandBaseline?: number;
  resumeStage?: FactoryRunStage;
  version: number;
  repairRounds: number;
  commandsUsed: number;
  createdAt: string;
  /** Execution budget starts when dequeued, not while waiting for a concurrency slot. */
  startedAt?: string;
  updatedAt: string;
  deadlineAt: string;
  nextPollAt?: string;
  checkout?: FactoryCheckout;
  workflowRunId?: string;
  workerThreadId?: string;
  evidence?: FactoryEvidence;
  pullRequest?: FactoryPullRequest;
  observation?: FactoryPrObservation;
  mergeApprovalHead?: string;
  mergeReceipt?: FactoryMergeReceipt;
  postMergeEvidence?: FactoryEvidence;
  lastFeedbackIds?: string[];
  error?: string;
  takeoverThreadId?: string;
  takeoverRequestId?: string;
  lastControlRequestId?: string;
  receipts: FactoryReceipt[];
  commandPending?: boolean;
  effectiveRole?: FactoryRole;
  accessPending?: boolean;
  sourceAccess?: boolean;
  organizationAdmin?: boolean;
  remote?: boolean;
  executionOwner?: boolean;
}
export interface FactoryPreviewOptions {
  /**
   * Pin the current saved template instead of retaining the existing revision's graph.
   * Only the designated executor can re-pin; existing runs keep their own snapshot.
   */
  repinWorkflow?: boolean;
}
export interface FactorySaveInput extends FactoryPreviewOptions {
  definition: FactoryDefinitionInput;
  id?: string;
  expectedRevision?: number;
  confirmation: string;
}
export interface FactoryActivateInput {
  factoryId: string;
  revision: number;
  confirmation: string;
}
export interface FactoryControlInput {
  factoryId: string;
  action: 'pause' | 'resume' | 'deactivate';
  requestId?: string;
}
export interface FactoryRunControlInput {
  runId: string;
  action: 'pause' | 'resume' | 'cancel' | 'retry' | 'approve-merge' | 'takeover';
  expectedHeadSha?: string;
  requestId?: string;
  takeoverContext?: { workspaceId: string; repoId?: string; personaId: string };
}

export interface FactoryRunCursor {
  factoryId: string;
  terminal: number;
  updatedAt: string;
  id: string;
}
export interface FactoryRunPageRequest {
  factoryId: string;
  cursor?: FactoryRunCursor | null;
  limit?: number;
}
export interface FactoryRunPage {
  runs: FactoryRun[];
  cursor: FactoryRunCursor | null;
  /** False for legacy hosted servers that cannot continue beyond their recent window. */
  complete: boolean;
}
export interface FactoryRunSummary {
  total: number;
  active: number;
  attention: number;
  live: number;
  complete: boolean;
}

/** Desktop/provider boundary: all writes have a durable, stable intent key. */
export interface FactoryProvider {
  listIssues(factory: FactoryDefinition, since?: string): Promise<FactoryIssue[]>;
  readIssue(factory: FactoryDefinition, number: number | string): Promise<FactoryIssue>;
  prepareCheckout(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<FactoryCheckout>;
  verifyCheckout(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<FactoryEvidence>;
  publishPullRequest(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<FactoryPullRequest>;
  readPullRequest(factory: FactoryDefinition, run: FactoryRun): Promise<FactoryPrObservation>;
  requestMerge(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<FactoryMergeReceipt>;
  cancelMerge(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<void>;
  verifyMerged(
    factory: FactoryDefinition,
    run: FactoryRun,
    intentKey: string,
    guard?: () => Promise<void>,
  ): Promise<FactoryEvidence>;
}
export const FACTORY_TERMINAL_STAGES: FactoryRunStage[] = ['completed', 'cancelled', 'taken-over'];

/**
 * Isolated worker constraints for a factory graph, in the order the controller enforces them.
 * Empty when the graph can run in a factory. The first issue is the activation error.
 */
export function factoryWorkflowIssues(
  workflow: Pick<WorkflowTemplate, 'nodes' | 'orchestration'>,
): string[] {
  const issues = new Set<string>();
  if (!workflow.nodes.length || workflow.nodes.length > 32)
    issues.add('Choose a bounded saved workflow.');
  for (const node of workflow.nodes) {
    if (node.target && node.target.kind !== 'local')
      issues.add('Factory workers must run in the isolated local execution checkout.');
    if (node.kind !== 'human' && !['codex'].includes(node.provider ?? 'codex'))
      issues.add(
        'Factory workers require a Codex app-server provider with enforced sandbox isolation.',
      );
    if (node.requiresValidation)
      issues.add(
        'Factory acceptance checks run independently in the controller; remove inline privileged validation from the worker graph.',
      );
  }
  for (const profile of workflow.orchestration?.profiles ?? [])
    if (
      (profile.target && profile.target.kind !== 'local') ||
      !['codex'].includes(profile.provider)
    )
      issues.add('Factory specialist profiles must use isolated local Codex app-server execution.');
  return [...issues];
}

function behaviouralGraph(workflow: Pick<WorkflowTemplate, 'nodes' | 'edges' | 'orchestration'>) {
  // Canvas positions and labels do not change what a worker does.
  return JSON.stringify({
    nodes: [...workflow.nodes]
      .map(({ position: _position, ...node }) => node)
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...workflow.edges].map(({ source, target }) => `${source}>${target}`).sort(),
    orchestration: workflow.orchestration ?? null,
  });
}

/** Compares a factory's pinned graph with the saved template it was pinned from. */
export function factoryWorkflowDrift(
  pinned: WorkflowTemplate,
  template: WorkflowTemplate | null | undefined,
): 'current' | 'changed' | 'missing' {
  if (!template) return 'missing';
  return behaviouralGraph(pinned) === behaviouralGraph(template) ? 'current' : 'changed';
}

const FACTORY_WORKER_THREAD_PREFIX = 'factory-worker-';
/** The chat thread that owns a factory run's delegated workflow; also its provenance key. */
export function factoryWorkerThreadId(runId: string): string {
  return `${FACTORY_WORKER_THREAD_PREFIX}${runId}`;
}
export function factoryRunIdFromWorkerThread(threadId: string | undefined): string | null {
  return threadId?.startsWith(FACTORY_WORKER_THREAD_PREFIX)
    ? threadId.slice(FACTORY_WORKER_THREAD_PREFIX.length) || null
    : null;
}
