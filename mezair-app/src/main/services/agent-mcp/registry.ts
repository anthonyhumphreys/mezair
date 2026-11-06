// In-memory session token registry and endpoint state for the local MCP
// endpoint (spec §6.1). Electron-free so the session layer can import it.
// Tokens are never persisted or logged; lookups go through a SHA-256 digest.

import { createHash, randomBytes } from 'node:crypto';
import { constrainPermissionMode } from '../../../../cloud/contract/permissions.js';
import type { CodexMode } from '../../../shared/types.js';
import type { PermissionProfile } from '../../../shared/agent-access.js';
import type { AgentToolSessionContext } from '../../agent-tools/dispatch.js';

export type AgentMcpContextResolver = () => AgentToolSessionContext | undefined;

interface TokenEntry {
  authorityId: number;
  accessCeiling?: { mode: CodexMode; permissionProfile: PermissionProfile };
  sessionId: string;
  token: string;
  resolveContext: AgentMcpContextResolver;
  createdAt: string;
  toolCalls: number;
  toolErrors: number;
}

export interface AgentMcpSessionStats {
  sessionId: string;
  createdAt: string;
  toolCalls: number;
  toolErrors: number;
}

export interface AgentMcpEndpointState {
  url: string;
  port: number;
  /** Absolute path to scripts/mezair-mcp-shim.mjs, when bundled. */
  shimPath?: string;
}

const byDigest = new Map<string, TokenEntry>();
let authoritySequence = 0;
const bySession = new Map<string, TokenEntry>();
let endpoint: AgentMcpEndpointState | undefined;
let endpointStartup: Promise<AgentMcpEndpointState | undefined> | undefined;

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint (or replace) the bearer token for one agent session. */
export function mintAgentMcpToken(
  sessionId: string,
  resolveContext: AgentMcpContextResolver,
): string {
  revokeAgentMcpToken(sessionId);
  const token = randomBytes(32).toString('base64url');
  const entry: TokenEntry = {
    authorityId: ++authoritySequence,
    sessionId,
    token,
    resolveContext,
    createdAt: new Date().toISOString(),
    toolCalls: 0,
    toolErrors: 0,
  };
  byDigest.set(digest(token), entry);
  bySession.set(sessionId, entry);
  const initial = resolveContext();
  if (initial) bindAgentMcpTokenAccess(sessionId, initial.mode, initial.permissionProfile);
  return token;
}

/** Seal issuance authority once; a retained credential cannot acquire broader access. */
export function bindAgentMcpTokenAccess(
  sessionId: string,
  mode: CodexMode,
  profile: PermissionProfile = 'default',
): void {
  const entry = bySession.get(sessionId);
  if (entry && !entry.accessCeiling) entry.accessCeiling = { mode, permissionProfile: profile };
}

export function revokeAgentMcpToken(sessionId: string): void {
  const entry = bySession.get(sessionId);
  if (!entry) return;
  bySession.delete(sessionId);
  byDigest.delete(digest(entry.token));
}

export function getAgentMcpTokenForSession(sessionId: string): string | undefined {
  return bySession.get(sessionId)?.token;
}

/** Resolve a bearer token to the live session context, or undefined when unknown/ended. */
export function resolveAgentMcpToken(
  token: string,
): { sessionId: string; context: AgentToolSessionContext } | undefined {
  const entry = token ? byDigest.get(digest(token)) : undefined;
  if (!entry) return undefined;
  const context = entry.resolveContext();
  if (!context) return undefined;
  if (!entry.accessCeiling)
    bindAgentMcpTokenAccess(entry.sessionId, context.mode, context.permissionProfile);
  const ceiling = entry.accessCeiling!;
  const mode = constrainPermissionMode(context.mode, ceiling.mode);
  if (
    mode === 'on-request' &&
    ceiling.mode === 'on-request' &&
    (context.permissionProfile ?? 'default') !== ceiling.permissionProfile
  )
    return undefined;
  return {
    sessionId: entry.sessionId,
    context: {
      ...context,
      mode,
      permissionProfile: mode === 'read-only' ? 'default' : context.permissionProfile,
      authorityId: entry.authorityId,
    },
  };
}

/** Fence work which awaited input after its bearer, role, scope or access changed. */
export function assertAgentToolContextCurrent(ctx: AgentToolSessionContext): void {
  if (ctx.authorityId === undefined) return;
  const entry = bySession.get(ctx.sessionId);
  const current = entry?.resolveContext();
  const scope = (value: AgentToolSessionContext) =>
    JSON.stringify({
      workspaceId: value.workspaceId,
      appThreadId: value.appThreadId,
      repoIds: [...value.repoIds].sort(),
      features: [...value.features].sort(),
      allowedToolNames: value.allowedToolNames ? [...value.allowedToolNames].sort() : undefined,
      mode: value.mode,
      permissionProfile: value.permissionProfile ?? 'default',
      accessRevision: value.accessRevision,
    });
  if (!entry || entry.authorityId !== ctx.authorityId || !current || scope(current) !== scope(ctx))
    throw new Error(
      'The session access changed while approval was pending. Request approval again.',
    );
}

export function recordAgentMcpToolCall(sessionId: string, ok: boolean): void {
  const entry = bySession.get(sessionId);
  if (!entry) return;
  entry.toolCalls += 1;
  if (!ok) entry.toolErrors += 1;
}

export function listAgentMcpSessions(): AgentMcpSessionStats[] {
  return [...bySession.values()].map(({ sessionId, createdAt, toolCalls, toolErrors }) => ({
    sessionId,
    createdAt,
    toolCalls,
    toolErrors,
  }));
}

export function setAgentMcpEndpoint(state: AgentMcpEndpointState | undefined): void {
  endpoint = state;
}

export function setAgentMcpEndpointStartup(
  startup: Promise<AgentMcpEndpointState | undefined> | undefined,
): void {
  endpointStartup = startup;
}

export function getAgentMcpEndpoint(): AgentMcpEndpointState | undefined {
  return endpoint;
}

/** Waits for an in-flight startup; never starts the endpoint itself. */
export async function awaitAgentMcpEndpoint(): Promise<AgentMcpEndpointState | undefined> {
  if (endpoint || !endpointStartup) return endpoint;
  try {
    return await endpointStartup;
  } catch {
    return undefined;
  }
}

export function resetAgentMcpRegistryForTests(): void {
  byDigest.clear();
  bySession.clear();
  endpoint = undefined;
  endpointStartup = undefined;
}
