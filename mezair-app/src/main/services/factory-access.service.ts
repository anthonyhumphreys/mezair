import type { FactoryRunPageRequest, FactoryRunPage } from '../../shared/factories.js';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from 'node:crypto';
import { factoryDelivery } from '../../shared/factories.js';
import type { FactoryDefinition, FactoryRun, FactoryAction } from '../../shared/factories.js';
import type {
  FactoryDirectoryEntry,
  FactorySource,
  OrganizationFactoryPolicy,
  SealedFactorySnapshot,
} from '../../../cloud/contract/factory-access.js';
import { factoryAccountRpc, factorySyncIdentity } from './sync-runtime.service.js';
import { currentAccountKey } from './sync-keyring.service.js';
import { getSettings } from './settings.service.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type AccessContext = { githubToken: () => string | null };
let context: AccessContext = { githubToken: () => getSettings().githubPat ?? null };
const exec = promisify(execFile);
/** Provider tokens are supplied just for the operation and are never retained. */
export function configureFactoryAccessContext(value: AccessContext): void {
  context = value;
}
export interface FactoryActor {
  id: string;
  accountScope: string;
}
export function getFactoryActor(): FactoryActor | null {
  const identity = factorySyncIdentity();
  return identity
    ? {
        id: identity.scope.accountId,
        accountScope: `${identity.scope.backendId}:${identity.scope.accountId}`,
      }
    : null;
}
function identity() {
  const value = factorySyncIdentity();
  if (!value)
    throw new Error('Sign in to the active Mezair Cloud backend to access organisation factories.');
  return value;
}
async function token(): Promise<string> {
  const saved = context.githubToken();
  if (saved) return saved;
  try {
    const result = await exec('gh', ['auth', 'token', '--hostname', 'github.com'], {
      timeout: 4000,
      maxBuffer: 8192,
      encoding: 'utf8',
    });
    const value = result.stdout.trim();
    if (value.length >= 10 && !/\s/.test(value)) return value;
  } catch {
    /* Source checks fail closed when GitHub CLI is not authenticated. */
  }
  throw new Error('Connect GitHub to verify current repository access.');
}
async function optionalToken(factory?: FactoryDefinition): Promise<string | undefined> {
  if (
    factory?.definition.access.kind === 'organization' &&
    factory.definition.access.authorization === 'mezair'
  )
    return undefined;
  try {
    return await token();
  } catch {
    return undefined;
  }
}
const rpc = <T>(op: string, params: Record<string, unknown>) => factoryAccountRpc<T>(op, params);
const members = async (organizationId: string) =>
  (
    await rpc<{ members: Array<{ userId: string; role: string; publicKey?: string }> }>(
      'factory.members',
      { organizationId },
    )
  ).members;
