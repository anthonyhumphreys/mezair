import { createHash } from 'node:crypto';
import type { FactoryDefinitionInput, FactoryPreview } from '../../shared/factories.js';
import {
  factoryWorkflowIssues,
  factoryIntakeDescription,
  FACTORY_WORK_ITEM_PROVIDERS,
  factoryDelivery,
  factoryDeliveryLabel,
} from '../../shared/factories.js';
import type { WorkItemProvider } from '../../shared/types.js';
import type { WorkflowTemplate } from '../../shared/types.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Factory definition must be an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 500): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    [...value].some(
      (character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)),
    )
  )
    throw new Error(`Invalid ${label}.`);
  return value.trim();
}
function list(value: unknown, label: string, empty = false): string[] {
  if (!Array.isArray(value) || (!empty && !value.length) || value.length > 32)
    throw new Error(`Invalid ${label}.`);
  return value.map((v) => text(v, label, 4000));
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(`Invalid ${label}.`);
  return Number(value);
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`);
  return value;
}
export function validateFactoryDefinition(value: unknown): FactoryDefinitionInput {
  const input = record(value),
    source = record(input.delivery ?? input.github),
    limits = record(input.limits),
    publication = record(input.publication),
    merge = record(input.merge),
    access = record(input.access);
  if (JSON.stringify(value).length > 256000) throw new Error('Factory definition is too large.');
  const baseBranch = text(source.baseBranch, 'base branch', 200);
  let delivery: import('../../shared/factories.js').FactoryDelivery;
  if (input.delivery === undefined || source.provider === 'github') {
    const host = text(source.host, 'GitHub host', 253).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes('..'))
      throw new Error('Invalid GitHub host.');
    const owner = text(source.owner, 'GitHub owner', 100),
      repo = text(source.repo, 'GitHub repository', 100);
    if ([owner, repo].some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || ['.', '..'].includes(part)))
      throw new Error('Invalid GitHub source identity.');
    delivery = { provider: 'github', host, owner, repo, baseBranch };
  } else if (source.provider === 'ado') {
    const organization = new URL(
      text(source.organizationUrl, 'Azure DevOps organisation URL', 500),
    );
    const parts = organization.pathname.split('/').filter(Boolean);
    if (
      organization.protocol !== 'https:' ||
      organization.username ||
      organization.password ||
      organization.search ||
      organization.hash ||
      organization.port ||
      organization.hostname !== 'dev.azure.com' ||
      parts.length !== 1 ||
      !/^[a-z0-9-]+$/i.test(parts[0])
    )
      throw new Error('Use the canonical https://dev.azure.com/organisation URL.');
    const project = text(source.project, 'Azure DevOps project', 200),
      repo = text(source.repo, 'Azure DevOps repository', 200);
    if ([project, repo].some((part) => ['.', '..'].includes(part) || /[/\\?#]/.test(part)))
      throw new Error('Invalid Azure DevOps source identity.');
    delivery = {
      provider: 'ado',
      organizationUrl: `https://dev.azure.com/${parts[0].toLowerCase()}`,
      project,
      repo,
      baseBranch,
    };
  } else throw new Error('Choose GitHub or Azure DevOps delivery.');
  if (input.delivery !== undefined && input.github !== undefined)
    throw new Error('Choose one delivery source.');
  const criteria = list(input.criteria, 'acceptance criteria'),
    checks = list(input.checks, 'acceptance checks');
  if (criteria.length !== checks.length || new Set(criteria).size !== criteria.length)
    throw new Error(
      'Each unique acceptance criterion needs one reviewed verification command in the same order.',
    );
  if (
    baseBranch.startsWith('-') ||
    /[\s~^:?*[\\]/.test(baseBranch) ||
    baseBranch.includes('..') ||
    baseBranch.includes('@{') ||
    baseBranch.endsWith('/') ||
    baseBranch.endsWith('.')
  )
    throw new Error('Invalid base branch.');
  if (
    !['human-approved', 'auto-merge'].includes(String(merge.mode)) ||
    !['squash', 'merge', 'rebase'].includes(String(merge.method))
  )
    throw new Error('Invalid merge policy.');
  let audience: FactoryDefinitionInput['access'];
  if (access.kind === 'private') audience = { kind: 'private' };
  else if (access.kind === 'organization') {
    if (
      !['organization', 'team', 'restricted'].includes(String(access.visibility)) ||
      !Array.isArray(access.members) ||
      access.members.length > 100
    )
      throw new Error('Invalid organisation visibility or members.');
    const members = access.members.map((value) => {
      const member = record(value);
      if (!['viewer', 'operator', 'owner'].includes(String(member.role)))
        throw new Error('Invalid factory role.');
      return {
        userId: text(member.userId, 'member id', 200),
        role: member.role as 'viewer' | 'operator' | 'owner',
      };
    });
    if (new Set(members.map((m) => m.userId)).size !== members.length)
      throw new Error('Duplicate factory member.');
    if (
      access.authorization !== undefined &&
      !['mezair', 'source'].includes(String(access.authorization))
    )
      throw new Error('Invalid factory visibility authorization.');
    audience = {
      ...(access.authorization !== undefined
        ? { authorization: access.authorization as 'mezair' | 'source' }
        : {}),
      kind: 'organization',
      organizationId: text(access.organizationId, 'organisation id', 200),
      visibility: access.visibility as 'organization' | 'team' | 'restricted',
      members,
      ...(access.visibility === 'team' ? { teamId: text(access.teamId, 'team id', 200) } : {}),
    };
  } else throw new Error('Choose a private or organisation audience.');
  let workItems: FactoryDefinitionInput['workItems'];
  if (input.workItems !== undefined) {
    const source = record(input.workItems);
    if (!Object.hasOwn(FACTORY_WORK_ITEM_PROVIDERS, String(source.provider)))
      throw new Error('Unsupported factory Work Item provider.');
    workItems = {
      provider: source.provider as WorkItemProvider,
      connectionId: text(source.connectionId, 'Work Item connection', 200),
      scope: text(source.scope, 'Work Item source scope', 2000),
    };
  }
  const optionalLabel = (value: unknown) =>
    value === undefined || (typeof value === 'string' && !value.trim())
      ? ''
      : text(value, 'ready label', 100);
  const label = optionalLabel(
    input.readyLabel ?? (input.github ? record(input.github).label : undefined),
  );
  if (
    audience.kind === 'organization' &&
    audience.authorization !== 'mezair' &&
    delivery.provider !== 'github'
  )
    throw new Error('Use Mezair organisation roles to share factories with Azure DevOps delivery.');
  if (delivery.provider === 'ado' && !workItems)
    throw new Error('Choose a Work Item connection for Azure DevOps delivery.');
  const result: FactoryDefinitionInput = {
    name: text(input.name, 'factory name', 200),
    workspaceId: text(input.workspaceId, 'workspace id', 200),
    repoId: text(input.repoId, 'repository id', 200),
    ...(input.delivery !== undefined
      ? { delivery, readyLabel: label }
      : {
          github: {
            host: (delivery as Extract<typeof delivery, { provider: 'github' }>).host,
            owner: (delivery as Extract<typeof delivery, { provider: 'github' }>).owner,
            repo: delivery.repo,
            baseBranch,
            label,
          },
        }),
    ...(input.delivery === undefined && input.readyLabel !== undefined
      ? { readyLabel: label }
      : {}),
    ...(workItems ? { workItems } : {}),
    ...(input.includeExisting !== undefined
      ? { includeExisting: bool(input.includeExisting, 'existing work item intake') }
      : {}),
    workflowTemplateId: text(input.workflowTemplateId, 'workflow template', 200),
    criteria,
    checks,
    postMergeChecks: list(input.postMergeChecks, 'post-merge checks'),
    limits: {
      repairRounds: integer(limits.repairRounds, 'repair rounds', 0, 8),
      maxRunMinutes: integer(limits.maxRunMinutes, 'run minutes', 1, 1440),
      maxCommands: integer(limits.maxCommands, 'command budget', 1, 1000),
      maxConcurrentRuns: integer(limits.maxConcurrentRuns, 'concurrent runs', 1, 8),
    },
    publication: {
      enabled: bool(publication.enabled, 'publication permission'),
      draft: bool(publication.draft, 'draft pull request'),
    },
    merge: {
      mode: merge.mode as 'human-approved' | 'auto-merge',
      method: merge.method as 'squash' | 'merge' | 'rebase',
      requiredChecks: list(merge.requiredChecks, 'required provider checks', true),
      requireApproval: bool(merge.requireApproval, 'required human review'),
    },
    access: audience,
  };
  if (result.limits.maxCommands < checks.length + result.postMergeChecks.length + 1)
    throw new Error(
      'Command budget must leave room for implementation, acceptance and post-merge checks.',
    );
  if (result.merge.mode === 'auto-merge' && !result.publication.enabled)
    throw new Error('Auto-merge requires explicit publication permission.');
  return result;
}
export function validateFactoryWorkflow(workflow: WorkflowTemplate): void {
  const [issue] = factoryWorkflowIssues(workflow);
  if (issue) throw new Error(issue);
}
export function factoryPreview(
  definition: FactoryDefinitionInput,
  workflow: WorkflowTemplate,
  actorScope: string,
): FactoryPreview {
  validateFactoryWorkflow(workflow);
  const confirmation = createHash('sha256')
    .update(JSON.stringify({ definition, workflow, actorScope }))
    .digest('hex');
  return {
    definition,
    confirmation,
    summary: [
      `${factoryIntakeDescription(definition)}; deliver to ${factoryDeliveryLabel(definition)}; base ${factoryDelivery(definition).baseBranch}`,
      `Pinned graph ${workflow.name}; ${workflow.nodes.length} steps; models ${[...new Set(workflow.nodes.map((n) => n.model))].join(', ')}`,
      `Each ordered criterion is bound to the verification command at the same index; subjective acceptance requires human review.`,
      `${definition.criteria.length} acceptance checks; ${definition.postMergeChecks.length} post-merge checks; ${definition.limits.maxCommands} observed shell commands; ${definition.limits.maxRunMinutes} wall-clock minutes; ${definition.limits.repairRounds} repair rounds.`,
      definition.publication.enabled
        ? 'Standing authority to publish verified task branches and pull requests.'
        : 'Publication disabled; runs cannot publish.',
      definition.merge.mode === 'auto-merge'
        ? 'Standing automatic merge authority when exact-head acceptance, required checks and human review conditions pass.'
        : 'An authorised person must approve the current verified head before each merge.',
      `Visibility: ${definition.access.kind === 'private' ? 'private' : definition.access.visibility}. ${definition.access.kind === 'organization' && definition.access.authorization === 'mezair' ? 'Existing run history follows current Mezair membership and factory roles; provider credentials belong to the executor.' : 'Existing run history follows current visibility and source permissions.'}`,
      `${definition.includeExisting ? 'Activation includes the existing open backlog.' : 'Activation applies only to issues created after first activation.'} Existing runs retain their graph and original grants; pauses, revoked access and reductions in merge authority apply immediately.`,
    ],
  };
}
