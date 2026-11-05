import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEMES,
  getThemeContrastWarnings,
  getThemeColors,
  importVSCodeTheme,
  normalizeCustomTheme,
  normalizeCustomThemes,
  THEME_COLOR_TOKENS,
} from '../themes';
import { normalizeCustomThemesForRenderer } from '../theme-palette';

describe('custom theme palettes', () => {
  it('resolves a complete safe palette from a partial definition', () => {
    const theme = normalizeCustomTheme({
      id: 'my-theme',
      name: 'My theme',
      appearance: 'dark',
      colors: { accent: '#0af' },
    });

    expect(Object.keys(theme.colors)).toHaveLength(THEME_COLOR_TOKENS.length);
    expect(theme.colors.accent).toBe('#00aaff');
    expect(theme.colors['accent-foreground']).toBe('#000000');
    expect(theme.colors['terminal-background']).toBe('#121314');
  });

  it('rejects unsafe color values, unknown tokens, and unreadable base pairs', () => {
    expect(() =>
      normalizeCustomTheme({
        id: 'bad-css',
        name: 'Bad CSS',
        appearance: 'dark',
        colors: { 'bg-primary': 'url(https://example.com/pixel)' },
      }),
    ).toThrow('must be a hex color');
    expect(() =>
      normalizeCustomTheme({
        id: 'unknown-token',
        name: 'Unknown token',
        appearance: 'dark',
        colors: { background: '#000000' },
      }),
    ).toThrow('is not supported');
    expect(() =>
      normalizeCustomTheme({
        id: 'low-contrast',
        name: 'Low contrast',
        appearance: 'dark',
        colors: {
          'bg-primary': '#000000',
          'text-primary': '#000000',
          'text-secondary': '#ffffff',
        },
      }),
    ).toThrow('need at least 4.5:1 contrast');
    expect(() =>
      normalizeCustomTheme({
        id: 'invisible-accent',
        name: 'Invisible accent',
        appearance: 'dark',
        colors: { accent: '#0b1020', 'accent-foreground': '#ffffff' },
      }),
    ).toThrow('“accent” and “bg-primary” need at least 4.5:1 contrast');
    expect(() =>
      normalizeCustomTheme({
        id: 'unreadable-surface',
        name: 'Unreadable surface',
        appearance: 'dark',
        colors: { 'bg-tertiary': '#ffffff' },
      }),
    ).toThrow('bg-tertiary');
    expect(() =>
      normalizeCustomTheme({
        id: 'unreadable-terminal',
        name: 'Unreadable terminal',
        appearance: 'dark',
        colors: {
          'terminal-background': '#000000',
          'terminal-foreground': '#000000',
        },
      }),
    ).toThrow('terminal-foreground');
    expect(() =>
      normalizeCustomTheme({
        id: 'transparent-canvas',
        name: 'Transparent canvas',
        appearance: 'dark',
        colors: { 'bg-primary': '#12131480' },
      }),
    ).toThrow('bg-primary” must be opaque');
  });

  it('keeps every built-in palette contrast-safe and preserves Code Dark values', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(() =>
        normalizeCustomTheme({
          id: `copy-${theme.id}`,
          name: theme.name,
          appearance: theme.appearance,
          colors: theme.colors,
        }),
      ).not.toThrow(theme.id);
    }
    expect(getThemeColors('code-dark')['bg-primary']).toBe('#121314');
    expect(getThemeColors('code-dark')['bg-secondary']).toBe('#191a1b');
    expect(getThemeColors('code-dark').accent).toBe('#48a0c7');
  });

  it('validates renderer palettes without loading the importer or changing palette values', () => {
    const safe = normalizeCustomThemesForRenderer([
      {
        id: 'renderer-safe',
        name: 'Renderer safe',
        appearance: 'light',
        colors: BUILT_IN_THEMES.find((theme) => theme.id === 'light')!.colors,
      },
    ]);
    expect(safe[0].colors.accent).toBe(
      BUILT_IN_THEMES.find((theme) => theme.id === 'light')!.colors.accent,
    );

    expect(() =>
      normalizeCustomThemesForRenderer([
        {
          id: 'unsafe-renderer',
          name: 'Unsafe renderer',
          appearance: 'dark',
          colors: {
            ...BUILT_IN_THEMES.find((theme) => theme.id === 'dark')!.colors,
            accent: 'url(https://example.com/pixel)',
          },
        },
      ]),
    ).toThrow('must be a hex color');

    expect(() =>
      normalizeCustomThemesForRenderer([
        {
          id: 'partial-renderer',
          name: 'Partial renderer',
          appearance: 'dark',
          colors: { accent: '#fff' },
        },
      ]),
    ).toThrow('is missing color');
  });

  it('imports JSONC workbench, TextMate, and terminal colors without reading includes', () => {
    const theme = importVSCodeTheme(
      `{
        // VS Code theme JSONC accepts comments and trailing commas.
        "type": "dark",
        "colors": {
          "editor.background": "#1f1f1f",
          "editor.foreground": "#d4d4d4",
          "terminal.background": "#1e1e1e",
          "terminal.foreground": "#cccccc",
          "terminal.ansiRed": "#cd3131",
        },
        "tokenColors": [{
          "scope": ["keyword.control", "entity.name.function"],
          "settings": { "foreground": "#569cd6" },
        }],
      }`,
      'Code.jsonc',
    );

    expect(theme.name).toBe('Code');
    expect(theme.source).toBe('imported');
    expect(theme.colors['bg-primary']).toBe('#1f1f1f');
    expect(theme.colors['syntax-text']).toBe('#d4d4d4');
    expect(theme.colors['syntax-keyword']).toBe('#569cd6');
    expect(theme.colors['syntax-function']).toBe('#569cd6');
    expect(theme.colors['terminal-red']).toBe('#cd3131');
    expect(theme.colors['terminal-background']).toBe('#1e1e1e');
  });

  it('rejects includes, unrelated JSON, and unsafe mapped fields with actionable errors', () => {
    expect(() => importVSCodeTheme('{"include":"./other.json"}')).toThrow(
      'includes are not supported',
    );
    expect(() => importVSCodeTheme('{"name":"settings"}')).toThrow('does not contain');
    expect(() => importVSCodeTheme('{"colors":{"button.background":"rgba(0, 0, 0, 1)"}}')).toThrow(
      'VS Code color “button.background” must be a hex color',
    );
    expect(() => importVSCodeTheme('{"tokenColors":[]}')).toThrow('No supported');
    expect(() => importVSCodeTheme('{"colors":{"editor.background":"#fff"},')).toThrow(
      'invalid JSON/JSONC',
    );
    expect(() => importVSCodeTheme('{"type":"hc","colors":{"editor.background":"#000"}}')).toThrow(
      'type “hc” is not supported',
    );
    expect(() =>
      importVSCodeTheme(
        '{"__proto__":{"type":"light","colors":{"editor.background":"#fff","editor.foreground":"#111"}}}',
      ),
    ).toThrow('property “__proto__” is not supported');
    expect(() =>
      importVSCodeTheme('{"colors":{"editor.background":"#000000","editor.background":"#ffffff"}}'),
    ).toThrow('colors.editor.background” appears more than once');
  });

  it('infers light appearance for standalone files without extension metadata', () => {
    const theme = importVSCodeTheme(
      '{"colors":{"editor.background":"#ffffff","editor.foreground":"#111111"}}',
    );
    expect(theme.appearance).toBe('light');
  });

  it('chooses a readable default button foreground when the imported theme omits one', () => {
    const theme = importVSCodeTheme(
      '{"type":"dark","colors":{"editor.background":"#1f1f1f","editor.foreground":"#cccccc","button.background":"#0078d4"}}',
    );
    expect(theme.colors['accent-foreground']).toMatch(/^#(?:000000|ffffff)$/);
  });

  it('keeps low-contrast imports editable as drafts and reports warnings until repaired', () => {
    const draft = importVSCodeTheme(
      '{"type":"dark","colors":{"editor.background":"#0b1020","editor.foreground":"#ffffff","button.background":"#0b1020","button.foreground":"#ffffff"}}',
    );

    expect(draft.colors.accent).toBe('#0b1020');
    expect(normalizeCustomTheme(draft, { validateContrast: false }).colors.accent).toBe('#0b1020');
    expect(getThemeContrastWarnings(draft)).toContain(
      'Theme colors “accent” and “bg-primary” need at least 4.5:1 contrast (currently 1.00:1).',
    );
    expect(getThemeContrastWarnings({ ...draft, name: '' })).toContain(
      'Theme colors “accent” and “bg-primary” need at least 4.5:1 contrast (currently 1.00:1).',
    );
    expect(() =>
      getThemeContrastWarnings({
        ...draft,
        name: '',
        colors: { ...draft.colors, accent: 'url(https://example.com/color)' },
      }),
    ).toThrow('must be a hex color');
    expect(() => normalizeCustomTheme(draft)).toThrow('“accent” and “bg-primary” need');
    expect(() =>
      normalizeCustomTheme(
        {
          ...draft,
          colors: { ...draft.colors, accent: 'url(https://example.com/color)' },
        },
        { validateContrast: false },
      ),
    ).toThrow('must be a hex color');

    const repaired = normalizeCustomTheme({
      ...draft,
      colors: {
        ...draft.colors,
        accent: '#fd7e14',
        'accent-foreground': '#0b1020',
      },
    });
    expect(getThemeContrastWarnings(repaired)).toEqual([]);
  });

  it('bounds input size, JSONC nesting, and saved theme count', () => {
    expect(() => importVSCodeTheme(' '.repeat(1024 * 1024 + 1))).toThrow('1 MiB or smaller');
    expect(() => importVSCodeTheme(`${'{'.repeat(65)}${'}'.repeat(65)}`)).toThrow('64 levels');
    expect(() =>
      normalizeCustomThemes(
        Array.from({ length: 33 }, (_, index) => ({
          id: `theme-${index}`,
          name: `Theme ${index}`,
          appearance: 'dark',
          colors: {},
        })),
      ),
    ).toThrow('up to 32');
  });
});
