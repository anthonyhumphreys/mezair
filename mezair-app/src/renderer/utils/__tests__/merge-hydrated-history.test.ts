import { expect, it } from 'vitest';
import type { ChatEntry } from '../../contexts/ChatContext';
import { mergeHydratedHistory } from '../merge-hydrated-history';
it('preserves live text, removals and queued messages while adding ancestors without duplicates', () => {
  const old: ChatEntry = { kind: 'user', id: 'old', content: 'ancestor' };
  const baseline: ChatEntry[] = [
    { kind: 'user', id: 'current', content: 'question' },
    { kind: 'assistant', id: 'answer', content: 'partial' },
    {
      kind: 'event',
      historyId: 'request',
      event: { type: 'approval_request', approvalRequestId: 7 },
    },
  ];
  const live: ChatEntry[] = [
    baseline[0],
    { kind: 'assistant', id: 'answer', content: 'complete' },
    { kind: 'user', id: 'queued', content: 'next' },
  ];
  const merged = mergeHydratedHistory([old, ...baseline], baseline, live);
  expect(merged).toEqual([old, ...live]);
  expect(merged[2]).toBe(live[1]);
});

it('preserves a live reasoning suffix when a page boundary joins earlier reasoning into the same row', async () => {
  const { chatMessagesToEntries } = await import('../../contexts/ChatContext');
  const message = (id: string, text: string) => ({
    id,
    role: 'system' as const,
    content: '',
    timestamp: '2026-01-01',
    event: { type: 'thinking' as const, text },
  });
  const recent = [message('b', 'recent '), message('c', 'reasoning')];
  const baseline = chatMessagesToEntries(recent);
  const current: ChatEntry[] = [
    { ...baseline[0], kind: 'thinking', content: 'recent reasoning LIVE' },
  ];
  const hydrated = chatMessagesToEntries([message('a', 'older '), ...recent]);
  expect(mergeHydratedHistory(hydrated, baseline, current)).toMatchObject([
    { kind: 'thinking', content: 'older recent reasoning LIVE' },
  ]);
});
