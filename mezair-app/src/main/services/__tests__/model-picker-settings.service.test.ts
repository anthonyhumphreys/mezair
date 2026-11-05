import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL } from '../../db/schema';
import type { ModelPickerPreferences } from '../../../shared/model-picker';
import { normalizeCustomTheme } from '../../../shared/themes';

const db = new Database(':memory:');
db.exec(SCHEMA_SQL);
vi.mock('../../db/database.js', () => ({ getDb: () => db }));
vi.mock('../auth.service.js', () => ({
  decryptSecret: () => undefined,
  readStoredSecret: () => ({ state: 'not-configured' }),
  encryptSecret: (value: string) => Buffer.from(value),
}));
import { getSettings, updateSettings } from '../settings.service';

beforeEach(() => {
  db.exec('DELETE FROM settings; INSERT INTO settings (id) VALUES (1)');
});
afterAll(() => db.close());

describe('persisted model picker preferences', () => {
  it('round-trips cross-provider presets without changing the current model', () => {
    const preferences: ModelPickerPreferences = {
      style: 'slider',
      presets: [
        { id: 'quick', label: 'Quick', provider: 'cursor', model: 'auto' },
        {
          id: 'deep',
          label: 'Deep work',
          provider: 'llmgateway',
          model: 'vendor/model',
          reasoningEffort: 'high',
        },
      ],
    };
    const original = getSettings();
    updateSettings({ modelPicker: preferences });
    expect(getSettings().modelPicker).toEqual(preferences);
    expect(getSettings().openaiModel).toBe(original.openaiModel);
    updateSettings({ modelPicker: { ...preferences, style: 'dropdown' } });
    expect(getSettings().modelPicker).toEqual({ ...preferences, style: 'dropdown' });
  });

  it('recovers from corrupt persisted settings', () => {
    db.prepare('UPDATE settings SET model_picker = ?').run('{invalid');
    expect(getSettings().modelPicker).toEqual({ style: 'dropdown', presets: [] });
  });
});

describe('persisted custom themes', () => {
  const customTheme = () =>
    normalizeCustomTheme({
      id: 'quiet-light',
      name: 'Quiet Light',
      appearance: 'light',
      colors: { accent: '#4f46e5' },
      source: 'generated',
    });

  it('round-trips validated palettes and selected custom theme ids', () => {
    const theme = customTheme();
    updateSettings({ customThemes: [theme], theme: `custom:${theme.id}` });

    expect(getSettings().customThemes).toEqual([theme]);
    expect(getSettings().theme).toBe(`custom:${theme.id}`);
  });

  it('validates the entire settings patch before writing any field', () => {
    updateSettings({ theme: 'light' });
    expect(() =>
      updateSettings({
        theme: 'dark',
        customThemes: [
          {
            id: 'invalid',
            name: 'Invalid',
            appearance: 'dark',
            colors: { 'bg-primary': 'url(https://example.com)' },
          } as never,
        ],
      }),
    ).toThrow('must be a hex color');

    expect(getSettings().theme).toBe('light');
    expect(getSettings().customThemes).toEqual([]);
  });

  it('falls back when a locally stored custom theme is removed but preserves an unknown synced id on read', () => {
    const theme = customTheme();
    updateSettings({ customThemes: [theme], theme: `custom:${theme.id}` });
    updateSettings({ customThemes: [] });
    expect(getSettings().theme).toBe('dark');

    db.prepare('UPDATE settings SET theme = ?, custom_themes = ? WHERE id = 1').run(
      'custom:from-another-device',
      '[]',
    );
    expect(getSettings().theme).toBe('custom:from-another-device');
    expect(getSettings().customThemes).toEqual([]);
  });
});
