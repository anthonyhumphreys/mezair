import { useEffect, useMemo, useState } from 'react';
import type { AppSettings, AppTheme } from '../../../shared/types';
import { normalizeCustomThemesForRenderer } from '../../../shared/theme-palette';
import { SettingsContextProvider } from './SettingsContext';
import type { SettingsContextValue } from './SettingsContext';
import type { SettingsDraft } from './useSettingsDraft';
import { ThemeSettingsPanel } from './ThemeSettingsPanel';
import { applyAppTheme } from '../../utils/app-theme';

export const THEMES_PREVIEW_CUSTOM_THEME = normalizeCustomThemesForRenderer([
  {
    id: 'graphite-red',
    name: 'Graphite Red',
    appearance: 'dark',
    source: 'generated',
    colors: {
      accent: '#ff6b6b',
      'accent-foreground': '#111318',
      'accent-glow': '#ff6b6b33',
      'accent-gradient-end': '#ff9970',
    },
  },
])[0]!;

const THEMES_PREVIEW_LIBRARY_THEME = normalizeCustomThemesForRenderer([
  {
    id: 'midnight-lime',
    name: 'Midnight Lime',
    appearance: 'dark',
    source: 'imported',
    colors: {
      accent: '#8fe388',
      'accent-foreground': '#111318',
      'accent-glow': '#8fe38833',
      'accent-gradient-end': '#c0f38b',
    },
  },
])[0]!;

const INITIAL_SETTINGS: Partial<AppSettings> = {
  theme: 'dark',
  customThemes: [THEMES_PREVIEW_LIBRARY_THEME],
};

export function ThemesPreview() {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [activeTheme, setActiveTheme] = useState<AppTheme>('dark');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    applyAppTheme(settings.theme ?? 'dark', settings.customThemes ?? []);
  }, [settings.theme, settings.customThemes]);

  const value = useMemo<SettingsContextValue>(() => {
    const fakeDraft = {
      settings,
      persisted: settings,
      loaded: true,
      dirtyKeys: new Set<string>(),
      savingKeys: new Set<string>(),
      recentlySavedKeys: new Set<string>(),
      saving: false,
      isDirty: () => false,
      isSaving: () => false,
      wasRecentlySaved: () => false,
      update: (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) =>
        setSettings((current) => ({ ...current, [key]: value })),
      updateMany: (patch: Partial<AppSettings>) =>
        setSettings((current) => ({ ...current, ...patch })),
      saveKeys: async () => true,
      saveAllDirty: async () => true,
      discardKeys: () => undefined,
      applyPersisted: (patch: Partial<AppSettings>) =>
        setSettings((current) => ({ ...current, ...patch })),
      flushAutosave: async () => true,
      saveInstant: async (patch: Partial<AppSettings>) => {
        setSettings((current) => ({ ...current, ...patch }));
        return true;
      },
    } as unknown as SettingsDraft;

    return {
      draft: fakeDraft,
      onThemeChange: setActiveTheme,
      registerPendingEdit: () => undefined,
      reportError: setSaveError,
    };
  }, [settings]);

  return (
    <SettingsContextProvider value={value}>
      <main className="h-full overflow-auto bg-bg-primary px-5 py-4 text-text-primary md:px-8">
        <div className="mx-auto max-w-5xl">
          <header className="mb-3 border-b border-border-subtle pb-3">
            <h1 className="text-lg font-semibold">Synthetic theme settings</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Import, edit, select, and design themes with in-memory settings only.
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              Theme design responses in this replay are local fixtures; no AI request is made.
            </p>
          </header>
          <ThemeSettingsPanel />
          <p role="status" className="mt-3 text-xs text-text-tertiary">
            Active selection: {activeTheme}
          </p>
          {saveError && (
            <p role="alert" className="mt-2 text-sm text-error">
              {saveError}
            </p>
          )}
        </div>
      </main>
    </SettingsContextProvider>
  );
}
