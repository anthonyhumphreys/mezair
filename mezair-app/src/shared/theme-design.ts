import type { CustomTheme } from './themes.js';
import type { AgentProvider } from './types.js';

export interface ThemeDesignMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ThemeDesignRequest {
  messages: ThemeDesignMessage[];
  mode: 'generate' | 'guided';
  currentTheme?: CustomTheme;
  provider?: AgentProvider;
  model?: string;
}

export interface ThemeDesignProviderOption {
  id: AgentProvider;
  label: string;
  models: Array<{ id: string; label: string }>;
  defaultModel: string;
}

export interface ThemeDesignOptions {
  providers: ThemeDesignProviderOption[];
  defaultProvider?: AgentProvider;
}

export interface ThemeDesignResponse {
  message: string;
  question?: { text: string; options?: string[] };
  theme?: CustomTheme;
}
