import type { ChatScrollAnchor } from './chat-scroll-position';

/** Turns are in vertical transcript order: locate the viewport with logarithmic layout reads. */
export function getVisibleTurnAnchor(container: HTMLDivElement): ChatScrollAnchor | undefined {
  const viewportTop = container.getBoundingClientRect().top + container.clientTop;
  const turns = container.querySelectorAll<HTMLElement>('[data-chat-turn-key]');
  let low = 0;
  let high = turns.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (turns[middle].getBoundingClientRect().bottom > viewportTop) high = middle;
    else low = middle + 1;
  }
  const turn = turns[low];
  const turnKey = turn?.dataset.chatTurnKey;
  if (!turnKey) return undefined;
  return { turnKey, offsetFromTurnTop: viewportTop - turn.getBoundingClientRect().top };
}
