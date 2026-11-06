import type { AgentProvider, CodexMode } from '../../../shared/types';
import {
  isAgentProvider,
  isAcpAgentProvider,
  type AcpAgentProvider,
} from '../../../shared/agent-providers';
import {
  ACP_ACCESS_MODES,
  providerAccessMode,
  isPermissionProfile,
  type PermissionProfile,
  translateInteractiveAccess,
} from '../../../shared/agent-access';
import { agentProviderLabel } from '../../utils/agent-display';

/**
 * Per-thread access levels.
 *
 * Levels map onto the existing `CodexMode` transport. The user-facing labels
 * differ from the enum names to describe the access granted:
 *
 *   read-only       → "Read only"
 *   on-request      → "Ask for extra access"
 *   workspace-auto  → "Auto in workspace"
 *   full-access     → "Full access"
 *
 * Storage is renderer-local (localStorage, keyed per workspace) because the
 * durable per-thread contract (`ChatThread.codexMode` + `chat:update-thread`
 * field + schema column) belongs to the shared/main workstream. The store
 * shape below is designed so that wiring later can swap `read/write` calls
 * for the thread record without touching the UI.
 */

export const CHAT_ACCESS_LEVELS: readonly CodexMode[] = [
  'read-only',
  'on-request',
  'workspace-auto',
  'full-access',
] as const;

export const DEFAULT_CHAT_ACCESS_LEVEL: CodexMode = 'on-request';

export function isChatAccessLevel(value: unknown): value is CodexMode {
  return typeof value === 'string' && (CHAT_ACCESS_LEVELS as readonly string[]).includes(value);
}

/** Full label used in the composer chip menu and confirmations. */
export function chatAccessLevelLabel(mode: CodexMode): string {
  switch (mode) {
    case 'read-only':
      return 'Read only';
    case 'on-request':
      return 'Ask for extra access';
    case 'workspace-auto':
      return 'Auto in workspace';
    case 'full-access':
      return 'Full access';
    default:
      return 'Ask for extra access';
  }
}

/** Compact label for dense surfaces like the thread rail. */
export function chatAccessLevelShortLabel(mode: CodexMode): string {
  switch (mode) {
    case 'read-only':
      return 'Read only';
    case 'on-request':
      return 'Ask';
    case 'workspace-auto':
      return 'Workspace';
    case 'full-access':
      return 'Full';
    default:
      return 'Ask';
  }
}

export function chatAccessLevelDescription(mode: CodexMode): string {
  switch (mode) {
    case 'read-only':
      return 'Read-only sandbox. Ask before changes or network access.';
    case 'on-request':
      return 'Edit and run commands in the workspace. Ask for more access.';
    case 'workspace-auto':
      return 'Workspace sandbox. No approval prompts; blocked actions stay blocked.';
    case 'full-access':
      return 'No filesystem or network sandbox. Skip approval prompts; provider rules still apply.';
    default:
      return '';
  }
}

/** Auto/Full levels get warning styling and a shield icon (CH1). */
export function chatAccessLevelIsElevated(mode: CodexMode): boolean {
  return mode === 'workspace-auto' || mode === 'full-access';
}

/** Switching to Full access always goes through a confirmation dialog. */
export function chatAccessLevelRequiresConfirm(mode: CodexMode): boolean {
  return mode === 'full-access';
}

// ---------------------------------------------------------------------------
// H9 — provider-truthful access options
// ---------------------------------------------------------------------------

/**
 * One selectable access mode in the composer chip. For Codex-family providers
 * the four CodexMode levels are distinct and `level` is the transport value.
 * ACP providers collapse the four levels into their own mode ids — `appliedMode`
 * carries the provider-side id so the chip can label what actually applies.
 * `plan` modes are reached through the collaboration-mode transport, not a
 * CodexMode, so they carry `level: null` plus `collaborationMode: 'plan'`.
 */
export interface ChatAccessOption {
  level: CodexMode | null;
  /** Provider-side mode id this option activates ('ask' | 'agent' | ...). */
  appliedMode?: string;
  label: string;
  description: string;
  elevated: boolean;
  collaborationMode?: 'plan';
  disabledReason?: string;
  permissionProfile?: PermissionProfile;
}

