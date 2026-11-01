import type { FactoryAccess, FactoryDefinitionInput } from '../../../shared/factories';
import { parseFactoryDeliveryRemote } from '../../../shared/factories';
import type { RepoInfo } from '../../../shared/types';

export const DEFAULT_LIMITS: FactoryDefinitionInput['limits'] = {
  repairRounds: 2,
  maxRunMinutes: 90,
  maxCommands: 40,
  maxConcurrentRuns: 2,
};

export function deliveryIdentity(repo: RepoInfo) {
  return (
    parseFactoryDeliveryRemote(repo.remoteUrl ?? '', repo.defaultBranch || 'main') ?? {
      provider: 'github' as const,
      host: 'github.com',
      owner: '',
      repo: repo.name,
      baseBranch: repo.defaultBranch || 'main',
    }
  );
}
export function isFactoryRepo(repo: RepoInfo): boolean {
  return parseFactoryDeliveryRemote(repo.remoteUrl ?? '') !== null;
}

export function newDefinition(
  workspaceId: string,
  repo?: RepoInfo,
  workflowTemplateId = '',
): FactoryDefinitionInput {
  const delivery = repo
    ? deliveryIdentity(repo)
    : { provider: 'github' as const, host: 'github.com', owner: '', repo: '', baseBranch: 'main' };
  return {
    name: 'Issue to reviewed PR',
    workspaceId,
    repoId: repo?.id ?? '',
    delivery,
    readyLabel: '',
    includeExisting: false,
    workflowTemplateId,
    criteria: ['The configured pre-PR check command exits successfully.'],
    checks: ['pnpm test'],
    postMergeChecks: ['pnpm test'],
    limits: { ...DEFAULT_LIMITS },
    publication: { enabled: true, draft: true },
    merge: { mode: 'human-approved', method: 'squash', requiredChecks: [], requireApproval: true },
    access: { kind: 'private' },
  };
}

export function withAccess(
  current: FactoryAccess,
  kind: 'private' | 'organization',
): FactoryAccess {
  if (kind === 'private') return { kind: 'private' };
  if (current.kind === 'organization') return current;
  return {
    kind: 'organization',
    authorization: 'mezair',
    organizationId: '',
    visibility: 'restricted',
    members: [],
  };
}

/** Starting points for the conversational draft; each is a complete, reviewable request. */
export const DRAFT_EXAMPLES: Array<{ label: string; request: string }> = [
  {
    label: 'All open work items',
    request:
      'Process all open work items from my configured work item connection, including the existing backlog, without requiring a ready label. Implement and verify each change, open a PR and ask me to approve each merge.',
  },
  {
    label: 'Human-approved merge',
    request:
      'For new ready-for-agent issues, implement the change, run the tests and type checks, and open a draft PR. Repair CI and review feedback at most twice, then ask me to approve the merge.',
  },
  {
    label: 'Auto-merge when green',
    request:
      'For issues labelled ready-for-agent, implement and verify the change, open a PR, and automatically squash-merge once required checks and human review pass. Stop on unclear scope.',
  },
  {
    label: 'Small fixes, tight budget',
    request:
      'Handle issues labelled good-first-fix with a single implementer. Keep each run under 30 minutes and 20 commands, one repair round, human-approved merge.',
  },
];
