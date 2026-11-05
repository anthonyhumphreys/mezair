import type { AppTheme } from './types.js';

export const THEME_COLOR_TOKENS = [
  'bg-primary',
  'bg-secondary',
  'bg-tertiary',
  'bg-elevated',
  'bg-hover',
  'border',
  'border-subtle',
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-muted',
  'accent',
  'accent-foreground',
  'accent-glow',
  'accent-gradient-end',
  'scrim',
  'success',
  'warning',
  'info',
  'error',
  'persona-coder',
  'persona-architect',
  'persona-security',
  'persona-reviewer',
  'persona-docs',
  'overlay-ring',
  'syntax-text',
  'syntax-background',
  'syntax-constant',
  'syntax-string',
  'syntax-comment',
  'syntax-keyword',
  'syntax-parameter',
  'syntax-function',
  'syntax-string-expression',
  'syntax-punctuation',
  'syntax-link',
  'terminal-background',
  'terminal-foreground',
  'terminal-cursor',
  'terminal-selection',
  'terminal-black',
  'terminal-red',
  'terminal-green',
  'terminal-yellow',
  'terminal-blue',
  'terminal-magenta',
  'terminal-cyan',
  'terminal-white',
  'terminal-bright-black',
  'terminal-bright-red',
  'terminal-bright-green',
  'terminal-bright-yellow',
  'terminal-bright-blue',
  'terminal-bright-magenta',
  'terminal-bright-cyan',
  'terminal-bright-white',
] as const;

export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];
export type ThemeColors = Record<ThemeColorToken, string>;

export interface CustomTheme {
  id: string;
  name: string;
  appearance: 'light' | 'dark';
  /** Complete palette. Every value is a CSS-safe hex color, including optional alpha. */
  colors: ThemeColors;
  source?: 'imported' | 'generated';
}

export interface ThemeNormalizationOptions {
  /** Skip readability checks while keeping all shape, bounds, and hex validation strict. */
  validateContrast?: boolean;
}

export interface BuiltInTheme {
  id: Exclude<AppTheme, 'system' | `custom:${string}`>;
  name: string;
  appearance: 'light' | 'dark';
  colors: ThemeColors;
}

const DARK_BASE: ThemeColors = {
  'bg-primary': '#0b1020',
  'bg-secondary': '#111827',
  'bg-tertiary': '#172033',
  'bg-elevated': '#1f2a44',
  'bg-hover': '#24314f',
  border: '#33415f',
  'border-subtle': '#25304a',
  'text-primary': '#f8fbff',
  'text-secondary': '#cbd6e6',
  'text-tertiary': '#95a3b8',
  'text-muted': '#8492a8',
  accent: '#fd7e14',
  'accent-foreground': '#0b1020',
  'accent-glow': '#fd7e142e',
  'accent-gradient-end': '#ffd43b',
  scrim: '#0000008c',
  success: '#48d597',
  warning: '#ffd166',
  info: '#5ec8ff',
  error: '#ff6b8a',
  'persona-coder': '#48d597',
  'persona-architect': '#5ec8ff',
  'persona-security': '#ff6b8a',
  'persona-reviewer': '#ffd166',
  'persona-docs': '#a78bfa',
  'overlay-ring': '#0000002e',
  'syntax-text': '#f5f2ec',
  'syntax-background': '#232528',
  'syntax-constant': '#ffd43b',
  'syntax-string': '#9ad0a8',
  'syntax-comment': '#969088',
  'syntax-keyword': '#dd8a8e',
  'syntax-parameter': '#fd7e14',
  'syntax-function': '#99c4de',
  'syntax-string-expression': '#9ad0a8',
  'syntax-punctuation': '#b1aaa2',
  'syntax-link': '#99c4de',
  'terminal-background': '#121314',
  'terminal-foreground': '#f5f2ec',
  'terminal-cursor': '#b5121b',
  'terminal-selection': '#b5121b33',
  'terminal-black': '#232528',
  'terminal-red': '#e67a79',
  'terminal-green': '#72b589',
  'terminal-yellow': '#fd9029',
  'terminal-blue': '#79a7c6',
  'terminal-magenta': '#c77d4b',
  'terminal-cyan': '#8fb2b7',
  'terminal-white': '#f5f2ec',
  'terminal-bright-black': '#555656',
  'terminal-bright-red': '#f0a2a1',
  'terminal-bright-green': '#9fd0ae',
  'terminal-bright-yellow': '#ffc17f',
  'terminal-bright-blue': '#a7c7dd',
  'terminal-bright-magenta': '#e0a77c',
  'terminal-bright-cyan': '#b1d0d3',
  'terminal-bright-white': '#fffaf3',
};

