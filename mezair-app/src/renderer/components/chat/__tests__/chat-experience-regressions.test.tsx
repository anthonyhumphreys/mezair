import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatDelegationRun } from '../../../../shared/chat-delegation';
import { ContextMeter, contextFill } from '../ContextMeter';
import { formatTurnUsage } from '../TurnChangesFooter';
import { placeDelegationsInTurns } from '../ChatDelegations';
import { SegmentedControl } from '../../ui/SegmentedControl';

describe('chat experience review regressions', () => {
  it.each([false, true])(
    'keeps an enabled panel in the tab order without a selected panel (first disabled: %s)',
    (disabled) => {
      const html = renderToStaticMarkup(
        <SegmentedControl
          value="none"
          label="Panels"
          onChange={() => undefined}
          options={[
            { value: 'activity', label: 'Activity', disabled },
            { value: 'review', label: 'Review' },
          ]}
        />,
      );
      expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
      expect(html).toMatch(disabled ? /tabindex="0"[^>]*>Review/ : /tabindex="0"[^>]*>Activity/);
    },
  );
  it('handles model-only, empty usage and zero-sized context without invalid percentages', () => {
    const empty = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    expect(formatTurnUsage({ ...empty, model: 'available-model' })).toEqual({
      short: 'available-model',
      full: 'available-model',
    });
    expect(formatTurnUsage(empty)).toBeNull();
    expect(contextFill({ used: 100, size: 0 })).toBe(0);
    const html = renderToStaticMarkup(<ContextMeter usage={{ used: 100, size: 0 }} />);
    expect(html).toContain('0% full');
    expect(html).not.toMatch(/Infinity|NaN/);
  });
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
