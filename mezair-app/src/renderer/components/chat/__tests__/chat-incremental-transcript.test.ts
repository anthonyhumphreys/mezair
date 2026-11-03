import { describe, expect, it } from 'vitest';
import type { ChatEntry } from '../../../contexts/ChatContext';
import { composeChatTurns, createChatTurnComposer } from '../chat-turns';
import { createLaterEditedPathsCollector } from '../chat-transcript-data';

const user = (id: string): ChatEntry => ({ kind: 'user', id, content: id });
const answer = (content: string): ChatEntry => ({ kind: 'assistant', content, phase: 'final' });
const edit = (filePath: string): ChatEntry => ({
  kind: 'event',
  event: { type: 'file_edit', filePath, diff: '@@ -1 +1 @@\n-old\n+new' },
});

describe('live transcript identity and correctness', () => {
  it('reuses settled turns while refreshing streamed answers and terminal outcomes', () => {
    const compose = createChatTurnComposer();
    const entries = [user('a'), answer('done'), user('b'), answer('live')];
    const first = compose(entries, { active: true });
    const streamed = [...entries.slice(0, -1), answer('live delta')];
    const next = compose(streamed, { active: true });
    expect(next).toEqual(composeChatTurns(streamed, { active: true }));
    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    const settled = compose(streamed, { active: false });
    expect(settled).toEqual(composeChatTurns(streamed));
    expect(settled[0]).toBe(first[0]);
    expect(settled[1]).not.toBe(next[1]);
  });

  it('invalidates edits, shifted indexes, same-id replacement histories and cleared threads', () => {
    const compose = createChatTurnComposer();
    const histories: ChatEntry[][] = [
      [user('a'), answer('one'), user('b'), answer('two')],
      [user('a'), answer('edited'), user('b'), answer('two')],
      [user('prefix'), answer('prefix'), user('a'), answer('edited'), user('b'), answer('two')],
      [user('a'), answer('another thread with the same ids')],
      [],
      [
        { kind: 'event', event: { type: 'status', status: 'executing' } },
        user('a'),
        answer('restored'),
      ],
    ];
    for (const entries of histories) {
      expect(compose(entries, { active: true })).toEqual(
        composeChatTurns(entries, { active: true }),
      );
      expect(compose(entries)).toEqual(composeChatTurns(entries));
    }
  });

  it('keeps queued follow-ups with their original turn until delivery changes', () => {
    const compose = createChatTurnComposer();
    const queued: ChatEntry = { kind: 'user', id: 'queued', content: 'next', delivery: 'queued' };
    const entries = [user('a'), answer('one'), queued];
    expect(compose(entries, { active: true })).toEqual(composeChatTurns(entries, { active: true }));
    const delivered = [...entries.slice(0, -1), { ...queued, delivery: 'delivered' as const }];
    expect(compose(delivered)).toEqual(composeChatTurns(delivered));
  });

  it('updates earlier Undo guards for new later edits and releases paths after history replacement', () => {
    const collect = createLaterEditedPathsCollector();
    const compose = createChatTurnComposer();
    const entries = [user('a'), edit('first.ts'), answer('done'), user('b'), answer('live')];
    const initial = collect(compose(entries));
    const streamed = collect(compose([...entries.slice(0, -1), answer('more')]));
    expect(streamed.get('a')).toBe(initial.get('a'));
    const changed = collect(compose([...entries, edit('first.ts'), edit('later.ts')]));
    expect(changed.get('a')).toEqual(['first.ts', 'later.ts']);
    expect(changed.get('b')).toEqual([]);
    expect(collect(compose([user('other'), answer('new')])).has('a')).toBe(false);
  });
});