function acpAccessOption(provider: AcpAgentProvider, modeId: string): ChatAccessOption | null {
  const name = agentProviderLabel(provider) ?? 'The agent';
  switch (modeId) {
    case 'ask':
      return {
        level: 'read-only',
        appliedMode: 'ask',
        label: 'Ask',
        description: `${name} explores and answers questions without edits. This is not a filesystem sandbox.`,
        disabledReason:
          'Strict read-only access is unavailable for this provider. Use Plan for exploration, or select a provider with a read-only sandbox.',
        elevated: false,
      };
    case 'agent':
      // Cursor collapses every non-read-only level into 'agent'; 'on-request'
      // is the neutral transport value that still reads sanely if the thread
      // later runs on a Codex-family provider.
      return {
        level: 'on-request',
        appliedMode: 'agent',
        label: 'Agent',
        description: `${name} works autonomously and asks for approval under its own rules.`,
        elevated: false,
      };
    case 'accept-edits':
      return {
        level: 'on-request',
        ...(provider === 'claude' ? { permissionProfile: 'accept-edits' as const } : {}),
        appliedMode: 'accept-edits',
        label: 'Accept edits',
        description: `${name} applies file edits without asking and still asks before other actions.`,
        elevated: false,
      };
    case 'auto':
      return {
        level: 'on-request',
        appliedMode: 'auto',
        permissionProfile: 'auto-review',
        label: 'Auto review',
        description:
          'Claude reviews tool actions automatically and asks when its rules require it. Requires an eligible Claude account and model.',
        elevated: true,
      };
    case 'dont-ask':
      return {
        level: 'on-request',
        appliedMode: 'dont-ask',
        permissionProfile: 'dont-ask',
        label: 'Allowed tools only',
        description:
          'Use Claude’s configured allow rules. Deny actions that would need an approval prompt.',
        elevated: false,
      };
    case 'smart':
      return {
        level: 'workspace-auto',
        appliedMode: 'smart',
        label: 'Smart',
        description: `${name} auto-approves safe operations and asks before risky ones.`,
        elevated: true,
      };
    case 'bypass':
      return {
        level: 'full-access',
        appliedMode: 'bypass',
        label: 'Full access',
        description: `${name} skips tool approval prompts. Provider and organisation restrictions still apply.`,
        elevated: true,
      };
    case 'plan':
      return {
        level: null,
        appliedMode: 'plan',
        collaborationMode: 'plan',
        label: 'Plan',
        description: `${name} explores and plans before implementation. Planning is not a filesystem sandbox.`,
        elevated: false,
      };
    default:
      return null;
  }
}

/**
 * The options the access chip should offer for a provider. Pass the session's
 * `capabilities.accessModes` when available; ACP providers fall back to their
 * advertised mode list so a new thread is honest before the session starts.
 * Codex-family providers expose all four CodexMode levels.
 */
export function chatAccessOptionsForProvider(
  provider: AgentProvider | undefined,
  accessModes?: readonly string[],
): ChatAccessOption[] {
  const acpProvider = isAcpAgentProvider(provider) ? provider : null;
  if (!acpProvider) {
    const sandboxOptions = CHAT_ACCESS_LEVELS.map((level) => ({
      level,
      label: chatAccessLevelLabel(level),
      description: chatAccessLevelDescription(level),
      elevated: chatAccessLevelIsElevated(level),
    }));
    return [
      ...sandboxOptions.slice(0, 2),
      {
        level: 'on-request' as const,
        appliedMode: 'auto-review',
        permissionProfile: 'auto-review' as const,
        label: 'Approve for me',
        description:
          'Keep the workspace sandbox. Codex automatically reviews requests for extra access.',
        elevated: true,
      },
      ...sandboxOptions.slice(2),
    ];
  }
  const modes = accessModes ?? ACP_ACCESS_MODES[acpProvider];
  const options = modes.flatMap((modeId) => {
    const option = acpAccessOption(acpProvider, modeId);
    return option ? [option] : [];
  });
  if (acpProvider === 'cursor' && modes.includes('agent')) {
    options.push({
      level: 'full-access',
      appliedMode: 'agent',
      label: 'Full access',
      description:
        'Auto-approve Cursor tool requests. Provider-enforced sandbox and deny rules still apply.',
      elevated: true,
    });
  }
  return options;
}

