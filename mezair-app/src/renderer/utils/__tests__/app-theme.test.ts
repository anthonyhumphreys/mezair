import { describe, expect, it } from 'vitest';
import { getThemeColors, normalizeCustomTheme } from '../../../shared/themes';
import { applyAppTheme } from '../app-theme';

function createThemeRoot() {
  const properties = new Map<string, string>();
  const style = {
    colorScheme: '',
    getPropertyValue: (name: string) => properties.get(name) ?? '',
    removeProperty: (name: string) => {
      properties.delete(name);
    },
    setProperty: (name: string, value: string) => {
      properties.set(name, value);
    },
  };
  const events: Event[] = [];
  const root = {
    dataset: {} as DOMStringMap,
    ownerDocument: { defaultView: { dispatchEvent: (event: Event) => events.push(event) } },
    style,
  } as unknown as HTMLElement;
  return { root, style, properties, events };
}

describe('applyAppTheme', () => {
  it('applies custom colors and replaces them cleanly when switching to a built-in theme', () => {
    const custom = normalizeCustomTheme({
      id: 'quiet-light',
      name: 'Quiet Light',
      appearance: 'light',
      colors: { accent: '#005a9e' },
    });
    const { root, style, properties, events } = createThemeRoot();

    const applied = applyAppTheme('custom:quiet-light', [custom], root);
    expect(applied.appearance).toBe('light');
    expect(root.dataset.theme).toBe('custom:quiet-light');
    expect(style.colorScheme).toBe('light');
    expect(properties.get('--color-accent')).toBe('#005a9e');
    expect(properties.get('--color-terminal-background')).toBe(
      custom.colors['terminal-background'],
    );

    applyAppTheme('code-dark', [custom], root);
    expect(root.dataset.theme).toBe('code-dark');
    expect(style.colorScheme).toBe('dark');
    expect(properties.get('--color-accent')).toBe(getThemeColors('code-dark').accent);
    expect(properties.get('--color-terminal-background')).toBe(
      getThemeColors('code-dark')['terminal-background'],
    );
    expect(events).toHaveLength(2);
  });

  it('falls back to Dark and reports a missing local custom definition', () => {
    const { root, properties } = createThemeRoot();
    const result = applyAppTheme('custom:missing-theme', [], root);

    expect(result.missingCustomTheme).toBe('missing-theme');
    expect(result.effectiveTheme).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(properties.get('--color-bg-primary')).toBe(getThemeColors('dark')['bg-primary']);
  });
});
