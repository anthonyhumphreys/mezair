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
