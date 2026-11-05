import { describe, expect, it } from 'vitest';
import {
  boundThemeDesignMessages,
  MAX_THEME_DESIGN_CONTEXT_LENGTH,
  MAX_THEME_DESIGN_MESSAGE_LENGTH,
  MAX_THEME_DESIGN_MESSAGES,
  themeAfterDeletingCustomTheme,
} from '../theme-settings-model';

describe('theme settings model', () => {
  it('keeps the newest messages and respects the per-message character limit', () => {
    const messages = Array.from({ length: MAX_THEME_DESIGN_MESSAGES + 2 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content:
        index === MAX_THEME_DESIGN_MESSAGES + 1
          ? `${index}: ${'x'.repeat(MAX_THEME_DESIGN_MESSAGE_LENGTH + 4)}`
          : `${index}: short note`,
    }));

    const bounded = boundThemeDesignMessages(messages);

    expect(bounded).toHaveLength(MAX_THEME_DESIGN_MESSAGES);
    expect(bounded[0].content.startsWith('2: ')).toBe(true);
    expect(
      bounded.every((message) => message.content.length <= MAX_THEME_DESIGN_MESSAGE_LENGTH),
    ).toBe(true);
    expect(bounded.at(-1)?.content.startsWith('21: ')).toBe(true);
  });

  it('retains the newest conversation context under the total service limit', () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `${index}: ${'y'.repeat(MAX_THEME_DESIGN_MESSAGE_LENGTH - 3)}`,
    }));

    const bounded = boundThemeDesignMessages(messages);

    expect(bounded.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(
      MAX_THEME_DESIGN_CONTEXT_LENGTH,
    );
    expect(bounded.at(-1)?.content.startsWith('7: ')).toBe(true);
    expect(bounded.length).toBeLessThan(messages.length);
  });

  it('falls back to dark only when deleting the active custom theme', () => {
    expect(themeAfterDeletingCustomTheme('custom:palette-1', 'palette-1')).toBe('dark');
    expect(themeAfterDeletingCustomTheme('custom:palette-1', 'palette-2')).toBe('custom:palette-1');
    expect(themeAfterDeletingCustomTheme('system', 'palette-1')).toBe('system');
  });
});
