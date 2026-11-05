import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FileUp, Pencil, Sparkles, Trash2 } from 'lucide-react';
import type { AppTheme } from '../../../shared/types';
import {
  BUILT_IN_THEMES,
  getThemeColors,
  normalizeCustomThemesForRenderer,
} from '../../../shared/theme-palette';
import type { CustomTheme, ThemeColors } from '../../../shared/theme-palette';
import { useBrand } from '../../contexts/BrandContext';
import { Button } from '../ui';
import { useSettingsContext } from './SettingsContext';
import { SettingsPanel } from './settings-ui';
import { themeAfterDeletingCustomTheme } from './theme-settings-model';

const ThemeSettingsWorkspace = lazy(() => import('./ThemeSettingsWorkspace'));
const THEME_CHANGE_EVENT = 'mezair:themes-changed';

type WorkspaceIntent = 'import' | 'create' | 'edit' | 'duplicate';

function themeId(theme: AppTheme): string {
  return theme.startsWith('custom:') ? theme.slice('custom:'.length) : '';
}

function ColorSwatches({ colors }: { colors: ThemeColors }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-md border border-border-subtle">
      {(['bg-primary', 'bg-secondary', 'accent'] as const).map((token) => (
        <span
          key={token}
          className="h-5 w-5"
          style={{ backgroundColor: colors[token] }}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function ThemeChoice({
  name,
  description,
  colors,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  description: string;
  colors: ThemeColors;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-16 w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:cursor-wait disabled:opacity-60 ${
        selected ? 'border-accent bg-accent/10' : 'border-border bg-bg-primary hover:bg-bg-tertiary'
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block text-sm font-medium ${selected ? 'text-accent' : 'text-text-primary'}`}
        >
          {name}
        </span>
        <span className="mt-0.5 block text-xs text-text-tertiary">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <ColorSwatches colors={colors} />
        {selected && <Check size={15} className="text-accent" aria-label="Selected" />}
      </span>
    </button>
  );
}

export function ThemeSettingsPanel() {
  const { draft, onThemeChange, reportError } = useSettingsContext();
  const brand = useBrand();
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [workspaceIntent, setWorkspaceIntent] = useState<WorkspaceIntent | null>(null);
  const [workspaceThemeId, setWorkspaceThemeId] = useState<string | undefined>();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const customThemes = useMemo(
    () => normalizeCustomThemesForRenderer(draft.settings.customThemes ?? []),
    [draft.settings.customThemes],
  );
  const persistedTheme = draft.settings.theme ?? brand.defaultTheme;
  const requestedCustomId = themeId(persistedTheme);
  const unavailableCustomTheme =
    requestedCustomId && !customThemes.some((theme) => theme.id === requestedCustomId);
  const selectedTheme: AppTheme = unavailableCustomTheme ? 'dark' : persistedTheme;
  const selectedCustomId = themeId(selectedTheme);

  const commitThemeState = useCallback(
    async (nextThemes: CustomTheme[], nextTheme: AppTheme) => {
      if (savingRef.current || workspaceIntent || !draft.loaded) return false;
      savingRef.current = true;
      if (mountedRef.current) {
        setBusy(true);
        setError(null);
      }
      if (mountedRef.current) reportError(null);
      let saved = false;
      try {
        saved = await draft.saveInstant({ customThemes: nextThemes, theme: nextTheme });
      } catch (saveError) {
        if (mountedRef.current) {
          reportError(
            saveError instanceof Error
              ? saveError.message
              : 'Could not save theme settings. Your changes are available to retry.',
          );
        }
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
      if (!saved) {
        if (mountedRef.current) {
          setError('Could not save this theme. Your current theme is still active. Try again.');
        }
        return false;
      }
      onThemeChange?.(nextTheme);
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, {
          detail: { theme: nextTheme, customThemes: nextThemes },
        }),
      );
      if (!mountedRef.current) return true;
      return true;
    },
    [draft.loaded, draft.saveInstant, onThemeChange, reportError, workspaceIntent],
  );

  const selectBuiltIn = (theme: AppTheme) => void commitThemeState(customThemes, theme);
  const selectCustom = (theme: CustomTheme) =>
    void commitThemeState(customThemes, `custom:${theme.id}` as AppTheme);

  const deleteTheme = async (id: string) => {
    const nextThemes = customThemes.filter((theme) => theme.id !== id);
    const nextTheme = themeAfterDeletingCustomTheme(selectedTheme, id);
    if (await commitThemeState(nextThemes, nextTheme)) setConfirmDeleteId(null);
  };

  const openWorkspace = (intent: WorkspaceIntent, id?: string) => {
    setWorkspaceThemeId(id);
    setWorkspaceIntent(intent);
    setError(null);
  };

  const systemColors = getThemeColors(brand.defaultTheme);

  return (
    <SettingsPanel
      panelId="theme"
      title="Theme"
      description="Choose a built-in palette or one of your saved themes. Import, edit, and design tools load when you open them."
      saveKeys={['theme', 'customThemes']}
    >
      <div className="space-y-6">
        <section aria-labelledby="built-in-themes-heading" className="space-y-3">
          <div>
            <h4 id="built-in-themes-heading" className="text-sm font-semibold text-text-primary">
              Built-in themes
            </h4>
            <p className="mt-0.5 text-xs text-text-tertiary">
              A ready-to-use palette, saved as soon as you choose it.
            </p>
          </div>
          {unavailableCustomTheme && (
            <p
              role="status"
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text-secondary"
            >
              This custom theme isn’t available on this device. Mezair Dark is in use.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <ThemeChoice
              name="System"
              description="Follow your device’s light or dark setting."
              colors={systemColors}
              selected={selectedTheme === 'system'}
              disabled={!draft.loaded || busy || Boolean(workspaceIntent)}
              onSelect={() => selectBuiltIn('system')}
            />
            {BUILT_IN_THEMES.map((theme) => (
              <ThemeChoice
                key={theme.id}
                name={theme.name}
                description={
                  theme.id === 'dark'
                    ? 'Mezair’s neutral dark workspace.'
                    : `${theme.appearance} appearance`
                }
                colors={theme.colors}
                selected={selectedTheme === theme.id}
                disabled={!draft.loaded || busy || Boolean(workspaceIntent)}
                onSelect={() => selectBuiltIn(theme.id as AppTheme)}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="custom-themes-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h4 id="custom-themes-heading" className="text-sm font-semibold text-text-primary">
                My themes{' '}
                <span className="font-normal text-text-tertiary">({customThemes.length})</span>
              </h4>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Saved themes stay on this device until you delete them.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!draft.loaded || busy || Boolean(workspaceIntent)}
                onClick={() => openWorkspace('import')}
              >
                <FileUp size={14} aria-hidden="true" />
                Import theme
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!draft.loaded || busy || Boolean(workspaceIntent)}
                onClick={() => openWorkspace('create')}
              >
                <Sparkles size={14} aria-hidden="true" />
                Create a theme
              </Button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
            >
              {error}
            </p>
          )}

          {customThemes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-text-secondary">
              No custom themes yet. Import a standalone VS Code JSON/JSONC theme or create one.
            </div>
          ) : (
            <ul
              className="divide-y divide-border-subtle rounded-lg border border-border"
              aria-label="Custom themes"
            >
              {customThemes.map((theme) => {
                const selected = selectedCustomId === theme.id;
                const deleting = confirmDeleteId === theme.id;
                return (
                  <li key={theme.id} className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        aria-pressed={selected}
                        disabled={!draft.loaded || busy || Boolean(workspaceIntent)}
                        onClick={() => selectCustom(theme)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
                      >
                        <ColorSwatches colors={theme.colors} />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                            {theme.name}
                            {selected && (
                              <span className="text-xs font-normal text-accent">In use</span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs text-text-tertiary">
                            {theme.appearance === 'light' ? 'Light' : 'Dark'}
                            {theme.source === 'imported'
                              ? ' · Imported'
                              : theme.source === 'generated'
                                ? ' · Designed'
                                : ''}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || Boolean(workspaceIntent)}
                          aria-label={`Edit ${theme.name}`}
                          onClick={() => openWorkspace('edit', theme.id)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || Boolean(workspaceIntent) || customThemes.length >= 32}
                          aria-label={`Duplicate ${theme.name}`}
                          onClick={() => openWorkspace('duplicate', theme.id)}
                        >
                          <Copy size={14} aria-hidden="true" />
                          Duplicate
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || Boolean(workspaceIntent)}
                          aria-label={`Delete ${theme.name}`}
                          onClick={() => setConfirmDeleteId(deleting ? null : theme.id)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Delete
                        </Button>
                      </div>
                    </div>
                    {deleting && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-bg-tertiary px-3 py-2">
                        <p className="text-xs text-text-secondary">
                          Delete <span className="font-medium text-text-primary">{theme.name}</span>
                          ?{selected ? ' The app will switch to Mezair Dark.' : ''}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy || Boolean(workspaceIntent)}
                            onClick={() => void deleteTheme(theme.id)}
                          >
                            Delete theme
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || Boolean(workspaceIntent)}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Keep
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {workspaceIntent && (
          <Suspense
            fallback={
              <p
                role="status"
                className="rounded-md border border-border px-3 py-2 text-sm text-text-tertiary"
              >
                Loading theme tools…
              </p>
            }
          >
            <ThemeSettingsWorkspace
              key={`${workspaceIntent}:${workspaceThemeId ?? ''}`}
              initialIntent={workspaceIntent}
              initialEditThemeId={workspaceThemeId}
              onClose={() => setWorkspaceIntent(null)}
            />
          </Suspense>
        )}
      </div>
    </SettingsPanel>
  );
}
