import type { ComposedChatTurn } from './chat-turns';

export interface ChatTurnSearchMatch {
  index: number;
  turnKey: string;
  before: string;
  text: string;
  after: string;
}

export function getActiveChatTurnSearchIndex(
  matches: ChatTurnSearchMatch[],
  selectedTurnKey: string | null,
  fallbackIndex: number,
): number {
  if (selectedTurnKey) {
    const selectedIndex = matches.findIndex((match) => match.turnKey === selectedTurnKey);
    if (selectedIndex >= 0) return selectedIndex;
  }
  return Math.min(Math.max(fallbackIndex, 0), Math.max(matches.length - 1, 0));
}

/** Index immutable turns only while their conversation search is open. */
export function createChatTurnSearch() {
  const textByTurn = new WeakMap<ComposedChatTurn, string>();
  return (turns: ComposedChatTurn[], query: string): ChatTurnSearchMatch[] => {
    const needle = query.trim();
    if (!needle) return [];
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
    return turns.flatMap((turn, index) => {
      let text = textByTurn.get(turn);
      if (text === undefined) {
        text = [
          turn.user?.content,
          turn.answer?.content,
          ...[...turn.work, ...turn.trailingWork].map((item) =>
            item.kind === 'event'
              ? [item.event.command, item.event.output, item.event.filePath, item.event.text]
                  .filter(Boolean)
                  .join('\n')
              : item.content,
          ),
          ...(turn.pendingMessages ?? []).map((message) => message.content),
          ...(turn.questionReceipts ?? [])
            .filter((receipt) => !receipt.presentation.hidden)
            .flatMap((receipt) => [
              receipt.payload.title,
              ...receipt.payload.questions.flatMap((question) => [
                question.question,
                question.context,
                ...(question.options ?? []).map((option) => option.label),
              ]),
            ]),
        ]
          .filter(Boolean)
          .join('\n');
        textByTurn.set(turn, text);
      }
      const match = pattern.exec(text);
      if (!match) return [];
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + match[0].length + 100);
      return [
        {
          index,
          turnKey: turn.key,
          before: (start > 0 ? '…' : '') + text.slice(start, match.index).replace(/\s+/g, ' '),
          text: match[0],
          after:
            text.slice(match.index + match[0].length, end).replace(/\s+/g, ' ') +
            (end < text.length ? '…' : ''),
        },
      ];
    });
  };
}
