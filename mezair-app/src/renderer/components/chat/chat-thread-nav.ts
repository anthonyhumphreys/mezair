import type { ChatThread } from '../../../shared/types';

/** Threads in thread-list order that keyboard navigation moves through. */
export function navigableThreads(threads: readonly ChatThread[]): ChatThread[] {
  return threads.filter((thread) => !thread.settledAt && thread.purpose !== 'side-question');
}

/** The thread before/after `activeId`, wrapping at the ends. */
export function adjacentThreadId(
  threads: readonly ChatThread[],
  activeId: string | null,
  direction: 1 | -1,
): string | null {
  const list = navigableThreads(threads);
  if (list.length === 0) return null;
  const index = activeId ? list.findIndex((thread) => thread.id === activeId) : -1;
  if (index < 0) return list[direction === 1 ? 0 : list.length - 1].id;
  return list[(index + direction + list.length) % list.length].id;
}

const NEEDS_YOU = new Set(['approval', 'input', 'failed']);

/** Next thread (after the active one, wrapping) that is waiting on the user. */
export function nextThreadNeedingYou(
  threads: readonly ChatThread[],
  activeId: string | null,
): string | null {
  const list = threads.filter((thread) => !thread.settledAt);
  const start = activeId ? list.findIndex((thread) => thread.id === activeId) : -1;
  for (let step = 1; step <= list.length; step += 1) {
    const candidate = list[(start + step + list.length) % list.length];
    if (candidate && candidate.id !== activeId && NEEDS_YOU.has(candidate.attentionState))
      return candidate.id;
  }
  return null;
}
