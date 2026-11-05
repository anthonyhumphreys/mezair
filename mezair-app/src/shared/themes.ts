import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from 'jsonc-parser';
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
  'syntax-comment': '#8b847b',
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
      accent: '#ff5c8a',
      'accent-foreground': '#120d18',
      'accent-glow': '#ff5c8a3d',
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
      accent: '#9f7aea',
      'accent-foreground': '#100f2a',
      'accent-glow': '#9f7aea3d',
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

export function parseCustomTheme(input: unknown): CustomTheme {
  return normalizeCustomTheme(input);
}

export function normalizeCustomTheme(
  input: unknown,
  options: ThemeNormalizationOptions = {},
): CustomTheme {
  const theme = asRecord(input, 'Theme');
  const id = readBoundedString(theme.id, 'Theme id', 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
    throw new Error('Theme id can only contain letters, numbers, underscores, and hyphens.');
  }
  const name = readBoundedString(theme.name, 'Theme name', 64);
  if (theme.appearance !== 'light' && theme.appearance !== 'dark') {
    throw new Error('Theme appearance must be either light or dark.');
  }
  if (theme.source !== undefined && theme.source !== 'imported' && theme.source !== 'generated') {
    throw new Error('Theme source must be imported or generated.');
  }

  const colors = normalizeThemeColors(theme.appearance, theme.colors);

  if (options.validateContrast !== false) validateThemeContrast(colors, theme.appearance);
  return {
    id,
    name,
    appearance: theme.appearance,
    colors,
    ...(theme.source === undefined ? {} : { source: theme.source }),
  };
}

/** Returns readability warnings for a safe, fully resolved palette without changing its colors. */
export function getThemeContrastWarnings(input: unknown): string[] {
  const theme = asRecord(input, 'Theme');
  if (theme.appearance !== 'light' && theme.appearance !== 'dark') {
    throw new Error('Theme appearance must be either light or dark.');
  }
  const colors = normalizeThemeColors(theme.appearance, theme.colors);
  return collectThemeContrastWarnings(colors, theme.appearance);
}

function normalizeThemeColors(appearance: 'light' | 'dark', input: unknown): ThemeColors {
  const suppliedColors = asRecord(input, 'Theme colors');
  const colors = { ...(appearance === 'light' ? LIGHT_BASE : DARK_BASE) };
  for (const [key, value] of Object.entries(suppliedColors)) {
    if (!isThemeColorToken(key)) {
      throw new Error(`Theme color “${key}” is not supported.`);
    }
    colors[key] = normalizeHexColor(value, `Theme color “${key}”`);
  }

  if (
    Object.hasOwn(suppliedColors, 'accent') &&
    !Object.hasOwn(suppliedColors, 'accent-foreground')
  ) {
    colors['accent-foreground'] = bestContrastingForeground(
      colors.accent,
      colors['bg-primary'],
      appearance,
    );
  }
  return colors;
}

export function normalizeCustomThemes(input: unknown): CustomTheme[] {
  if (!Array.isArray(input)) throw new Error('Custom themes must be a list.');
  if (input.length > 32) throw new Error('You can save up to 32 custom themes.');

  const themes = input.map((item, index) => {
    try {
      return normalizeCustomTheme(item);
    } catch (error) {
      throw new Error(`Custom theme ${index + 1}: ${messageOf(error)}`);
    }
  });
  const ids = new Set<string>();
  for (const theme of themes) {
    if (ids.has(theme.id)) throw new Error(`Custom theme id “${theme.id}” is used more than once.`);
    ids.add(theme.id);
  }
  return themes;
}

