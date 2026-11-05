import { constrainPermissionMode } from '../../cloud/contract/permissions.js';
import type { AgentProvider, CodexMode } from './types.js';
import { isAcpAgentProvider, type AcpAgentProvider } from './agent-providers.js';

export const PERMISSION_PROFILES = ['default', 'accept-edits', 'auto-review', 'dont-ask'] as const;
export type PermissionProfile = (typeof PERMISSION_PROFILES)[number];
export function isPermissionProfile(value: unknown): value is PermissionProfile {
  return PERMISSION_PROFILES.some((profile) => profile === value);
}

/** Native approval refinements are separate from the filesystem/sandbox authority. */
export function supportsPermissionProfile(
  provider: AgentProvider,
  profile: PermissionProfile,
): boolean {
  return (
    profile === 'default' ||
    provider === 'claude' ||
    (profile === 'auto-review' && !isAcpAgentProvider(provider))
  );
}

export function inheritedPermissionProfile(
  provider: AgentProvider,
  profile?: PermissionProfile,
): PermissionProfile {
  if (!profile || profile === 'default') return 'default';
  if (profile === 'dont-ask' && provider !== 'claude')
    throw new Error(
      `${provider} cannot inherit Claude's configured allowlist-only permissions. Choose a read-only task or Claude.`,
    );
  // All print workers support native auto review. Cursor's interactive ACP mode
  // does not expose a reviewer selector, so it is intentionally absent from its menu.
  if (profile === 'auto-review') return profile;
  return provider === 'claude' ? profile : 'default';
}

/** Translate native approval modes before another runtime interprets their transport level. */
export function portableAgentAccess(
  provider: AgentProvider,
  mode: CodexMode,
  profile?: PermissionProfile,
): { mode: CodexMode; permissionProfile: PermissionProfile } {
  if (mode === 'workspace-auto' && isAcpAgentProvider(provider))
    return {
      mode: 'on-request',
      permissionProfile:
        provider === 'devin' ? 'auto-review' : provider === 'claude' ? 'accept-edits' : 'default',
    };
  return { mode, permissionProfile: mode === 'on-request' ? (profile ?? 'default') : 'default' };
}

/** Provider-native controls. These are approval modes, not equivalent OS sandboxes. */
export const ACP_ACCESS_MODES: Record<AcpAgentProvider, readonly string[]> = {
  claude: ['agent', 'accept-edits', 'auto', 'dont-ask', 'bypass', 'plan'],
  cursor: ['ask', 'agent', 'plan'],
  devin: ['ask', 'accept-edits', 'smart', 'bypass', 'plan'],
};

export function providerAccessMode(
  provider: AcpAgentProvider,
  mode: CodexMode,
  collaborationMode?: 'default' | 'plan',
  profile: PermissionProfile = 'default',
): string {
  if (collaborationMode === 'plan') return 'plan';
  if (provider === 'claude') {
    if (mode === 'read-only') return 'plan';
    if (mode === 'on-request' && profile !== 'default')
      return profile === 'auto-review' ? 'auto' : profile;
    return mode === 'full-access' ? 'bypass' : mode === 'workspace-auto' ? 'accept-edits' : 'agent';
  }
  if (provider === 'devin') {
    return mode === 'read-only'
      ? 'ask'
      : mode === 'full-access'
        ? 'bypass'
        : mode === 'workspace-auto'
          ? 'smart'
          : 'accept-edits';
  }
  return mode === 'read-only' ? 'ask' : 'agent';
}

/** Only reviewed chat delegations inherit a thread override; saved workflows retain their app ceiling. */
export function workflowAccessMode(
  requested: CodexMode | undefined,
  configured: CodexMode | undefined,
  inheritChatAccess = false,
): CodexMode {
  const resolved = requested ?? configured ?? 'on-request';
  return inheritChatAccess
    ? resolved
    : constrainPermissionMode(resolved, configured ?? 'on-request');
}

/** Parse the live session's advertised modes; an explicitly empty list stays empty. */
export function advertisedAccessModes(result: unknown): string[] | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const modes = (result as { modes?: { availableModes?: unknown } }).modes?.availableModes;
  if (!Array.isArray(modes)) return undefined;
  return modes.flatMap((mode) =>
    mode && typeof mode === 'object' && typeof mode.id === 'string' ? [mode.id] : [],
  );
}
