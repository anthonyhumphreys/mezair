/** Server-authorized organisation discovery and recipient-bound encrypted snapshots. */
export type OrganizationFactoryRole = 'viewer' | 'operator' | 'owner';
export interface OrganizationFactoryPolicy {
  /** Absent on legacy policies that additionally require GitHub source access. */
  authorization?: 'mezair' | 'source';
  organizationId: string;
  visibility: 'organization' | 'team' | 'restricted';
  teamId?: string;
  members: Array<{ userId: string; role: OrganizationFactoryRole }>;
}
export type FactorySource = (
  | { provider?: 'github'; host: string; owner: string; repo: string }
  | { provider: 'ado'; organizationUrl: string; project: string; repo: string }
) & { workItems?: { provider: 'github' | 'ado' | 'jira' | 'linear'; scope: string } };

export function factorySourceKey(source: FactorySource): string {
  if (source.workItems) {
    const { provider, scope } = source.workItems;
    if (provider === 'github') {
      const url = new URL(scope);
      return `${url.host}${url.pathname}`.toLowerCase();
    }
    return JSON.stringify([provider, provider === 'linear' ? scope : scope.toLowerCase()]);
  }
  return source.provider === 'ado'
    ? JSON.stringify([
        'ado',
        source.organizationUrl.toLowerCase(),
        source.project.toLowerCase(),
        source.repo.toLowerCase(),
      ])
    : `${source.host}/${source.owner}/${source.repo}`.toLowerCase();
}
export interface FactoryKeyWrap {
  ephemeral: string;
  nonce: string;
  tag: string;
  ciphertext: string;
  publicKey: string;
}
export interface SealedFactorySnapshot {
  nonce: string;
  tag: string;
  ciphertext: string;
  keys: Record<string, FactoryKeyWrap>;
}
export interface FactoryDirectoryEntry {
  id: string;
  revision: number;
  registryVersion?: number;
  definitionDigest?: string;
  policy: OrganizationFactoryPolicy;
  source?: FactorySource;
  role: OrganizationFactoryRole;
  organizationAdmin: boolean;
  executionOwner: boolean;
  ownerId?: string;
  snapshot: SealedFactorySnapshot | null;
  status?: 'draft' | 'active' | 'paused' | 'inactive';
  activeRevision?: number;
  activatedAt?: string | null;
  accessPending: boolean;
  accessRequired?: boolean;
  updatedAt?: number;
}
export type FactoryOrganizationCommandAction =
  'pause' | 'resume' | 'deactivate' | 'cancel' | 'retry' | 'approve-merge' | 'takeover';
export interface FactoryOrganizationCommand {
  id: string;
  factoryId: string;
  runId?: string;
  action: FactoryOrganizationCommandAction;
  expectedHeadSha?: string;
  actorId: string;
  createdAt: string;
}
export const FACTORY_ORG_OPERATIONS = [
  'factory.organizations',
  'factory.source.check',
  'factory.issue.claim',
  'factory.key.register',
  'factory.members',
  'factory.registry.upsert',
  'factory.registry.list',
  'factory.registry.read',
  'factory.registry.authorize',
  'factory.snapshot.publish',
  'factory.snapshot.rewrap',
  'factory.run.list',
  'factory.run.read',
  'factory.command.send',
  'factory.command.take',
  'factory.command.complete',
] as const;