const WORKBENCH_COLOR_MAP: Readonly<Record<string, readonly ThemeColorToken[]>> = {
  foreground: ['text-primary'],
  descriptionForeground: ['text-secondary'],
  disabledForeground: ['text-muted'],
  focusBorder: ['accent'],
  contrastBorder: ['border'],
  'editor.background': ['bg-primary', 'syntax-background'],
  'editor.foreground': ['text-primary', 'syntax-text'],
  'editor.selectionBackground': ['accent-glow'],
  'editorLineNumber.foreground': ['text-muted'],
  'editorWidget.background': ['bg-elevated'],
  'editorWidget.foreground': ['text-primary'],
  'editorGroup.border': ['border'],
  'editorGutter.background': ['bg-primary'],
  'editorGroupHeader.tabsBackground': ['bg-secondary'],
  'sideBar.background': ['bg-secondary'],
  'sideBar.foreground': ['text-secondary'],
  'sideBar.border': ['border-subtle'],
  'activityBar.background': ['bg-secondary'],
  'activityBar.foreground': ['text-primary'],
  'panel.background': ['bg-secondary'],
  'panel.border': ['border'],
  'titleBar.activeBackground': ['bg-secondary'],
  'titleBar.activeForeground': ['text-primary'],
  'list.hoverBackground': ['bg-hover'],
  'list.activeSelectionBackground': ['accent'],
  'list.activeSelectionForeground': ['accent-foreground'],
  'input.background': ['bg-tertiary'],
  'input.foreground': ['text-primary'],
  'input.border': ['border-subtle'],
  'button.background': ['accent'],
  'button.foreground': ['accent-foreground'],
  'button.secondaryBackground': ['bg-tertiary'],
  'button.secondaryForeground': ['text-primary'],
  'terminal.background': ['terminal-background'],
  'terminal.foreground': ['terminal-foreground'],
  'terminalCursor.foreground': ['terminal-cursor'],
  'terminal.selectionBackground': ['terminal-selection'],
  'terminal.ansiBlack': ['terminal-black'],
  'terminal.ansiRed': ['terminal-red'],
  'terminal.ansiGreen': ['terminal-green'],
  'terminal.ansiYellow': ['terminal-yellow'],
  'terminal.ansiBlue': ['terminal-blue'],
  'terminal.ansiMagenta': ['terminal-magenta'],
  'terminal.ansiCyan': ['terminal-cyan'],
  'terminal.ansiWhite': ['terminal-white'],
  'terminal.ansiBrightBlack': ['terminal-bright-black'],
  'terminal.ansiBrightRed': ['terminal-bright-red'],
  'terminal.ansiBrightGreen': ['terminal-bright-green'],
  'terminal.ansiBrightYellow': ['terminal-bright-yellow'],
  'terminal.ansiBrightBlue': ['terminal-bright-blue'],
  'terminal.ansiBrightMagenta': ['terminal-bright-magenta'],
  'terminal.ansiBrightCyan': ['terminal-bright-cyan'],
  'terminal.ansiBrightWhite': ['terminal-bright-white'],
};

const TEXTMATE_SCOPE_MAP: ReadonlyArray<readonly [RegExp, ThemeColorToken]> = [
  [/\bcomment\b/i, 'syntax-comment'],
  [/\bkeyword\b/i, 'syntax-keyword'],
  [/\bconstant\b|\bnumeric\b/i, 'syntax-constant'],
  [/\bstring\.interpolated\b|\btemplate\.expression\b/i, 'syntax-string-expression'],
  [/\bstring\b/i, 'syntax-string'],
  [/\bvariable\.parameter\b|\bmeta\.definition\.parameter\b/i, 'syntax-parameter'],
  [/\bentity\.name\.function\b|\bsupport\.function\b|\bmeta\.function-call\b/i, 'syntax-function'],
  [/\bpunctuation\b/i, 'syntax-punctuation'],
  [/\bmarkup\.underline\.link\b|\bstring\.other\.link\b/i, 'syntax-link'],
];

export function importVSCodeTheme(raw: string, filename?: string): CustomTheme {
  if (typeof raw !== 'string') throw new Error('Theme file contents must be text.');
  const byteLength = new TextEncoder().encode(raw).byteLength;
  if (byteLength > 1024 * 1024) throw new Error('Theme files must be 1 MiB or smaller.');
  assertJsoncDepth(raw);

  const errors: ParseError[] = [];
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const tree = parseTree(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `The VS Code theme file contains invalid JSON/JSONC (${printParseErrorCode(first.error)} near character ${first.offset + 1}).`,
    );
  }
  if (!tree) throw new Error('The VS Code theme file is empty.');
  validateJsoncProperties(tree);
  const parsed = getNodeValue(tree) as unknown;
  const theme = asRecord(parsed, 'VS Code theme');
  if (Object.hasOwn(theme, 'include')) {
    throw new Error(
      'VS Code theme includes are not supported. Import a standalone JSON/JSONC theme file.',
    );
  }
  if (theme.colors === undefined && theme.tokenColors === undefined) {
    throw new Error(
      'This file does not contain VS Code workbench colors or TextMate token colors.',
    );
  }
  const workbenchColors =
    theme.colors === undefined ? undefined : asRecord(theme.colors, 'VS Code theme colors');
  if (theme.type !== undefined && theme.type !== 'light' && theme.type !== 'dark') {
    throw new Error(
      `VS Code theme type “${String(theme.type)}” is not supported; use light or dark.`,
    );
  }
  const appearance =
    theme.type === 'light'
      ? 'light'
      : theme.type === 'dark'
        ? 'dark'
        : inferAppearance(workbenchColors);
  const colors: Partial<ThemeColors> = {};
  let mappedColorCount = 0;

  if (workbenchColors !== undefined) {
    for (const [sourceKey, mappedTokens] of Object.entries(WORKBENCH_COLOR_MAP)) {
      if (!Object.hasOwn(workbenchColors, sourceKey)) continue;
      const value = normalizeHexColor(workbenchColors[sourceKey], `VS Code color “${sourceKey}”`);
      for (const token of mappedTokens) {
        colors[token] = value;
        mappedColorCount += 1;
      }
    }
  }

  if (theme.tokenColors !== undefined) {
    if (!Array.isArray(theme.tokenColors)) {
      throw new Error('VS Code theme tokenColors must be a list.');
    }
    if (theme.tokenColors.length > 2048) {
      throw new Error('VS Code theme tokenColors can contain up to 2,048 rules.');
    }
    for (const [index, entryValue] of theme.tokenColors.entries()) {
      const entry = asRecord(entryValue, `VS Code tokenColors[${index}]`);
      const settings =
        entry.settings === undefined
          ? undefined
          : asRecord(entry.settings, `VS Code tokenColors[${index}].settings`);
      if (!settings || settings.foreground === undefined) continue;
      const mappedTokens = mapTextMateScopes(entry.scope);
      if (mappedTokens.length === 0) continue;
      const color = normalizeHexColor(
        settings.foreground,
        `VS Code tokenColors[${index}].settings.foreground`,
      );
      for (const token of mappedTokens) {
        colors[token] = color;
        mappedColorCount += 1;
      }
    }
  }

  if (mappedColorCount === 0) {
    throw new Error('No supported VS Code workbench or syntax color fields were found.');
  }

  const suppliedName = typeof theme.name === 'string' ? theme.name : undefined;
  const name = suppliedName?.trim() || filenameToName(filename) || 'Imported VS Code theme';
  return normalizeCustomTheme(
    {
      id: makeThemeId(),
      name,
      appearance,
      colors,
      source: 'imported',
    },
    { validateContrast: false },
  );
}

