import { describe, expect, it, vi } from 'vitest';
import { getVisibleTurnAnchor } from '../chat-scroll-anchor';

function transcript(count: number, viewportTop: number) {
  const readRect = vi.fn((index: number) => ({ top: index * 100, bottom: (index + 1) * 100 }));
  const turns = Array.from({ length: count }, (_, index) => ({
    dataset: { chatTurnKey: `turn-${index}` },
    getBoundingClientRect: () => readRect(index),
  }));
  const container = {
    clientTop: 1,
    getBoundingClientRect: () => ({ top: viewportTop - 1 }),
    querySelectorAll: () => turns,
  } as unknown as HTMLDivElement;
  return { container, readRect };
}

describe('chat viewport anchoring', () => {
  it('finds a late turn without measuring every earlier turn', () => {
    const { container, readRect } = transcript(1000, 90_025);
    expect(getVisibleTurnAnchor(container)).toEqual({ turnKey: 'turn-900', offsetFromTurnTop: 25 });
    expect(readRect.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('uses the next turn at an exact boundary and handles empty/end gaps', () => {
    expect(getVisibleTurnAnchor(transcript(10, 500).container)).toEqual({
      turnKey: 'turn-5',
      offsetFromTurnTop: 0,
    });
    expect(getVisibleTurnAnchor(transcript(0, 0).container)).toBeUndefined();
    expect(getVisibleTurnAnchor(transcript(10, 1001).container)).toBeUndefined();
    expect(getVisibleTurnAnchor(transcript(10, -25).container)).toEqual({
      turnKey: 'turn-0',
      offsetFromTurnTop: -25,
    });
  });
});
