import type { CustomTheme } from './themes.js';

export interface ThemeDesignMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ThemeDesignRequest {
  messages: ThemeDesignMessage[];
  mode: 'generate' | 'guided';
  currentTheme?: CustomTheme;
}

export interface ThemeDesignResponse {
  message: string;
  question?: { text: string; options?: string[] };
  theme?: CustomTheme;
}
