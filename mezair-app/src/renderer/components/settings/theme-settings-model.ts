import type { AppTheme } from '../../../shared/types';
import type { ThemeDesignMessage } from '../../../shared/theme-design';

export const MAX_THEME_DESIGN_MESSAGES = 20;
export const MAX_THEME_DESIGN_MESSAGE_LENGTH = 4000;
export const MAX_THEME_DESIGN_CONTEXT_LENGTH = 16000;

/** Keeps the newest conversation context within the UI and service limits. */
export function boundThemeDesignMessages(
  messages: readonly ThemeDesignMessage[],
): ThemeDesignMessage[] {
  const bounded = messages.slice(-MAX_THEME_DESIGN_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content.slice(0, MAX_THEME_DESIGN_MESSAGE_LENGTH),
  }));

  let total = bounded.reduce((sum, message) => sum + message.content.length, 0);
  while (total > MAX_THEME_DESIGN_CONTEXT_LENGTH && bounded.length > 0) {
    const oldest = bounded[0];
    const excess = total - MAX_THEME_DESIGN_CONTEXT_LENGTH;
    if (oldest.content.length <= excess) {
      total -= oldest.content.length;
      bounded.shift();
    } else {
      oldest.content = oldest.content.slice(excess);
      total -= excess;
    }
  }

  return bounded;
}

/** Deleting the selected custom theme always leaves a valid built-in choice. */
export function themeAfterDeletingCustomTheme(theme: AppTheme, id: string): AppTheme {
  return theme === `custom:${id}` ? 'dark' : theme;
}
