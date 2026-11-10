import { describe, expect, it } from 'vitest';
import { formatElapsed, formatMessageTime, formatShortAgo } from '../chat-time';

const NOW = new Date(2026, 10, 7, 15, 0, 0).getTime();

describe('chat-time', () => {
  it('formats short ages', () => {
    expect(formatShortAgo(new Date(NOW - 20_000).toISOString(), NOW)).toBe('now');
    expect(formatShortAgo(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe('4m');
    expect(formatShortAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h');
    expect(formatShortAgo(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d');
    expect(formatShortAgo(undefined, NOW)).toBeNull();
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(new Date(NOW - 42_000).toISOString(), NOW)).toBe('42s');
    expect(formatElapsed(new Date(NOW - 245_000).toISOString(), NOW)).toBe('4m 05s');
    expect(formatElapsed(new Date(NOW - 72 * 60_000).toISOString(), NOW)).toBe('1h 12m');
  });

  it('labels today, yesterday and older messages', () => {
    expect(formatMessageTime(new Date(2026, 10, 7, 9, 5).toISOString(), NOW)).not.toMatch(
      /Yesterday/,
    );
    expect(formatMessageTime(new Date(2026, 10, 6, 9, 5).toISOString(), NOW)).toMatch(
      /^Yesterday /,
    );
    expect(formatMessageTime(new Date(2025, 0, 2).toISOString(), NOW)).toMatch(/2025/);
    expect(formatMessageTime('nope', NOW)).toBeNull();
  });
});
