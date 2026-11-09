import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Failed asynchronous actions only enter the composer that owned their request. */
export function useScopedComposerRecovery(scope: string) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const destinationAvailable = useCallback(async (destination: string) => {
    const [workspaceId, threadId] = JSON.parse(destination) as [string | null, string | null];
    if (!threadId) return true;
    try {
      return (await window.mezair.chat.listThreads(workspaceId)).some(
        (thread) => thread.id === threadId,
      );
    } catch {
      return true;
    } // An unavailable database is not evidence of deletion.
  }, []);
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
  const markTextApplied = useCallback(
    (id: string) => {
      setPending((previous) => {
        const queue = previous.get(scope);
        if (!queue?.some((item) => item.id === id && !item.textApplied)) return previous;
        return new Map(previous).set(
          scope,
          queue.map((item) => (item.id === id ? { ...item, textApplied: true } : item)),
        );
      });
      setCurrent((previous) =>
        previous?.scope === scope && previous.id === id && !previous.textApplied
          ? { ...previous, textApplied: true }
          : previous,
      );
    },
    [scope],
  );
  const recoveryQueue = useRef(Promise.resolve());
  const recover = useCallback(
    (destination: string, value: ComposerRecovery) => {
      recoveryQueue.current = recoveryQueue.current.then(async () => {
        const available = await destinationAvailable(destination);
        if (mounted.current && available)
          setPending((previous) =>
            new Map(previous).set(destination, [...(previous.get(destination) ?? []), value]),
          );
      });
    },
    [destinationAvailable],
  );
  useEffect(() => {
    if (!pending.size) return;
    let cancelled = false;
    const prune = async () => {
      const unavailable = (
        await Promise.all(
          [...pending.keys()].map(async (destination) => ({
            destination,
            available: await destinationAvailable(destination),
          })),
        )
      )
        .filter((item) => !item.available)
        .map((item) => item.destination);
      if (!cancelled && unavailable.length) {
        setPending(
          (previous) =>
            new Map([...previous].filter(([destination]) => !unavailable.includes(destination))),
        );
        setCurrent((previous) =>
          previous && unavailable.includes(previous.scope) ? null : previous,
        );
      }
    };
    const timer = setInterval(() => void prune(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, destinationAvailable]);
  return {
    prefill: current?.scope === scope ? current : null,
    setPrefill,
    recover,
    acknowledge,
    markTextApplied,
  };
}