const LIGHT_BASE: ThemeColors = {
  ...DARK_BASE,
  'bg-primary': '#fbfbfc',
  'bg-secondary': '#ffffff',
  'bg-tertiary': '#f3f4f6',
  'bg-elevated': '#ffffff',
  'bg-hover': '#eceef1',
  border: '#e2e4e9',
  'border-subtle': '#ecedf1',
  'text-primary': '#181b21',
  'text-secondary': '#3d4450',
  'text-tertiary': '#5f6672',
  'text-muted': '#5b626d',
  accent: '#4f46e5',
  'accent-foreground': '#fbfbfc',
  'accent-glow': '#4f46e524',
  'accent-gradient-end': '#7c3aed',
  scrim: '#0f172a52',
  success: '#15803d',
  warning: '#b45309',
  info: '#0369a1',
  error: '#dc2626',
  'persona-coder': '#15803d',
  'persona-architect': '#0369a1',
  'persona-security': '#dc2626',
  'persona-reviewer': '#b45309',
  'persona-docs': '#7c3aed',
  'overlay-ring': '#0f172a1f',
  'syntax-text': '#24292f',
  'syntax-background': '#f3f4f6',
  'syntax-constant': '#6639ba',
  'syntax-string': '#116329',
  'syntax-comment': '#57606a',
  'syntax-keyword': '#cf222e',
  'syntax-parameter': '#953800',
  'syntax-function': '#0550ae',
  'syntax-string-expression': '#116329',
  'syntax-punctuation': '#57606a',
  'syntax-link': '#0550ae',
  'terminal-background': '#ffffff',
  'terminal-foreground': '#24292f',
  'terminal-cursor': '#4f46e5',
  'terminal-selection': '#4f46e533',
  'terminal-black': '#24292f',
  'terminal-red': '#d1242f',
  'terminal-green': '#116329',
  'terminal-yellow': '#9a6700',
  'terminal-blue': '#0550ae',
  'terminal-magenta': '#8250df',
  'terminal-cyan': '#1b7c83',
  'terminal-white': '#6e7781',
  'terminal-bright-black': '#57606a',
  'terminal-bright-red': '#cf222e',
  'terminal-bright-green': '#1a7f37',
  'terminal-bright-yellow': '#9a6700',
  'terminal-bright-blue': '#0969da',
  'terminal-bright-magenta': '#a475f9',
  'terminal-bright-cyan': '#3192aa',
  'terminal-bright-white': '#8c959f',
};

function palette(appearance: 'light' | 'dark', overrides: Partial<ThemeColors> = {}): ThemeColors {
  return { ...(appearance === 'light' ? LIGHT_BASE : DARK_BASE), ...overrides };
}

