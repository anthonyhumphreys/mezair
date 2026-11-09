import { useCallback, useEffect, useState } from 'react';
import type { ChatAttachment } from '../../../shared/types';

export interface ComposerRecovery {
  id: string;
  text: string;
  attachments?: ChatAttachment[];
}
export function composerRecoveryScope(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
  persona: string,
) {
  return JSON.stringify([workspaceId ?? null, threadId ?? null, persona]);
}

/** Failed asynchronous actions only enter the composer that owned their request. */
export function useScopedComposerRecovery(scope: string) {
  const [current, setCurrent] = useState<(ComposerRecovery & { scope: string }) | null>(null);
  const [pending, setPending] = useState<Map<string, ComposerRecovery[]>>(() => new Map());
  useEffect(() => {
    const recovered = pending.get(scope)?.[0];
    if (recovered)
      setCurrent((previous) =>
        previous?.id === recovered.id && previous.scope === scope
          ? previous
          : { ...recovered, scope },
      );
    else setCurrent((previous) => (previous?.scope === scope ? previous : null));
  }, [scope, pending]);
  const setPrefill = useCallback(
    (value: ComposerRecovery | null) => setCurrent(value ? { ...value, scope } : null),
    [scope],
  );
  const acknowledge = useCallback(
    (id: string) => {
      setPending((previous) => {
        const queue = previous.get(scope);
        if (!queue?.some((item) => item.id === id)) return previous;
        const next = new Map(previous);
        const remaining = queue.filter((item) => item.id !== id);
        if (remaining.length) next.set(scope, remaining);
        else next.delete(scope);
        return next;
      });
      setCurrent((previous) => (previous?.scope === scope && previous.id === id ? null : previous));
    },
    [scope],
  );
  const recover = useCallback((destination: string, value: ComposerRecovery) => {
    setPending((previous) =>
      new Map(previous).set(destination, [...(previous.get(destination) ?? []), value]),
    );
  }, []);
  return { prefill: current?.scope === scope ? current : null, setPrefill, recover, acknowledge };
}
