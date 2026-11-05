import { describe, expect, it } from 'vitest';
import type { AgentUIQuestionIntent } from '../../../../shared/agent-ui-intents';
import { composeChatTurns, type ComposedChatTurn } from '../chat-turns';
import { createChatTurnSearch, getActiveChatTurnSearchIndex } from '../chat-transcript-search';

const makeTurn = (content: string): ComposedChatTurn =>
  composeChatTurns([
    { kind: 'user', id: content, content },
    { kind: 'assistant', content: 'Answer', phase: 'final' },
  ])[0];

describe('loaded conversation search', () => {
  it('finds literal punctuation, preserves matched case, and counts matching turns', () => {
    const search = createChatTurnSearch();
    const turns = [makeTurn('Use C++ [flags]. C++ appears twice.'), makeTurn('Another C++ case')];
    expect(search(turns, 'c++')).toMatchObject([
      { index: 0, text: 'C++' },
      { index: 1, text: 'C++' },
    ]);
    expect(search(turns, '[flags].')).toMatchObject([{ index: 0, text: '[flags].' }]);
    expect(search(turns, '   ')).toEqual([]);
  });

  it('shows the matching passage from collapsed work and queued messages', () => {
    const turn = makeTurn('Investigate');
    turn.work = [
      {
        kind: 'event',
        sourceIndex: 1,
        event: {
          type: 'command_exec',
          command: 'pnpm test',
          output: 'Failure: unusual socket timeout',
          exitCode: 1,
        },
      },
    ];
    turn.trailingWork = [
      { kind: 'progress', sourceIndex: 2, content: 'Collecting follow-up evidence' },
    ];
    turn.pendingMessages = [
      {
        kind: 'user',
        id: 'queued',
        sourceIndex: 3,
        content: 'Check the recovery path',
        delivery: 'queued',
      },
    ];
    const search = createChatTurnSearch();
    expect(search([turn], 'socket timeout')).toMatchObject([
      { index: 0, text: 'socket timeout', before: expect.stringContaining('unusual') },
    ]);
    expect(search([turn], 'follow-up evidence')).toHaveLength(1);
    expect(search([turn], 'recovery path')).toHaveLength(1);
  });

  it('indexes visible question text but excludes response values and hidden receipts', () => {
    const question: AgentUIQuestionIntent = {
      protocolVersion: 1,
      id: 'question',
      kind: 'question',
      revision: 1,
      scope: { threadId: 'test' },
      lifecycle: 'resolved',
      presentation: { collapsed: false, hidden: false },
      createdAt: '',
      updatedAt: '',
      payload: {
        title: 'Access confirmation',
        questions: [
          {
            id: 'secret',
            kind: 'free_text',
            question: 'Which credential should be used?',
            required: true,
            allowCancel: true,
            sensitive: true,
          },
        ],
        response: { action: 'submit', answers: { secret: 'never-index-this-answer' } },
      },
    };
    const turn = { ...makeTurn('Continue'), questionReceipts: [question] };
    const search = createChatTurnSearch();
    expect(search([turn], 'Access confirmation')).toHaveLength(1);
    expect(search([turn], 'credential')).toHaveLength(1);
    expect(search([turn], 'never-index-this-answer')).toEqual([]);
    expect(
      search(
        [
          {
            ...turn,
            questionReceipts: [{ ...question, presentation: { collapsed: false, hidden: true } }],
          },
        ],
        'credential',
      ),
    ).toEqual([]);
  });

  it('updates live turns and never returns matches outside the loaded history', () => {
    const search = createChatTurnSearch();
    const original = makeTurn('Old response');
    expect(search([original], 'old')).toHaveLength(1);
    const updated = { ...original, user: { ...original.user!, content: 'New response' } };
    expect(search([updated], 'old')).toEqual([]);
    expect(search([updated], 'new')).toHaveLength(1);
    expect(search([makeTurn('Unrelated thread')], 'new')).toEqual([]);
  });

  it('keeps the selected turn active when earlier turns are prepended', () => {
    const search = createChatTurnSearch();
    const first = makeTurn('First target');
    const selected = makeTurn('Selected target');
    const initialMatches = search([first, selected], 'target');
    const prependedMatches = search([makeTurn('Earlier target'), first, selected], 'target');

    expect(getActiveChatTurnSearchIndex(prependedMatches, initialMatches[1].turnKey, 1)).toBe(2);
    expect(getActiveChatTurnSearchIndex(prependedMatches, null, 0)).toBe(0);
  });

  it('bounds the excerpt around a match in long output', () => {
    const result = createChatTurnSearch()(
      [makeTurn(`${'before '.repeat(200)}Target✨${' after'.repeat(200)}`)],
      'target✨',
    )[0];
    expect(result.text).toBe('Target✨');
    expect(result.before.startsWith('…')).toBe(true);
    expect(result.after.endsWith('…')).toBe(true);
    expect(result.before.length + result.after.length).toBeLessThanOrEqual(162);
  });
});