export const BUILT_IN_THEMES: readonly BuiltInTheme[] = [
  { id: 'dark', name: 'Dark', appearance: 'dark', colors: palette('dark') },
  { id: 'light', name: 'Light', appearance: 'light', colors: palette('light') },
  {
    id: 'code-dark',
    name: 'Code Dark',
    appearance: 'dark',
    colors: palette('dark', {
      'bg-primary': '#121314',
      'bg-secondary': '#191a1b',
      'bg-tertiary': '#242526',
      'bg-elevated': '#202122',
      'bg-hover': '#292b2d',
      border: '#2a2b2c',
      'border-subtle': '#242628',
      'text-primary': '#bbbebf',
      'text-secondary': '#bfbfbf',
      'text-tertiary': '#969696',
      'text-muted': '#8f8f8f',
      accent: '#48a0c7',
      'accent-foreground': '#121314',
      'accent-glow': '#3994bcb3',
      'accent-gradient-end': '#74bfdf',
      scrim: '#0000008c',
      success: '#89d185',
      warning: '#cca700',
      info: '#75beff',
      error: '#f48771',
      'persona-coder': '#89d185',
      'persona-architect': '#75beff',
      'persona-security': '#f48771',
      'persona-reviewer': '#cca700',
      'persona-docs': '#c586c0',
      'syntax-text': '#c7c9ca',
      'syntax-background': '#121314',
      'syntax-constant': '#b5cea8',
      'syntax-string': '#ce9178',
      'syntax-comment': '#7f9f75',
      'syntax-keyword': '#75beff',
      'syntax-parameter': '#9cdcfe',
      'syntax-function': '#dcdcaa',
      'syntax-string-expression': '#ce9178',
      'syntax-punctuation': '#bfc1c2',
      'syntax-link': '#4fc1ff',
      'terminal-background': '#121314',
      'terminal-foreground': '#bbbebf',
      'terminal-cursor': '#48a0c7',
      'terminal-selection': '#48a0c733',
      'terminal-black': '#121314',
      'terminal-red': '#e67a79',
      'terminal-green': '#89d185',
      'terminal-yellow': '#cca700',
      'terminal-blue': '#75beff',
      'terminal-magenta': '#c586c0',
      'terminal-cyan': '#4fc1ff',
      'terminal-white': '#bfbfbf',
      'terminal-bright-black': '#858585',
      'terminal-bright-red': '#f48771',
      'terminal-bright-green': '#89d185',
      'terminal-bright-yellow': '#e5c07b',
      'terminal-bright-blue': '#9cdcfe',
      'terminal-bright-magenta': '#d670d6',
      'terminal-bright-cyan': '#67d6e6',
      'terminal-bright-white': '#e5e5e5',
    }),
  },
  {
    id: 'prompt-whisperer',
    name: 'Prompt Whisperer',
    appearance: 'dark',
    colors: palette('dark', {
      'bg-primary': '#071b1f',
      'bg-secondary': '#0d252a',
      'bg-tertiary': '#12343b',
      'bg-elevated': '#17454d',
      'bg-hover': '#1d5660',
      border: '#286a73',
      'border-subtle': '#1c4b53',
      'text-primary': '#f2fffd',
      'text-secondary': '#b7e6e1',
      'text-tertiary': '#b4d9d5',
      'text-muted': '#a8d1cc',
      accent: '#3ddbd9',
      'accent-foreground': '#071b1f',
      'accent-glow': '#3ddbd938',
      'accent-gradient-end': '#72f1df',
      success: '#75e6a7',
      warning: '#ffe08a',
      info: '#8bd3ff',
      error: '#ff879d',
      'persona-docs': '#7dd3fc',
    }),
  },
  {
    id: 'merge-conflict',
    name: 'Merge Conflict',
    appearance: 'dark',
    colors: palette('dark', {
      'bg-primary': '#120d18',
      'bg-secondary': '#1c1227',
      'bg-tertiary': '#2d1736',
      'bg-elevated': '#3b1d47',
      'bg-hover': '#4a2557',
      border: '#683362',
      'border-subtle': '#4b284e',
      'text-primary': '#fff7fb',
      'text-secondary': '#ead0df',
      'text-tertiary': '#c498b4',
      'text-muted': '#c8a2ba',
      accent: '#ff698a',
      'accent-foreground': '#120d18',
      'accent-glow': '#ff698a3d',
      'accent-gradient-end': '#ff8eb2',
      success: '#61e2a1',
      warning: '#ffd166',
      info: '#64d8ff',
      error: '#ff4d6d',
      'persona-architect': '#64d8ff',
      'persona-security': '#ff4d6d',
    }),
  },
  {
    id: 'token-bender',
    name: 'Token Bender',
    appearance: 'dark',
    colors: palette('dark', {
      'bg-primary': '#100f2a',
      'bg-secondary': '#17143a',
      'bg-tertiary': '#211a4f',
      'bg-elevated': '#2d2264',
      'bg-hover': '#392a78',
      border: '#55439a',
      'border-subtle': '#3b3174',
      'text-primary': '#fbfaff',
      'text-secondary': '#d8d2ff',
      'text-tertiary': '#aaa1da',
      'text-muted': '#a89fda',
      accent: '#9f96ea',
      'accent-foreground': '#100f2a',
      'accent-glow': '#9f96ea3d',
      'accent-gradient-end': '#c084fc',
      success: '#64e3a0',
      warning: '#ffe066',
      info: '#7dd3fc',
      error: '#ff7a9f',
      'persona-docs': '#c084fc',
    }),
  },
  {
    id: 'agent-after-hours',
    name: 'Agent After Hours',
    appearance: 'dark',
    colors: palette('dark', {
      'bg-primary': '#07110d',
      'bg-secondary': '#0d1913',
      'bg-tertiary': '#13231a',
      'bg-elevated': '#172e22',
      'bg-hover': '#1d3a2b',
      border: '#2f5a46',
      'border-subtle': '#244534',
      'text-primary': '#f3fff8',
      'text-secondary': '#ccebd8',
      'text-tertiary': '#9fc5ad',
      'text-muted': '#86aa93',
      accent: '#6ee7b7',
      'accent-foreground': '#07110d',
      'accent-glow': '#6ee7b738',
      'accent-gradient-end': '#a7f3d0',
      success: '#8cf2bd',
      warning: '#facc15',
      info: '#93c5fd',
      error: '#fb7185',
      'persona-coder': '#8cf2bd',
    }),
  },
];

