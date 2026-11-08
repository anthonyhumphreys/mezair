import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatDelegationRun } from '../../../../shared/chat-delegation';
import { ContextMeter } from '../ContextMeter';
import { formatTurnUsage } from '../TurnChangesFooter';
import { placeDelegationsInTurns } from '../ChatDelegations';

describe('chat experience review regressions', () => {
  it('reports over-limit context while keeping its bar within the track', () => {
    const html = renderToStaticMarkup(<ContextMeter usage={{ used: 220000, size: 200000 }} />);
    expect(html).toContain('110% full');
    expect(html).toContain('width:100%');
  });
  it('shows usage when only context measurements are available', () => {
    const usage = formatTurnUsage({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      contextUsed: 100,
      contextSize: 200,
    });
    expect(usage?.short).toBe('50% context');
  });
  it('does not assign a delegation past an untimestamped turn to the preceding turn', () => {
    const run = { id: 'run', createdAt: '2026-11-07T10:02:00Z' } as ChatDelegationRun;
    const placed = placeDelegationsInTurns(
      [run],
      [{ key: 'previous', startedAt: '2026-11-07T10:00:00Z' }, { key: 'delivering' }],
    );
    expect(placed.byTurn.size).toBe(0);
    expect(placed.unplaced).toEqual([run]);
  });
  it('places a delivered follow-up under its actual main-process start time', () => {
    const run = { id: 'run', createdAt: '2026-11-07T10:02:00Z' } as ChatDelegationRun;
    const placed = placeDelegationsInTurns(
      [run],
      [
        { key: 'previous', startedAt: '2026-11-07T10:00:00Z' },
        { key: 'queued-follow-up', startedAt: '2026-11-07T10:01:00Z' },
      ],
    );
    expect(placed.byTurn.get('queued-follow-up')).toEqual([run]);
  });
});