/**
 * The provider-side mode id the next send will apply — mirrors
 * `resolveAcpSessionMode` plus the read-only persona/plan clamps in
 * codex-session.service.ts. Returns undefined for Codex-family providers.
 */
export function expectedAcpAppliedMode(
  provider: AgentProvider | undefined,
  level: CodexMode,
  collaborationMode?: 'default' | 'plan',
  canWriteFiles?: boolean,
  permissionProfile?: PermissionProfile,
): string | undefined {
  if (!isAcpAgentProvider(provider)) return undefined;
  if (collaborationMode === 'plan') return 'plan';
  const effectiveLevel = canWriteFiles === false ? 'read-only' : level;
  return providerAccessMode(provider, effectiveLevel, collaborationMode, permissionProfile);
}

/** Label for a provider-side mode id that is not a CodexMode. */
export function chatAppliedModeLabel(modeId: string): string | null {
  switch (modeId) {
    case 'auto':
    case 'auto-review':
      return 'Auto review';
    case 'dont-ask':
      return 'Allowed tools only';
    case 'ask':
      return 'Ask';
    case 'agent':
      return 'Agent';
    case 'accept-edits':
      return 'Accept edits';
    case 'smart':
      return 'Smart';
    case 'bypass':
    case 'danger-full-access':
      return 'Full access';
    case 'plan':
      return 'Plan';
    default:
      return null;
  }
}

/**
 * Whether the option is the currently applied one. When `appliedMode` is known
 * (ACP mode id, or the persona-clamped CodexMode for Codex sessions) it wins
 * over the stored level so the check mark lands on what actually runs.
 */
export function chatAccessOptionSelected(
  option: ChatAccessOption,
  level: CodexMode,
  appliedMode?: string,
): boolean {
  if (appliedMode) {
    if (option.appliedMode)
      return (
        option.appliedMode === appliedMode &&
        (option.appliedMode !== 'agent' ||
          (option.level === 'full-access' ? level === 'full-access' : level !== 'full-access'))
      );
    return option.level === appliedMode;
  }
  return !option.permissionProfile && option.level === level;
}

/** The label the collapsed chip should show for the applied/stored mode. */
export function resolveChatAccessChipLabel(
  options: ChatAccessOption[],
  level: CodexMode,
  appliedMode?: string,
): string {
  if (appliedMode) {
    const match = options.find((option) => chatAccessOptionSelected(option, level, appliedMode));
    if (match) return match.label;
    const modeLabel =
      chatAppliedModeLabel(appliedMode) ??
      (isChatAccessLevel(appliedMode) ? chatAccessLevelLabel(appliedMode) : null);
    if (modeLabel) return modeLabel;
  }
  return options.find((option) => option.level === level)?.label ?? chatAccessLevelLabel(level);
}

// ---------------------------------------------------------------------------
// Renderer-local persistence (interim transport — see note above)
// ---------------------------------------------------------------------------

export interface ThreadAccessStore {
  /** Level applied to threads with no explicit override. Mirrors the default. */
  defaultLevel: CodexMode;
  defaultProfile?: PermissionProfile;
  defaultProvider?: AgentProvider;
  defaultSelected?: boolean;
  providers?: Record<string, AgentProvider>;
  profiles?: Record<string, PermissionProfile>;
  /** Last level pushed into `settings.codexMode`, for external-change checks. */
  appliedLevel: CodexMode | null;
  /** Explicit per-thread overrides. */
  threads: Record<string, CodexMode>;
}

export const THREAD_ACCESS_STORAGE_PREFIX = 'mezair:chat-thread-access:v1:';