const BUILT_IN_BY_ID = new Map<string, BuiltInTheme>(
  BUILT_IN_THEMES.map((theme) => [theme.id, theme]),
);

export function getThemeColors(theme: AppTheme): ThemeColors {
  if (theme.startsWith('custom:')) return DARK_BASE;
  return BUILT_IN_BY_ID.get(theme)?.colors ?? DARK_BASE;
}

export function getThemeAppearance(theme: AppTheme): 'light' | 'dark' {
  if (theme.startsWith('custom:')) return 'dark';
  return BUILT_IN_BY_ID.get(theme)?.appearance ?? 'dark';
}

export function normalizeCustomThemesForRenderer(input: unknown): CustomTheme[] {
  if (!Array.isArray(input)) throw new Error('Custom themes must be a list.');
  if (input.length > 32) throw new Error('You can save up to 32 custom themes.');

  const themes: CustomTheme[] = [];
  const ids = new Set<string>();
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Custom theme ${index + 1} must be an object.`);
    }
    const theme = Object.assign(Object.create(null) as Record<string, unknown>, item);
    if (typeof theme.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(theme.id)) {
      throw new Error(`Custom theme ${index + 1} has an invalid id.`);
    }
    if (ids.has(theme.id)) throw new Error(`Custom theme id “${theme.id}” is used more than once.`);
    if (typeof theme.name !== 'string' || !theme.name.trim() || theme.name.trim().length > 64) {
      throw new Error(`Custom theme ${index + 1} has an invalid name.`);
    }
    if (theme.appearance !== 'light' && theme.appearance !== 'dark') {
      throw new Error(`Custom theme ${index + 1} has an invalid appearance.`);
    }
    if (theme.source !== undefined && theme.source !== 'imported' && theme.source !== 'generated') {
      throw new Error(`Custom theme ${index + 1} has an invalid source.`);
    }
    if (!theme.colors || typeof theme.colors !== 'object' || Array.isArray(theme.colors)) {
      throw new Error(`Custom theme ${index + 1} colors must be an object.`);
    }

    const suppliedColors = Object.assign(
      Object.create(null) as Record<string, unknown>,
      theme.colors,
    );
    const colors = { ...(theme.appearance === 'light' ? LIGHT_BASE : DARK_BASE) };
    for (const [token, value] of Object.entries(suppliedColors)) {
      if (!(THEME_COLOR_TOKENS as readonly string[]).includes(token)) {
        throw new Error(`Custom theme ${index + 1} uses unsupported color “${token}”.`);
      }
      if (
        typeof value !== 'string' ||
        !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
      ) {
        throw new Error(`Custom theme ${index + 1} color “${token}” must be a hex color.`);
      }
      colors[token as ThemeColorToken] = normalizePaletteHex(value);
    }
    for (const token of THEME_COLOR_TOKENS) {
      if (!Object.hasOwn(suppliedColors, token)) {
        throw new Error(`Custom theme ${index + 1} is missing color “${token}”.`);
      }
    }
    themes.push({
      id: theme.id,
      name: theme.name.trim(),
      appearance: theme.appearance,
      colors,
      ...(theme.source === undefined ? {} : { source: theme.source }),
    });
    ids.add(theme.id);
  }
  return themes;
}

function normalizePaletteHex(value: string): string {
  const hex = value.toLowerCase();
  if (hex.length === 4) return `#${[...hex.slice(1)].map((channel) => channel + channel).join('')}`;
  if (hex.length === 5) return `#${[...hex.slice(1)].map((channel) => channel + channel).join('')}`;
  return hex;
}