function inferAppearance(workbenchColors: Record<string, unknown> | undefined): 'light' | 'dark' {
  const editorBackground = workbenchColors?.['editor.background'];
  if (editorBackground === undefined) return 'dark';
  const normalized = normalizeHexColor(editorBackground, 'VS Code color “editor.background”');
  const background = parseHex(normalized);
  if (background.a < 1) {
    return relativeLuminance(composite(background, parseHex(DARK_BASE['bg-primary']))) >= 0.5
      ? 'light'
      : 'dark';
  }
  return relativeLuminance(background) >= 0.5 ? 'light' : 'dark';
}

function mapTextMateScopes(scope: unknown): ThemeColorToken[] {
  const scopes = typeof scope === 'string' ? [scope] : Array.isArray(scope) ? scope : [];
  const mapped = new Set<ThemeColorToken>();
  for (const value of scopes) {
    if (typeof value !== 'string') continue;
    for (const [pattern, token] of TEXTMATE_SCOPE_MAP) {
      if (pattern.test(value)) mapped.add(token);
    }
  }
  return [...mapped];
}

function filenameToName(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const basename = filename.split(/[\\/]/).pop() ?? '';
  const withoutExtension = basename.replace(/\.(jsonc?|JSONC?)$/, '');
  const name = withoutExtension.trim();
  return name ? name.slice(0, 64) : undefined;
}

function makeThemeId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `import-${randomUUID()}`;
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function assertJsoncDepth(raw: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      if (depth > 64) throw new Error('Theme files cannot be nested more than 64 levels.');
    } else if (char === '}' || char === ']') {
      depth -= 1;
    }
  }
}

function validateJsoncProperties(node: JsonNode, path: Array<string | number> = []): void {
  if (node.type === 'object') {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      if (keyNode?.type !== 'string' || typeof keyNode.value !== 'string') continue;
      const key = keyNode.value;
      const propertyPath = [...path, key].join('.');
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new Error(`Theme property “${propertyPath}” is not supported.`);
      }
      if (seen.has(key))
        throw new Error(`Theme property “${propertyPath}” appears more than once.`);
      seen.add(key);
      if (valueNode) validateJsoncProperties(valueNode, [...path, key]);
    }
  } else if (node.type === 'array') {
    for (const [index, child] of (node.children ?? []).entries()) {
      validateJsoncProperties(child, [...path, index]);
    }
  }
}

function validateThemeContrast(colors: ThemeColors, appearance: 'light' | 'dark'): void {
  const warning = collectThemeContrastWarnings(colors, appearance)[0];
  if (warning) throw new Error(warning);
}

