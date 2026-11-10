import { describe, expect, it } from 'vitest';
import type { ChatThread } from '../../../../shared/types';
import { adjacentThreadId, nextThreadNeedingYou } from '../chat-thread-nav';

const thread = (id: string, extra: Partial<ChatThread> = {}) =>
  ({ id, attentionState: 'idle', purpose: 'normal', ...extra }) as ChatThread;

describe('chat thread navigation', () => {
  const threads = [thread('a'), thread('b', { settledAt: 'x' }), thread('c'), thread('d')];

  it('skips archived threads and wraps', () => {
    expect(adjacentThreadId(threads, 'a', 1)).toBe('c');
    expect(adjacentThreadId(threads, 'd', 1)).toBe('a');
    expect(adjacentThreadId(threads, 'a', -1)).toBe('d');
    expect(adjacentThreadId(threads, null, 1)).toBe('a');
    expect(adjacentThreadId([], 'a', 1)).toBeNull();
  });

  it('finds the next thread waiting on the user', () => {
    const list = [
      thread('a', { attentionState: 'approval' }),
      thread('b'),
      thread('c', { attentionState: 'failed' }),
    ];
    expect(nextThreadNeedingYou(list, 'a')).toBe('c');
    expect(nextThreadNeedingYou(list, 'c')).toBe('a');
    expect(nextThreadNeedingYou([thread('a')], 'a')).toBeNull();
  });
});
