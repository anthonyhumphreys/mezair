import type { ChatEntry } from '../contexts/ChatContext';

function identity(entry: ChatEntry): string | undefined {
  if ('id' in entry && entry.id) return `${entry.kind}:${entry.id}`;
  if (entry.kind === 'event') {
    const event = entry.event;
    const id =
      event.itemId ?? event.subagent?.id ?? event.agentUIIntent?.id ?? event.approvalRequestId;
    if (id !== undefined) return `${event.type}:${event.sessionId ?? ''}:${id}`;
  }
  return entry.historyId;
}

/** Re-hydration may resolve earlier requests. Keep live edits/removals and append only new live rows. */
export function mergeHydratedHistory(
  hydrated: ChatEntry[],
  baseline: ChatEntry[],
  current: ChatEntry[],
): ChatEntry[] {
  const old = new Map(baseline.map((entry) => [identity(entry), entry]));
  const live = new Map(current.map((entry) => [identity(entry), entry]));
  const result = hydrated.flatMap((entry) => {
    const key = identity(entry);
    if (!key || !old.has(key)) return [entry];
    const latest = live.get(key);
    if (!latest) return [];
    return [latest === old.get(key) ? entry : latest];
  });
  const included = new Set(result.map(identity).filter(Boolean));
  for (const entry of current) {
    const key = identity(entry);
    if ((key && old.has(key)) || (key && included.has(key))) continue;
    result.push(entry);
    if (key) included.add(key);
  }
  return result;
}
