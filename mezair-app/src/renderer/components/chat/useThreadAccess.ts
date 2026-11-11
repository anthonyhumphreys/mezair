import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PermissionProfile } from '../../../shared/agent-access';
import type { AgentProvider, CodexMode } from '../../../shared/types';
import {
  isChatAccessLevel,
  subscribeThreadAccess,
  beginThreadAccessChange,
  resolveThreadAccessForDisplay,
  markAccessLevelApplied,
  readThreadAccessStore,
  reconcileThreadAccessStore,
  setThreadAccessLevel,
  writeThreadAccessStore,
} from './thread-access';

/** Per-thread selection. Requests carry access explicitly; app defaults are never overwritten. */
export function useThreadAccess(
  workspaceId: string | undefined,
  activeThreadId: string | null,
  options?: {
    /**
     * ST9/J10: the per-workspace default from Settings → Workspace
     * (`WorkspaceContext.workspaceAccessDefault`). Wins over the store's
     * `defaultLevel` for threads without an explicit override.
     */
    workspaceDefault?: CodexMode | null;
    provider?: AgentProvider;
    onBeforeChange?: () => Promise<void>;
    /** Called when the chip is changed on an empty thread (no threadId). */
    onWorkspaceDefaultChange?: (level: CodexMode) => void | Promise<void>;
  },
) {
  const workspaceDefault = options?.workspaceDefault ?? null;
  const onWorkspaceDefaultChange = options?.onWorkspaceDefaultChange;
  const storeKey = workspaceId ?? '';
  const subscribe = useCallback(
    (listener: () => void) => subscribeThreadAccess(storeKey, listener),
    [storeKey],
  );
  const snapshot = useCallback(() => readThreadAccessStore(storeKey), [storeKey]);
  const store = useSyncExternalStore(subscribe, snapshot);
  const [changing, setChanging] = useState(false);

  // Load the workspace store, then reconcile against the live settings value
  // so an external Settings → Workspace change becomes the new default.
  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    let cancelled = false;
    void window.mezair.settings
      .get()
      .then((settings) => {
        if (cancelled) return;
        const live = isChatAccessLevel(settings.codexMode) ? settings.codexMode : undefined;
        const base = readThreadAccessStore(workspaceId);
        const next = reconcileThreadAccessStore(base, live);
        if (next !== base) writeThreadAccessStore(workspaceId, next);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workspaceDefault]);

  const priorWorkspaceDefault = useRef<{ key: string; level: CodexMode | null } | null>(null);
  useEffect(() => {
    const prior = priorWorkspaceDefault.current;
    priorWorkspaceDefault.current = { key: storeKey, level: workspaceDefault };
    const current = readThreadAccessStore(storeKey);
    const changed =
      prior?.key === storeKey ? prior.level !== workspaceDefault : !current.defaultSelected;
    if (workspaceDefault && !changing && changed) {
      if (current.defaultLevel !== workspaceDefault)
        writeThreadAccessStore(storeKey, {
          ...current,
          defaultLevel: workspaceDefault,
          defaultProfile: 'default',
        });
    }
  }, [workspaceDefault, storeKey, changing]);

  const onBeforeChange = options?.onBeforeChange;
  const provider = options?.provider ?? 'codex';
  const setLevel = useCallback(
    async (mode: CodexMode, profile: PermissionProfile = 'default') => {
      setChanging(true);
      try {
        await beginThreadAccessChange(storeKey, activeThreadId, async () => {
          await onBeforeChange?.();
          const base = readThreadAccessStore(storeKey);
          const next = markAccessLevelApplied(
            setThreadAccessLevel(base, activeThreadId, mode),
            mode,
          );
          const selected = mode === 'on-request' ? profile : 'default';
          if (activeThreadId) {
            next.profiles = { ...next.profiles, [activeThreadId]: selected };
            next.providers = { ...next.providers, [activeThreadId]: provider };
          } else {
            next.defaultSelected = true;
            next.defaultProfile = selected;
            next.defaultProvider = provider;
          }
          writeThreadAccessStore(storeKey, next);
          if (!activeThreadId) await onWorkspaceDefaultChange?.(mode);
        });
      } finally {
        setChanging(false);
      }
    },
    [storeKey, activeThreadId, provider, onBeforeChange, onWorkspaceDefaultChange],
  );
  const selection = resolveThreadAccessForDisplay(
    store,
    activeThreadId,
    workspaceDefault,
    provider,
  );

  return {
    /** Effective access level for the active thread. */
    level: selection.mode,
    permissionProfile: selection.permissionProfile,
    selectionError: selection.selectionError,
    changing,
    setLevel,
    /** The workspace's access store, for resolving other threads' rail badges. */
    store,
    defaultLevel: resolveThreadAccessForDisplay(store, null, workspaceDefault, provider).mode,
  };
}