export function threadAccessStorageKey(workspaceId: string): string {
  return `${THREAD_ACCESS_STORAGE_PREFIX}${workspaceId}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const accessStores = new Map<string, ThreadAccessStore>();
const accessListeners = new Map<string, Set<() => void>>();
const accessChanges = new Map<string, Promise<void>>();
export function subscribeThreadAccess(workspaceId: string, listener: () => void): () => void {
  const listeners = accessListeners.get(workspaceId) ?? new Set();
  accessListeners.set(workspaceId, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) accessListeners.delete(workspaceId);
  };
}
export function beginThreadAccessChange(
  workspaceId: string,
  threadId: string | null,
  change: () => Promise<void>,
): Promise<void> {
  const key = JSON.stringify([workspaceId, threadId]);
  const prior = accessChanges.get(key);
  if (prior) return Promise.reject(new Error('An access change is already in progress.'));
  const pending = Promise.resolve().then(change);
  accessChanges.set(key, pending);
  void pending.then(
    () => {
      if (accessChanges.get(key) === pending) accessChanges.delete(key);
    },
    () => {
      if (accessChanges.get(key) === pending) accessChanges.delete(key);
    },
  );
  return pending;
}
export async function awaitThreadAccessChange(
  workspaceId: string,
  threadId: string,
): Promise<void> {
  for (;;) {
    const pending = [
      accessChanges.get(JSON.stringify([workspaceId, threadId])),
      accessChanges.get(JSON.stringify([workspaceId, null])),
    ].filter((value): value is Promise<void> => Boolean(value));
    if (!pending.length) return;
    await Promise.all(pending);
  }
}
export function assertThreadAccessReady(workspaceId: string, threadId: string): void {
  if (
    accessChanges.has(JSON.stringify([workspaceId, threadId])) ||
    accessChanges.has(JSON.stringify([workspaceId, null]))
  )
    throw new Error('Thread access is changing. Wait for it to finish before sending.');
}

export function readThreadAccessStore(workspaceId: string): ThreadAccessStore {
  const cached = accessStores.get(workspaceId);
  if (cached) return cached;
  const loaded = loadThreadAccessStore(workspaceId);
  accessStores.set(workspaceId, loaded);
  return loaded;
}

function loadThreadAccessStore(workspaceId: string): ThreadAccessStore {
  const fallback: ThreadAccessStore = {
    defaultLevel: 'on-request',
    appliedLevel: null,
    threads: {},
  };
  const local = storage();
  if (!workspaceId || !local) return fallback;
  try {
    const raw = local.getItem(threadAccessStorageKey(workspaceId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ThreadAccessStore> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const threads: Record<string, CodexMode> = {};
    if (parsed.threads && typeof parsed.threads === 'object') {
      for (const [threadId, level] of Object.entries(parsed.threads)) {
        if (isChatAccessLevel(level)) threads[threadId] = level;
      }
    }
    return {
      defaultLevel: isChatAccessLevel(parsed.defaultLevel)
        ? parsed.defaultLevel
        : fallback.defaultLevel,
      appliedLevel: isChatAccessLevel(parsed.appliedLevel) ? parsed.appliedLevel : null,
      threads,
      defaultProfile: isPermissionProfile(parsed.defaultProfile)
        ? parsed.defaultProfile
        : 'default',
      defaultSelected: parsed.defaultSelected === true,
      defaultProvider: isAgentProvider(parsed.defaultProvider) ? parsed.defaultProvider : undefined,
      providers: Object.fromEntries(
        Object.entries(parsed.providers ?? {}).filter(([, provider]) => isAgentProvider(provider)),
      ),
      profiles: Object.fromEntries(
        Object.entries(parsed.profiles ?? {}).filter(([, profile]) => isPermissionProfile(profile)),
      ),
    };
  } catch {
    return fallback;
  }
}

export function writeThreadAccessStore(workspaceId: string, store: ThreadAccessStore): void {
  accessStores.set(workspaceId, store);
  for (const listener of accessListeners.get(workspaceId) ?? []) listener();
  const local = storage();
  if (!workspaceId || !local) return;
  try {
    local.setItem(threadAccessStorageKey(workspaceId), JSON.stringify(store));
  } catch {
    // Storage full/unavailable — the chip still works for the session.
  }
}

/**
 * The level a thread should run with: explicit per-thread override, then the
 * per-workspace default from Settings → Workspace (ST9/J10), then the store's
 * own default, then the app default.
 */
export function resolveThreadAccessLevel(
  store: ThreadAccessStore | null,
  threadId: string | null | undefined,
  workspaceDefault?: CodexMode | null,
): CodexMode {
  if (threadId && store?.threads[threadId]) return store.threads[threadId];
  if (workspaceDefault && isChatAccessLevel(workspaceDefault)) return workspaceDefault;
  if (!store) return DEFAULT_CHAT_ACCESS_LEVEL;
  return store.defaultLevel;
}

/**
 * Reconcile the store against the live settings value. When the persisted
 * `appliedLevel` differs from `settings.codexMode`, the setting was changed
 * outside this flow (e.g. Settings → Workspace), so it becomes the new
 * default for threads without overrides.
 */
export function reconcileThreadAccessStore(
  store: ThreadAccessStore,
  settingsLevel: CodexMode | undefined,
): ThreadAccessStore {
  if (store.defaultSelected) return store;
  const live = isChatAccessLevel(settingsLevel) ? settingsLevel : store.defaultLevel;
  if (store.appliedLevel === live) return store;
  return { ...store, defaultLevel: live };
}

/** Record a new effective level after applying it to the transport. */
export function markAccessLevelApplied(
  store: ThreadAccessStore,
  level: CodexMode,
): ThreadAccessStore {
  return store.appliedLevel === level ? store : { ...store, appliedLevel: level };
}

/** Record a per-thread override (or a new default when `threadId` is null). */
export function setThreadAccessLevel(
  store: ThreadAccessStore,
  threadId: string | null | undefined,
  level: CodexMode,
): ThreadAccessStore {
  if (!threadId) return { ...store, defaultLevel: level, defaultProfile: 'default' };
  return {
    ...store,
    threads: { ...store.threads, [threadId]: level },
    profiles: { ...store.profiles, [threadId]: 'default' },
  };
}

export function resolveThreadPermissionProfile(
  store: ThreadAccessStore | null,
  threadId?: string | null,
): PermissionProfile {
  return (
    (threadId && store?.threads[threadId] ? store.profiles?.[threadId] : store?.defaultProfile) ??
    'default'
  );
}

/** The same current selection drives the chip, every start, and every send. */
export function resolveThreadAccessSelection(
  store: ThreadAccessStore,
  threadId: string | null,
  workspaceDefault: CodexMode | null | undefined,
  provider: AgentProvider,
) {
  const mode = resolveThreadAccessLevel(
    store,
    threadId,
    store.defaultSelected ? store.defaultLevel : workspaceDefault,
  );
  const profile =
    mode === 'on-request' ? resolveThreadPermissionProfile(store, threadId) : 'default';
  const source =
    (threadId && store.threads[threadId] ? store.providers?.[threadId] : store.defaultProvider) ??
    provider;
  return translateInteractiveAccess(source, provider, mode, profile);
}
export function bindThreadAccessProvider(
  workspaceId: string,
  threadId: string | null,
  provider: AgentProvider,
): void {
  const store = readThreadAccessStore(workspaceId);
  if (threadId && store.threads[threadId]) {
    if (!store.providers?.[threadId])
      writeThreadAccessStore(workspaceId, {
        ...store,
        providers: { ...store.providers, [threadId]: provider },
      });
  } else if (!store.defaultProvider)
    writeThreadAccessStore(workspaceId, { ...store, defaultProvider: provider });
}

/** Presentation consumers never receive a broader stand-in for an invalid selection. */
export function resolveThreadAccessForDisplay(
  store: ThreadAccessStore,
  threadId: string | null,
  workspaceDefault: CodexMode | null | undefined,
  provider: AgentProvider,
): { mode: CodexMode; permissionProfile: PermissionProfile; selectionError?: string } {
  try {
    return resolveThreadAccessSelection(store, threadId, workspaceDefault, provider);
  } catch (error) {
    return {
      mode: 'read-only',
      permissionProfile: 'default',
      selectionError:
        error instanceof Error ? error.message : 'Choose a replacement access setting.',
    };
  }
}

export function remoteThreadAccessError(input: {
  accessError?: string;
  accessChanging?: boolean;
  permissionMode?: CodexMode;
  permissionProfile?: PermissionProfile;
}): string | undefined {
  if (input.accessError) return input.accessError;
  if (input.accessChanging)
    return 'Thread access is changing. Wait for it to finish before sending.';
  if (
    input.permissionMode !== 'read-only' &&
    input.permissionProfile &&
    input.permissionProfile !== 'default'
  )
    return 'Remote chats cannot preserve this approval profile. Choose a replacement access setting.';
  return undefined;
}
