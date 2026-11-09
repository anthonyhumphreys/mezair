import { useCallback, useSyncExternalStore } from 'react';
import type { ChatAttachment } from '../../../shared/types';

export interface ComposerRecovery {
  id: string;
  text: string;
  textApplied?: boolean;
  attachments?: ChatAttachment[];
}
export function composerRecoveryScope(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
  persona: string,
) {
  return JSON.stringify([workspaceId ?? null, threadId ?? null, persona]);
}

// Renderer-owned, so route and composer remounts cannot cancel an in-flight recovery.
const queues = new Map<string, readonly ComposerRecovery[]>();
const lookups = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const EMPTY: readonly ComposerRecovery[] = [];
let cleanupTimer: ReturnType<typeof setInterval> | undefined;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
async function destinationAvailable(scope: string): Promise<boolean> {
  const [workspaceId, threadId] = JSON.parse(scope) as [string | null, string | null];
  if (!threadId) return true;
  try {
    return await window.mezair.chat.threadExists(threadId, workspaceId);
  } catch {
    return true;
  } // Failed IPC is not evidence that a conversation was deleted.
}
function update(scope: string, next: readonly ComposerRecovery[]) {
  if (next.length) queues.set(scope, next);
  else queues.delete(scope);
  if (queues.size && !cleanupTimer)
    cleanupTimer = setInterval(() => {
      for (const destination of queues.keys())
        void destinationAvailable(destination).then((available) => {
          if (!available) update(destination, EMPTY);
        });
    }, 60_000);
  if (!queues.size && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
  listeners.forEach((listener) => listener());
}
function append(scope: string, value: ComposerRecovery) {
  const current = queues.get(scope) ?? EMPTY;
  if (!current.some((entry) => entry.id === value.id)) update(scope, [...current, value]);
}
function recover(scope: string, value: ComposerRecovery): void {
  const pending = (lookups.get(scope) ?? Promise.resolve()).then(async () => {
    if (await destinationAvailable(scope)) append(scope, value);
  });
  lookups.set(scope, pending);
  void pending.finally(() => {
    if (lookups.get(scope) === pending) lookups.delete(scope);
  });
}

/** A payload remains owned until its exact scoped composer acknowledges it. */
export function useScopedComposerRecovery(scope: string) {
  const queue = useSyncExternalStore(
    subscribe,
    () => queues.get(scope) ?? EMPTY,
    () => EMPTY,
  );
  const setPrefill = useCallback(
    (value: ComposerRecovery | null) => {
      if (value) append(scope, value);
      else update(scope, EMPTY);
    },
    [scope],
  );
  const acknowledge = useCallback(
    (id: string) => {
      update(
        scope,
        (queues.get(scope) ?? EMPTY).filter((item) => item.id !== id),
      );
    },
    [scope],
  );
  const markTextApplied = useCallback(
    (id: string) => {
      const current = queues.get(scope) ?? EMPTY;
      if (current.some((item) => item.id === id && !item.textApplied))
        update(
          scope,
          current.map((item) => (item.id === id ? { ...item, textApplied: true } : item)),
        );
    },
    [scope],
  );
  return { prefill: queue[0] ?? null, setPrefill, recover, acknowledge, markTextApplied };
}