function keyForOrg(organizationId: string): { privateKey: Buffer; publicKey: string } {
  const { scope } = identity(),
    key = currentAccountKey(scope);
  if (!key)
    throw new Error(
      'Unlock this account’s Sync encryption key before accessing factory snapshots.',
    );
  const seed = Buffer.from(
    hkdfSync(
      'sha256',
      key.key,
      Buffer.from(scope.backendId),
      Buffer.from(`mezair/factory-access/v1/${organizationId}`),
      32,
    ),
  );
  const privateKey = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), seed]);
  const priv = createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');
  return { privateKey, publicKey: pub };
}
const PUB = Buffer.from('302a300506032b656e032100', 'hex');
function seal(
  payload: unknown,
  factoryId: string,
  revision: number,
  recipientKeys: Array<{ userId: string; publicKey: string }>,
): SealedFactorySnapshot {
  const contentKey = randomBytes(32),
    nonce = randomBytes(12),
    aad = Buffer.from(`mezair/factory-snapshot/v1/${factoryId}/${revision}`);
  const cipher = createCipheriv('aes-256-gcm', contentKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload))),
    cipher.final(),
  ]);
  const keys: SealedFactorySnapshot['keys'] = {};
  for (const recipient of recipientKeys) {
    const pub = createPublicKey({
      key: Buffer.concat([PUB, Buffer.from(recipient.publicKey, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    const eph = generateKeyPairSync('x25519'),
      shared = diffieHellman({ privateKey: eph.privateKey, publicKey: pub });
    const wrapKey = Buffer.from(
      hkdfSync(
        'sha256',
        shared,
        Buffer.from(factoryId),
        Buffer.from(`mezair/factory-key-wrap/v1/${revision}/${recipient.userId}`),
        32,
      ),
    );
    const wrapNonce = randomBytes(12),
      wrap = createCipheriv('aes-256-gcm', wrapKey, wrapNonce);
    wrap.setAAD(aad);
    const wrapped = Buffer.concat([wrap.update(contentKey), wrap.final()]);
    keys[recipient.userId] = {
      ephemeral: eph.publicKey
        .export({ format: 'der', type: 'spki' })
        .subarray(-32)
        .toString('base64'),
      publicKey: recipient.publicKey,
      nonce: wrapNonce.toString('base64'),
      tag: wrap.getAuthTag().toString('base64'),
      ciphertext: wrapped.toString('base64'),
    };
  }
  return {
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keys,
  };
}
export function sealFactorySnapshot(
  payload: unknown,
  factoryId: string,
  revision: number,
  recipients: Array<{ userId: string; publicKey: string }>,
): SealedFactorySnapshot {
  return seal(payload, factoryId, revision, recipients);
}
export function openFactorySnapshotWithPrivateKey<T>(
  sealed: SealedFactorySnapshot,
  factoryId: string,
  revision: number,
  userId: string,
  privateKey: Buffer,
): T {
  const wrap = sealed.keys[userId];
  if (!wrap) throw new Error('No factory snapshot key is available for this account.');
  const aad = Buffer.from(`mezair/factory-snapshot/v1/${factoryId}/${revision}`);
  const eph = createPublicKey({
    key: Buffer.concat([PUB, Buffer.from(wrap.ephemeral, 'base64')]),
    format: 'der',
    type: 'spki',
  });
  const shared = diffieHellman({
    privateKey: createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' }),
    publicKey: eph,
  });
  const wrapKey = Buffer.from(
    hkdfSync(
      'sha256',
      shared,
      Buffer.from(factoryId),
      Buffer.from(`mezair/factory-key-wrap/v1/${revision}/${userId}`),
      32,
    ),
  );
  const unwrap = createDecipheriv('aes-256-gcm', wrapKey, Buffer.from(wrap.nonce, 'base64'));
  unwrap.setAAD(aad);
  unwrap.setAuthTag(Buffer.from(wrap.tag, 'base64'));
  const contentKey = Buffer.concat([
    unwrap.update(Buffer.from(wrap.ciphertext, 'base64')),
    unwrap.final(),
  ]);
  if (contentKey.byteLength !== 32) throw new Error('Factory snapshot key is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', contentKey, Buffer.from(sealed.nonce, 'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}
function open<T>(
  sealed: SealedFactorySnapshot,
  factoryId: string,
  revision: number,
  organizationId: string,
): T {
  const { privateKey } = keyForOrg(organizationId),
    { userId } = registeredKey(organizationId);
  return openFactorySnapshotWithPrivateKey<T>(sealed, factoryId, revision, userId, privateKey);
}
const registered = new Map<string, { userId: string; publicKey: string }>();
function registrationCacheKey(organizationId: string) {
  const { scope } = identity(),
    key = keyForOrg(organizationId);
  return `${scope.backendId}:${scope.accountId}:${organizationId}:${createHash('sha256').update(key.publicKey).digest('hex')}`;
}
function registeredKey(organizationId: string) {
  const value = registered.get(registrationCacheKey(organizationId));
  if (!value) throw new Error('Factory recipient key has not been registered.');
  return value;
}
export async function registerRemoteFactoryKey(
  organizationId: string,
  requireSourceIdentity = false,
): Promise<string> {
  const key = keyForOrg(organizationId),
    result = await rpc<{ userId: string }>('factory.key.register', {
      organizationId,
      publicKey: key.publicKey,
      githubToken: requireSourceIdentity ? await optionalToken() : undefined,
    });
  registered.set(registrationCacheKey(organizationId), {
    userId: result.userId,
    publicKey: key.publicKey,
  });
  return result.userId;
}
async function registeredMembers(
  organizationId: string,
  factoryId: string,
  policy: OrganizationFactoryPolicy,
  source: FactorySource,
) {
  await registerRemoteFactoryKey(organizationId, policy.authorization !== 'mezair');
  return (
    await rpc<{ members: Array<{ userId: string; role: string; publicKey?: string }> }>(
      'factory.members',
      {
        organizationId,
        factoryId,
        policy,
        source,
        githubToken: policy.authorization === 'mezair' ? undefined : await optionalToken(),
      },
    )
  ).members;
}
export async function listRemoteOrganizations(): Promise<Array<{ id: string; role: string }>> {
  return (
    await rpc<{ organizations: Array<{ id: string; role: string }> }>('factory.organizations', {})
  ).organizations;
}
export async function listRemoteFactoryMembers(
  organizationId: string,
): Promise<Array<{ userId: string; role: string }>> {
  return (await members(organizationId)).map(({ userId, role }) => ({ userId, role }));
}
export async function validateRemoteFactoryTeam(
  organizationId: string,
  source: FactorySource,
  teamId: string,
): Promise<boolean> {
  if (!/^[a-z0-9-]{1,100}$/i.test(teamId)) return false;
  return (
    await rpc<{ allowed: boolean }>('factory.source.check', {
      organizationId,
      source,
      teamId,
      githubToken: await optionalToken(),
    })
  ).allowed;
}
function orgId(factory: FactoryDefinition): string {
  if (factory.definition.access.kind !== 'organization')
    throw new Error('Factory is not organisation shared.');
  return factory.definition.access.organizationId;
}
function policyOf(factory: FactoryDefinition): OrganizationFactoryPolicy {
  const access = factory.definition.access;
  if (access.kind !== 'organization') throw new Error('Factory is not organisation shared.');
  return {
    ...(access.authorization ? { authorization: access.authorization } : {}),
    organizationId: access.organizationId,
    visibility: access.visibility,
    ...(access.teamId ? { teamId: access.teamId } : {}),
    members: access.members,
  };
}
function sourceOf(factory: FactoryDefinition): FactorySource {
  const delivery = factoryDelivery(factory.definition),
    access = factory.definition.access;
  const source: FactorySource =
    delivery.provider === 'ado'
      ? {
          provider: 'ado',
          organizationUrl: delivery.organizationUrl,
          project: delivery.project,
          repo: delivery.repo,
        }
      : { host: delivery.host, owner: delivery.owner, repo: delivery.repo };
  if (
    access.kind === 'organization' &&
    access.authorization !== 'mezair' &&
    (delivery.provider !== 'github' || delivery.host !== 'github.com')
  )
    throw new Error(
      'Review a revision using Mezair organisation roles for this delivery provider.',
    );
  const intake = factory.definition.workItems;
  return intake
    ? { ...source, workItems: { provider: intake.provider, scope: intake.scope } }
    : source;
}

function definitionDigest(factory: FactoryDefinition): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        definition: factory.definition,
        workflow: factory.workflow,
        confirmation: factory.confirmation,
      }),
    )
    .digest('hex');
}
export async function authorizeFactoryAccess(
  factory: FactoryDefinition,
  action: FactoryAction,
): Promise<{ role: string; organizationAdmin: boolean; executionOwner: boolean } | void> {
  if (factory.definition.access.kind !== 'organization') return;
  const backendAction = action === 'cancel' ? 'cancel' : action;
  const result = await rpc<{
    role: string;
    organizationAdmin: boolean;
    executionOwner?: boolean;
    executor?: boolean;
  }>('factory.registry.authorize', {
    factoryId: factory.id,
    action: backendAction,
    expectedRegistryVersion: factory.registryVersion,
    githubToken: await optionalToken(factory),
  });
  return { ...result, executionOwner: result.executionOwner ?? result.executor === true };
}
function enrichDefinition(
  value: FactoryDefinition,
  entry: FactoryDirectoryEntry,
): FactoryDefinition {
  if (
    value.definition.access.kind === 'organization' &&
    value.definition.access.authorization === 'mezair' &&
    entry.policy.authorization !== 'mezair'
  )
    throw new Error(
      'The connected backend does not support Mezair factory visibility roles. Upgrade it before activating this definition.',
    );
  return {
    ...value,
    revision: entry.revision,
    registryVersion: entry.registryVersion,
    status: entry.status ?? value.status,
    activeRevision: entry.activeRevision ?? undefined,
    activatedAt: entry.activatedAt ?? value.activatedAt,
    remote: true,
    effectiveRole: entry.role,
    organizationAdmin: entry.organizationAdmin,
    executionOwner: entry.executionOwner,
    sourceAccess: true,
    accessPending: false,
  };
}
export async function listRemoteFactories(_organizationId?: string): Promise<FactoryDefinition[]> {
  const first = await rpc<{ factories: FactoryDirectoryEntry[] }>('factory.registry.list', {
    githubToken: await optionalToken(),
  });
  for (const entry of first.factories)
    await registerRemoteFactoryKey(
      entry.policy.organizationId,
      entry.policy.authorization !== 'mezair',
    );
  const result = await rpc<{ factories: FactoryDirectoryEntry[] }>('factory.registry.list', {
    githubToken: await optionalToken(),
  });
  return result.factories.flatMap((entry) => {
    if (!entry.snapshot || !entry.definitionDigest) return [];
    try {
      const value = open<FactoryDefinition>(
        entry.snapshot,
        entry.id,
        entry.revision,
        entry.policy.organizationId,
      );
      if (
        value.id !== entry.id ||
        value.revision !== entry.revision ||
        definitionDigest(value) !== entry.definitionDigest
      )
        return [];
      return [enrichDefinition(value, entry)];
    } catch {
      return [];
    }
  });
}
export async function listRemoteFactoryDirectory(
  organizationId?: string,
): Promise<Array<Omit<FactoryDirectoryEntry, 'snapshot'> & { accessPending: boolean }>> {
  const result = await rpc<{ factories: FactoryDirectoryEntry[] }>('factory.registry.list', {
    organizationId,
    githubToken: await optionalToken(),
  });
  return result.factories
    .filter(
      (entry) => organizationId === undefined || entry.policy.organizationId === organizationId,
    )
    .map(({ snapshot, ...entry }) => ({ ...entry, accessPending: !snapshot }));
}
export async function getRemoteFactory(id: string): Promise<FactoryDefinition | null> {
  let result = await rpc<FactoryDirectoryEntry>('factory.registry.read', {
    factoryId: id,
    githubToken: await optionalToken(),
  });
  await registerRemoteFactoryKey(
    result.policy.organizationId,
    result.policy.authorization !== 'mezair',
  );
  if (!result.snapshot)
    result = await rpc<FactoryDirectoryEntry>('factory.registry.read', {
      factoryId: id,
      githubToken: await optionalToken(),
    });
  if (!result.snapshot) return null;
  const value = open<FactoryDefinition>(
    result.snapshot,
    id,
    result.revision,
    result.policy.organizationId,
  );
  if (
    !result.definitionDigest ||
    value.id !== id ||
    value.revision !== result.revision ||
    definitionDigest(value) !== result.definitionDigest
  )
    throw new Error('Factory snapshot identity does not match its registry revision.');
  return enrichDefinition(value, result);
}
export async function listRemoteFactoryRuns(factoryId: string): Promise<FactoryRun[]> {
  const factory = await getRemoteFactory(factoryId);
  if (!factory) return [];
  const result = await rpc<{
    runs: Array<{ id: string; version: number; snapshot: SealedFactorySnapshot | null }>;
  }>('factory.run.list', { factoryId, githubToken: await optionalToken() });
  return openRemoteRuns(factory, result.runs);
}

function openRemoteRuns(
  factory: FactoryDefinition,
  items: Array<{ id: string; version: number; snapshot: SealedFactorySnapshot | null }>,
): FactoryRun[] {
  const factoryId = factory.id;
  return items.flatMap((item) => {
    if (!item.snapshot) return [];
    try {
      const run = open<FactoryRun>(item.snapshot, factoryId, item.version, orgId(factory));
      if (run.id !== item.id || run.factoryId !== factoryId || run.version !== item.version)
        return [];
      return [
        {
          ...run,
          effectiveRole: factory.effectiveRole,
          organizationAdmin: factory.organizationAdmin,
          executionOwner: factory.executionOwner,
          sourceAccess: true,
          remote: true,
        },
      ];
    } catch {
      return [];
    }
  });
}
export async function getRemoteFactoryRun(
  factoryId: string,
  id: string,
): Promise<FactoryRun | null> {
  const factory = await getRemoteFactory(factoryId);
  if (!factory) return null;
  const result = await rpc<{
    runs: Array<{ id: string; version: number; snapshot: SealedFactorySnapshot | null }>;
  }>('factory.run.read', { factoryId, runId: id, githubToken: await optionalToken() });
  return openRemoteRuns(factory, result.runs).find((run) => run.id === id) ?? null;
}

export async function listRemoteFactoryRunPage(
  factory: FactoryDefinition,
  request: FactoryRunPageRequest,
): Promise<FactoryRunPage> {
  const limit = request.limit ?? 50;
  const result = await rpc<{
    runs: Array<{ id: string; version: number; snapshot: SealedFactorySnapshot | null }>;
    pageSupported?: boolean;
    cursor?: FactoryRunPage['cursor'];
  }>('factory.run.list', {
    factoryId: factory.id,
    page: { limit, cursor: request.cursor },
    githubToken: await optionalToken(),
  });
  const runs = openRemoteRuns(factory, result.runs);
  if (result.pageSupported) return { runs, cursor: result.cursor ?? null, complete: true };
  // Older servers have an explicit 100-run recent window. Keep compatibility
  // without pretending that missing encrypted history has been searched.
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const available = request.cursor
    ? runs.filter(
        (run) =>
          run.updatedAt < request.cursor!.updatedAt ||
          (run.updatedAt === request.cursor!.updatedAt && run.id < request.cursor!.id),
      )
    : runs;
  const page = available.slice(0, limit),
    last = page.at(-1);
  return {
    runs: page,
    cursor:
      available.length > limit && last
        ? { factoryId: factory.id, terminal: 0, updatedAt: last.updatedAt, id: last.id }
        : null,
    complete: result.runs.length < 100,
  };
}

export async function sendOrganizationFactoryCommand(
  factory: FactoryDefinition,
  command: { id?: string; runId?: string; action: string; expectedHeadSha?: string },
): Promise<{ id: string }> {
  const commandId = command.id ?? randomBytes(16).toString('hex');
  await rpc('factory.command.send', {
    factoryId: factory.id,
    command: { ...command, id: commandId, factoryId: factory.id },
    githubToken: await optionalToken(factory),
  });
  return { id: commandId };
}
export async function takeOrganizationFactoryCommands(
  factory: FactoryDefinition,
): Promise<unknown[]> {
  return (
    await rpc<{ commands: unknown[] }>('factory.command.take', {
      factoryId: factory.id,
      githubToken: await optionalToken(factory),
    })
  ).commands;
}
export async function completeOrganizationFactoryCommand(
  factory: FactoryDefinition,
  id: string,
  result?: unknown,
  error?: string,
): Promise<void> {
  const item = result as { leaseToken?: string } | undefined;
  if (!item?.leaseToken) throw new Error(error ?? 'Factory command lease is missing.');
  await rpc('factory.command.complete', {
    factoryId: factory.id,
    commandId: id,
    leaseToken: item.leaseToken,
    ok: !error,
    githubToken: await optionalToken(factory),
  });
}
export async function claimOrganizationFactoryIssue(
  factory: FactoryDefinition,
  issueNumber: number | string,
  runId: string,
): Promise<boolean> {
  return (
    await rpc<{ claimed: boolean }>('factory.issue.claim', {
      factoryId: factory.id,
      issueId:
        !factory.definition.workItems || factory.definition.workItems.provider === 'github'
          ? String(issueNumber).split('/').at(-1)
          : String(issueNumber),
      runId,
      githubToken: await optionalToken(factory),
    })
  ).claimed;
}
export async function publishFactorySnapshot(
  factory: FactoryDefinition,
  run?: FactoryRun,
  options?: { expectedRevision: number; expectedRegistryVersion?: number },
): Promise<void> {
  if (!run) {
    await upsertRemoteFactory(factory, options?.expectedRevision, options?.expectedRegistryVersion);
    return;
  }
  const organizationId = orgId(factory),
    roster = await registeredMembers(
      organizationId,
      factory.id,
      policyOf(factory),
      sourceOf(factory),
    ),
    recipients = roster.flatMap((x) =>
      x.publicKey ? [{ userId: x.userId, publicKey: x.publicKey }] : [],
    );
  if (!recipients.some((x) => x.userId === registeredKey(organizationId).userId))
    throw new Error('This account has not enrolled a factory encryption key.');
  const payload = {
    ...run,
    workerThreadId: undefined,
    takeoverThreadId: undefined,
    checkout: run.checkout ? { ...run.checkout, path: '' } : undefined,
  };
  const revision = run.version,
    snapshot = seal(payload, factory.id, revision, recipients),
    payloadDigest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await rpc('factory.snapshot.publish', {
    factoryId: factory.id,
    revision: factory.revision,
    runId: run.id,
    version: run.version,
    payloadDigest,
    snapshot,
    githubToken: await optionalToken(factory),
  });
}
export async function republishFactorySnapshots(
  factory: FactoryDefinition,
  runs: FactoryRun[],
): Promise<void> {
  const organizationId = orgId(factory),
    roster = await registeredMembers(
      organizationId,
      factory.id,
      policyOf(factory),
      sourceOf(factory),
    ),
    recipients = roster.flatMap((x) =>
      x.publicKey ? [{ userId: x.userId, publicKey: x.publicKey }] : [],
    );
  if (!recipients.some((x) => x.userId === registeredKey(organizationId).userId))
    throw new Error('This account has not enrolled a factory encryption key.');
  const snapshot = seal(factory, factory.id, factory.revision, recipients);
  await rpc('factory.snapshot.rewrap', {
    factoryId: factory.id,
    revision: factory.revision,
    registryVersion: factory.registryVersion,
    definitionDigest: definitionDigest(factory),
    snapshot,
    githubToken: await optionalToken(factory),
  });
  for (const run of runs) await publishFactorySnapshot(factory, run);
}
export async function upsertRemoteFactory(
  factory: FactoryDefinition,
  expectedRevision?: number,
  expectedRegistryVersion?: number,
): Promise<void> {
  const organizationId = orgId(factory),
    roster = await registeredMembers(
      organizationId,
      factory.id,
      policyOf(factory),
      sourceOf(factory),
    ),
    recipients = roster.flatMap((x) =>
      x.publicKey ? [{ userId: x.userId, publicKey: x.publicKey }] : [],
    );
  if (!recipients.some((x) => x.userId === registeredKey(organizationId).userId))
    throw new Error('This account has not enrolled a factory encryption key.');
  const digest = definitionDigest(factory);
  let currentRevision = expectedRevision,
    currentRegistryVersion = expectedRegistryVersion;
  if (currentRevision === undefined || currentRegistryVersion === undefined) {
    try {
      const current = await rpc<{ revision: number; registryVersion: number }>(
        'factory.registry.read',
        { factoryId: factory.id, githubToken: await optionalToken(factory) },
      );
      currentRevision ??= current.revision;
      currentRegistryVersion ??= current.registryVersion;
    } catch {
      currentRevision ??= 0;
      currentRegistryVersion ??= 0;
    }
  }
  const snapshot = seal(factory, factory.id, factory.revision, recipients);
  await rpc('factory.registry.upsert', {
    factoryId: factory.id,
    policy: factory.definition.access,
    source: sourceOf(factory),
    revision: factory.revision,
    expectedRevision: currentRevision,
    expectedRegistryVersion: currentRegistryVersion,
    definitionDigest: digest,
    status: factory.status,
    activeRevision: factory.activeRevision ?? null,
    activatedAt: factory.activatedAt ?? null,
    snapshot,
    githubToken: await optionalToken(factory),
  });
}
