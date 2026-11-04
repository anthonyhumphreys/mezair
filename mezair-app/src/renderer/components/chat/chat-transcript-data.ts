import type { ComposedChatTurn } from './chat-turns';
import { collectTurnFileChanges } from './chat-turn-changes';

/** Keep unchanged Undo guards stable without retaining histories from other threads. */
export function createLaterEditedPathsCollector() {
  const edits = new WeakMap<ComposedChatTurn, string[]>();
  let previous = new Map<string, string[]>();
  return (turns: readonly ComposedChatTurn[]): Map<string, string[]> => {
    const next = new Map<string, string[]>();
    const seen = new Set<string>();
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      const paths = [...seen];
      const prior = previous.get(turn.key);
      next.set(
        turn.key,
        prior?.length === paths.length && prior.every((path, offset) => path === paths[offset])
          ? prior
          : paths,
      );
      let changed = edits.get(turn);
      if (!changed) {
        changed = collectTurnFileChanges([...turn.work, ...turn.trailingWork]).map(
          (change) => change.filePath,
        );
        edits.set(turn, changed);
      }
      for (const path of changed) seen.add(path);
    }
    previous = next;
    return next;
  };
}