function collectThemeContrastWarnings(colors: ThemeColors, appearance: 'light' | 'dark'): string[] {
  const warnings: string[] = [];
  const primaryBackground = parseHex(colors['bg-primary']);
  if (primaryBackground.a < 1) {
    warnings.push(
      'Theme color “bg-primary” must be opaque so the main app surface stays readable.',
    );
  }
  const primarySurface = composite(
    primaryBackground,
    parseHex((appearance === 'light' ? LIGHT_BASE : DARK_BASE)['bg-primary']),
  );
  const secondarySurface = composite(parseHex(colors['bg-secondary']), primarySurface);
  const tertiarySurface = composite(parseHex(colors['bg-tertiary']), primarySurface);
  const elevatedSurface = composite(parseHex(colors['bg-elevated']), primarySurface);
  const hoverSurface = composite(parseHex(colors['bg-hover']), primarySurface);
  for (const token of ['text-primary', 'text-secondary', 'text-tertiary'] as const) {
    for (const [surfaceName, surface] of [
      ['bg-primary', primarySurface],
      ['bg-secondary', secondarySurface],
      ['bg-tertiary', tertiarySurface],
      ['bg-elevated', elevatedSurface],
      ['bg-hover', hoverSurface],
    ] as const) {
      addContrastWarning(warnings, colors[token], surface, token, surfaceName, 4.5);
    }
  }

  const accentColor = parseHex(colors.accent);
  for (const [surfaceName, surface] of [
    ['bg-primary', primarySurface],
    ['bg-secondary', secondarySurface],
    ['bg-tertiary', tertiarySurface],
    ['bg-elevated', elevatedSurface],
    ['bg-hover', hoverSurface],
  ] as const) {
    const accent = composite(accentColor, surface);
    addContrastWarning(warnings, colors.accent, surface, 'accent', surfaceName, 4.5);
    addContrastWarning(
      warnings,
      colors['accent-foreground'],
      accent,
      'accent-foreground',
      `accent on ${surfaceName}`,
      4.5,
    );
  }
  const syntaxBackground = composite(parseHex(colors['syntax-background']), primarySurface);
  addContrastWarning(
    warnings,
    colors['syntax-text'],
    syntaxBackground,
    'syntax-text',
    'syntax-background',
    4.5,
  );
  const terminalBackgroundColor = parseHex(colors['terminal-background']);
  if (terminalBackgroundColor.a < 1) {
    warnings.push(
      'Theme color “terminal-background” must be opaque because terminal transparency is off.',
    );
  }
  if (parseHex(colors['terminal-foreground']).a < 1) {
    warnings.push('Theme color “terminal-foreground” must be opaque for readable terminal output.');
  }
  const terminalBackground = composite(terminalBackgroundColor, primarySurface);
  addContrastWarning(
    warnings,
    colors['terminal-foreground'],
    terminalBackground,
    'terminal-foreground',
    'terminal-background',
    4.5,
  );
  return warnings;
}

function bestContrastingForeground(
  accentHex: string,
  backgroundHex: string,
  appearance: 'light' | 'dark',
): string {
  const baseSurface = composite(
    parseHex(backgroundHex),
    parseHex((appearance === 'light' ? LIGHT_BASE : DARK_BASE)['bg-primary']),
  );
  const accent = composite(parseHex(accentHex), baseSurface);
  const whiteRatio = contrastRatio(relativeLuminance(WHITE), relativeLuminance(accent));
  const blackRatio = contrastRatio(relativeLuminance(BLACK), relativeLuminance(accent));
  return whiteRatio >= blackRatio ? '#ffffff' : '#000000';
}

function addContrastWarning(
  warnings: string[],
  foregroundHex: string,
  background: Rgba,
  foregroundName: string,
  backgroundName: string,
  minimum: number,
): void {
  const foreground = composite(parseHex(foregroundHex), background);
  const ratio = contrastRatio(relativeLuminance(foreground), relativeLuminance(background));
  if (ratio < minimum) {
    warnings.push(
      `Theme colors “${foregroundName}” and “${backgroundName}” need at least ${minimum}:1 contrast (currently ${ratio.toFixed(2)}:1).`,
    );
  }
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

function parseHex(hex: string): Rgba {
  const value = normalizeHexColor(hex, 'Color').slice(1);
  const expanded =
    value.length === 3 || value.length === 4 ? [...value].map((x) => x + x).join('') : value;
  const alpha = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  return {
    r: parseInt(expanded.slice(0, 2), 16) / 255,
    g: parseInt(expanded.slice(2, 4), 16) / 255,
    b: parseInt(expanded.slice(4, 6), 16) / 255,
    a: alpha,
  };
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function relativeLuminance(color: Rgba): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  return Object.assign(Object.create(null) as Record<string, unknown>, input);
}

function readBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength)
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function isThemeColorToken(value: string): value is ThemeColorToken {
  return (THEME_COLOR_TOKENS as readonly string[]).includes(value);
}

function normalizeHexColor(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
  ) {
    throw new Error(`${label} must be a hex color such as #abc or #aabbccdd.`);
  }
  const hex = value.toLowerCase();
  if (hex.length === 4) return `#${[...hex.slice(1)].map((channel) => channel + channel).join('')}`;
  if (hex.length === 5) return `#${[...hex.slice(1)].map((channel) => channel + channel).join('')}`;
  return hex;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
