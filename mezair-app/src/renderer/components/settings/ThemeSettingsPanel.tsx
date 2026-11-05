import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, FileUp, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { AppTheme } from '../../../shared/types';
import type { ThemeDesignMessage } from '../../../shared/theme-design';
import {
  BUILT_IN_THEMES,
  getThemeContrastWarnings,
  getThemeColors,
  importVSCodeTheme,
  normalizeCustomTheme,
} from '../../../shared/themes';
import type { CustomTheme, ThemeColors } from '../../../shared/themes';
import type { ThemeDesignRequest, ThemeDesignResponse } from '../../../shared/theme-design';
import { useBrand } from '../../contexts/BrandContext';
import { SettingsLink } from '../shared/SettingsLink';
import { Button } from '../ui';
import { useSettingsContext } from './SettingsContext';
import { SettingsPanel } from './settings-ui';
import { boundThemeDesignMessages, themeAfterDeletingCustomTheme } from './theme-settings-model';

const MAX_THEME_FILE_BYTES = 1024 * 1024;
const THEME_CHANGE_EVENT = 'mezair:themes-changed';

const PROVIDER_NAMES: Record<string, string> = {
  azure: 'Azure AI Foundry',
  openai: 'OpenAI',
  codex: 'Codex',
  cursor: 'Cursor',
  devin: 'Devin',
  claude: 'Claude',
  llmgateway: 'LLMGateway',
};

const COLOR_GROUPS: ReadonlyArray<{
  label: string;
  keys: ReadonlyArray<keyof ThemeColors>;
}> = [
  {
    label: 'Surfaces',
    keys: ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-elevated', 'bg-hover'],
  },
  { label: 'Text', keys: ['text-primary', 'text-secondary', 'text-tertiary'] },
  { label: 'Accent', keys: ['accent', 'accent-foreground'] },
  { label: 'Syntax', keys: ['syntax-background', 'syntax-text'] },
  { label: 'Terminal', keys: ['terminal-background', 'terminal-foreground'] },
];

function themeId(theme: AppTheme): string {
  return theme.startsWith('custom:') ? theme.slice('custom:'.length) : '';
}

function makeThemeId(): string {
  return globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `theme-${Date.now()}`;
}

function withUniqueId(theme: CustomTheme, customThemes: readonly CustomTheme[]): CustomTheme {
  if (!customThemes.some((customTheme) => customTheme.id === theme.id)) return theme;
  return { ...theme, id: makeThemeId() };
}

function colorInputValue(color: string): string {
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(0, 7);
  if (/^#[0-9a-f]{4}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return color;
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

function ThemePreview({ theme, label = 'Preview' }: { theme: CustomTheme; label?: string }) {
  const { colors } = theme;
  return (
    <div
      role="group"
      className="max-w-sm rounded-xl border p-3"
      style={{ backgroundColor: colors['bg-primary'], borderColor: colors.border }}
      aria-label={`${label} of ${theme.name}`}
    >
      <div
        className="flex items-center justify-between gap-3 border-b pb-2"
        style={{ borderColor: colors['border-subtle'] }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: colors.accent }}
            aria-hidden="true"
          />
          <span
            className="truncate text-xs font-semibold"
            style={{ color: colors['text-primary'] }}
          >
            mezair · workspace
          </span>
        </div>
        <span className="text-xs" style={{ color: colors['text-tertiary'] }}>
          Preview
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <div
          className="ml-8 max-w-[80%] rounded-lg px-3 py-2 text-xs"
          style={{ backgroundColor: colors['bg-tertiary'], color: colors['text-primary'] }}
        >
          Map the request flow and note the open decisions.
        </div>
        <div
          className="mr-6 rounded-lg px-3 py-2 text-xs"
          style={{ backgroundColor: colors['bg-secondary'] }}
        >
          <p style={{ color: colors['text-secondary'] }}>I found two paths worth reviewing.</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="rounded px-2 py-1"
              style={{ backgroundColor: colors.accent, color: colors['accent-foreground'] }}
            >
              Open review
            </span>
            <span style={{ color: colors['text-tertiary'] }}>2 files</span>
          </div>
        </div>
      </div>
    </div>
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

function ColorEditor({
  theme,
  disabled = false,
  onChange,
}: {
  theme: CustomTheme;
  disabled?: boolean;
  onChange: (next: CustomTheme) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {COLOR_GROUPS.map((group) => (
        <fieldset key={group.label} className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-text-primary">{group.label}</legend>
          {group.keys.map((key) => (
            <label
              key={key}
              className="flex items-center justify-between gap-2 text-xs text-text-secondary"
            >
              <span>{key.replaceAll('-', ' ')}</span>
              <input
                type="color"
                aria-label={`${group.label}: ${key.replaceAll('-', ' ')}`}
                value={colorInputValue(theme.colors[key])}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...theme, colors: { ...theme.colors, [key]: event.target.value } })
                }
                className="h-8 w-10 cursor-pointer rounded border border-border bg-bg-primary p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function DraftReview({
  theme,
  busy,
  error,
  autoFocus = false,
  allowColorEditing = false,
  onChange,
  onSave,
  onCancel,
}: {
  theme: CustomTheme;
  busy: boolean;
  error: string | null;
  autoFocus?: boolean;
  allowColorEditing?: boolean;
  onChange: (theme: CustomTheme) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const contrastWarnings = allowColorEditing ? getThemeContrastWarnings(theme) : [];

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-secondary p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)] md:items-start">
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-text-primary">Theme name</span>
            <input
              autoFocus={autoFocus}
              maxLength={60}
              disabled={busy}
              value={theme.name}
              onChange={(event) => onChange({ ...theme, name: event.target.value })}
              className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <div className="text-xs text-text-tertiary">
            {theme.appearance === 'light' ? 'Light appearance' : 'Dark appearance'}
            {theme.source === 'imported' ? ' · Imported colors' : ''}
            {theme.source === 'generated' ? ' · Designed with AI' : ''}
          </div>
          <p className="text-xs text-text-tertiary">
            Colors that were not supplied use Mezair’s {theme.appearance} defaults.
          </p>
        </div>
        <ThemePreview theme={theme} label="Theme" />
      </div>
      {allowColorEditing && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p className="text-xs text-text-secondary">
            Imported colors are checked for readable text and opaque app and terminal surfaces.
            Adjust flagged colors before saving; other colors stay editable too.
          </p>
          {contrastWarnings.length > 0 && (
            <div
              role="status"
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text-secondary"
            >
              <p className="font-medium text-text-primary">Readability needs attention</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {contrastWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <ColorEditor theme={theme} disabled={busy} onChange={onChange} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
        <Button variant="primary" size="sm" disabled={busy || !theme.name.trim()} onClick={onSave}>
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          Save &amp; use
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ThemeSettingsPanel() {
  const { draft, onThemeChange, reportError, registerPendingEdit } = useSettingsContext();
  const brand = useBrand();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const importingRef = useRef(false);
  const requestSequence = useRef(0);
  const importSequence = useRef(0);
  const mountedRef = useRef(true);

  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CustomTheme | null>(null);
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ThemeDesignMessage[]>([]);
  const [designInput, setDesignInput] = useState('');
  const [designBusy, setDesignBusy] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  const [question, setQuestion] = useState<ThemeDesignResponse['question']>();
  const [guidedQuestions, setGuidedQuestions] = useState(0);
  const [retryRequest, setRetryRequest] = useState<ThemeDesignRequest | null>(null);
  const submitModeRef = useRef<'generate' | 'guided'>('generate');

  const customThemes = draft.settings.customThemes ?? [];
  const persistedTheme = draft.settings.theme ?? brand.defaultTheme;
  const requestedCustomId = themeId(persistedTheme);
  const unavailableCustomTheme =
    requestedCustomId && !customThemes.some((theme) => theme.id === requestedCustomId);
  const selectedTheme: AppTheme = unavailableCustomTheme ? 'dark' : persistedTheme;
  const selectedCustomId = themeId(selectedTheme);
  const provider = draft.settings.llmProvider;
  const providerLabel = provider ? (PROVIDER_NAMES[provider] ?? provider) : 'Configured provider';
  const modelLabel = draft.settings.openaiModel?.trim() || 'provider default model';
  const designService = window.mezair.settings.designTheme;
  const designProviderUnavailable = !provider || provider === 'cursor' || provider === 'devin';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequence.current += 1;
      importSequence.current += 1;
    };
  }, []);

  const invalidateDesignRequest = () => {
    requestSequence.current += 1;
    setDesignBusy(false);
    setDesignError(null);
    setRetryRequest(null);
  };

  const commitThemeState = useCallback(
    async (nextThemes: CustomTheme[], nextTheme: AppTheme) => {
      if (savingRef.current || !draft.loaded) return false;
      savingRef.current = true;
      setBusy(true);
      setError(null);
      reportError(null);
      let saved = false;
      try {
        saved = await draft.saveInstant({ customThemes: nextThemes, theme: nextTheme });
      } catch (saveError) {
        if (mountedRef.current) {
          reportError(
            saveError instanceof Error
              ? saveError.message
              : 'Could not save theme settings. Your changes are still available to retry.',
          );
        }
      } finally {
        savingRef.current = false;
      }
      if (saved) {
        onThemeChange?.(nextTheme);
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, {
            detail: { theme: nextTheme, customThemes: nextThemes },
          }),
        );
      }
      if (!mountedRef.current) return saved;
      setBusy(false);
      if (!saved) {
        setError('Could not save this theme. Your current theme is still active. Try again.');
        return false;
      }
      return true;
    },
    [draft.loaded, draft.saveInstant, onThemeChange, reportError],
  );

  const updateCustomThemes = async (nextThemes: CustomTheme[], activeTheme = selectedTheme) =>
    commitThemeState(nextThemes, activeTheme);

  const selectBuiltIn = async (theme: AppTheme) => {
    await commitThemeState(customThemes, theme);
  };

  const selectCustom = async (theme: CustomTheme) => {
    await commitThemeState(customThemes, `custom:${theme.id}` as AppTheme);
  };

  const startImport = async (file: File | undefined) => {
    if (!file || importingRef.current) return;
    importingRef.current = true;
    invalidateDesignRequest();
    const importId = ++importSequence.current;
    setImportBusy(true);
    setError(null);
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.json') && !lowerName.endsWith('.jsonc')) {
      setError(
        'Choose a standalone .json or .jsonc VS Code color theme file. VSIX files are not supported.',
      );
      importingRef.current = false;
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_THEME_FILE_BYTES) {
      setError('That theme file is larger than 1 MiB. Choose a smaller JSON or JSONC file.');
      importingRef.current = false;
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const raw = await file.text();
      if (!mountedRef.current || importId !== importSequence.current) return;
      const imported = importVSCodeTheme(raw, file.name);
      setCandidate(
        withUniqueId(
          normalizeCustomTheme({ ...imported, source: 'imported' }, { validateContrast: false }),
          customThemes,
        ),
      );
      setEditing(null);
      setError(null);
    } catch (importError) {
      if (!mountedRef.current || importId !== importSequence.current) return;
      setError(
        importError instanceof Error
          ? importError.message
          : 'Could not read this VS Code theme. Choose a standalone JSON or JSONC color theme.',
      );
    } finally {
      importingRef.current = false;
      if (mountedRef.current && importId === importSequence.current) setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveCandidate = async () => {
    if (!candidate || !candidate.name.trim()) return;
    if (customThemes.length >= 32) {
      setError('You can save up to 32 custom themes. Delete one before saving this draft.');
      return;
    }
    invalidateDesignRequest();
    try {
      const normalized = normalizeCustomTheme({ ...candidate, name: candidate.name.trim() });
      const savedTheme = withUniqueId(normalized, customThemes);
      if (
        (await updateCustomThemes(
          [...customThemes, savedTheme],
          `custom:${savedTheme.id}` as AppTheme,
        )) &&
        mountedRef.current
      ) {
        setCandidate(null);
        setConversation([]);
        setQuestion(undefined);
        setGuidedQuestions(0);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'This theme could not be saved.');
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return;
    try {
      const normalized = normalizeCustomTheme({ ...editing, name: editing.name.trim() });
      const nextThemes = customThemes.map((theme) =>
        theme.id === normalized.id ? normalized : theme,
      );
      if ((await updateCustomThemes(nextThemes)) && mountedRef.current) setEditing(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'These theme changes could not be saved.',
      );
    }
  };

  const duplicateTheme = async (theme: CustomTheme) => {
    if (customThemes.length >= 32) {
      setError('You can save up to 32 custom themes. Delete one before duplicating this theme.');
      return;
    }
    const duplicate = normalizeCustomTheme({
      ...theme,
      id: makeThemeId(),
      name: `${theme.name} copy`.slice(0, 60),
    });
    if ((await updateCustomThemes([...customThemes, duplicate])) && mountedRef.current) {
      setEditing(duplicate);
    }
  };

  const deleteTheme = async (id: string) => {
    const nextThemes = customThemes.filter((theme) => theme.id !== id);
    const nextTheme = themeAfterDeletingCustomTheme(selectedTheme, id);
    if ((await commitThemeState(nextThemes, nextTheme)) && mountedRef.current) {
      if (editing?.id === id) setEditing(null);
      setConfirmDeleteId(null);
    }
  };

  const runDesignRequest = async (request: ThemeDesignRequest) => {
    const requestId = ++requestSequence.current;
    setDesignBusy(true);
    setDesignError(null);
    setRetryRequest(request);
    try {
      const response = await designService(request);
      if (!mountedRef.current || requestId !== requestSequence.current) return;
      setConversation((current) =>
        boundThemeDesignMessages([
          ...current,
          {
            role: 'assistant',
            content: response.question
              ? `${response.message}\n\n${response.question.text}`
              : response.message,
          },
        ]),
      );
      if (response.question) {
        setQuestion(response.question);
        setGuidedQuestions((count) => count + 1);
      } else {
        setQuestion(undefined);
      }
      if (response.theme) {
        const generated = normalizeCustomTheme({ ...response.theme, source: 'generated' });
        setCandidate(withUniqueId(generated, customThemes));
      }
    } catch (requestError) {
      if (!mountedRef.current || requestId !== requestSequence.current) return;
      setDesignError(
        requestError instanceof Error
          ? requestError.message
          : 'Theme design failed. Your draft is still here; try again.',
      );
    } finally {
      if (mountedRef.current && requestId === requestSequence.current) setDesignBusy(false);
    }
  };

  const sendDesignMessage = async (
    content: string,
    requestedMode: 'generate' | 'guided' = 'generate',
  ) => {
    const trimmed = content.trim().slice(0, 4000);
    if (!trimmed || designBusy) return;
    const nextConversation = boundThemeDesignMessages([
      ...conversation,
      { role: 'user', content: trimmed },
    ]);
    setConversation(nextConversation);
    setDesignInput('');
    const mode = question && guidedQuestions < 3 ? 'guided' : question ? 'generate' : requestedMode;
    setQuestion(undefined);
    await runDesignRequest({
      messages: nextConversation,
      mode,
      ...(candidate ? { currentTheme: candidate } : {}),
    });
  };

  const clearDesignDraft = () => {
    invalidateDesignRequest();
    setDesignError(null);
    setQuestion(undefined);
    setGuidedQuestions(0);
    setRetryRequest(null);
    setConversation([]);
    setCandidate(null);
    setDesignInput('');
  };

  const discardCandidate = () => {
    invalidateDesignRequest();
    setCandidate(null);
    setError(null);
  };

  const discardPendingThemes = useCallback(() => {
    requestSequence.current += 1;
    importSequence.current += 1;
    importingRef.current = false;
    setImportBusy(false);
    setDesignBusy(false);
    setCandidate(null);
    setEditing(null);
    setConfirmDeleteId(null);
    setConversation([]);
    setDesignInput('');
    setQuestion(undefined);
    setGuidedQuestions(0);
    setRetryRequest(null);
    setDesignError(null);
    setError(null);
  }, []);

  const editingHasChanges = Boolean(
    editing &&
    JSON.stringify(editing) !==
      JSON.stringify(customThemes.find((theme) => theme.id === editing.id)),
  );

  const savePendingThemes = useCallback(async () => {
    if (busy || designBusy || importBusy) return false;
    if (!candidate && !editingHasChanges) {
      reportError(
        'Theme design is not finished yet. Complete it or discard the draft before leaving Settings.',
      );
      return false;
    }
    if ((candidate && !candidate.name.trim()) || (editing && !editing.name.trim())) {
      reportError('Give the theme a name before saving it.');
      return false;
    }

    try {
      let nextThemes = [...customThemes];
      if (editing) {
        const updated = normalizeCustomTheme({ ...editing, name: editing.name.trim() });
        nextThemes = nextThemes.map((theme) => (theme.id === updated.id ? updated : theme));
      }

      let nextTheme = selectedTheme;
      if (candidate) {
        if (nextThemes.length >= 32) {
          reportError('You can save up to 32 custom themes. Delete one before saving this draft.');
          return false;
        }
        const ready = withUniqueId(
          normalizeCustomTheme({ ...candidate, name: candidate.name.trim() }),
          nextThemes,
        );
        nextThemes = [...nextThemes, ready];
        nextTheme = `custom:${ready.id}` as AppTheme;
      }

      const saved = await commitThemeState(nextThemes, nextTheme);
      if (!saved || !mountedRef.current) return saved;
      setCandidate(null);
      setEditing(null);
      if (candidate) {
        setConversation([]);
        setQuestion(undefined);
        setGuidedQuestions(0);
        setRetryRequest(null);
        setDesignError(null);
      }
      if (designInput.trim() || (!candidate && conversation.length > 0)) {
        reportError(
          'Theme design is not finished yet. Complete it or discard the draft before leaving Settings.',
        );
        return false;
      }
      return true;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'This theme could not be saved.';
      reportError(message);
      setError(message);
      return false;
    }
  }, [
    busy,
    candidate,
    commitThemeState,
    customThemes,
    conversation.length,
    designBusy,
    designInput,
    editing,
    editingHasChanges,
    importBusy,
    reportError,
    selectedTheme,
  ]);

  const hasPendingThemes = Boolean(
    candidate ||
    editingHasChanges ||
    conversation.length > 0 ||
    designInput.trim() ||
    designBusy ||
    importBusy,
  );

  useEffect(() => {
    registerPendingEdit(
      'theme-drafts',
      hasPendingThemes
        ? {
            discard: discardPendingThemes,
            save: savePendingThemes,
            saving: busy || designBusy || importBusy,
          }
        : null,
    );
    return () => registerPendingEdit('theme-drafts', null);
  }, [
    busy,
    designBusy,
    discardPendingThemes,
    hasPendingThemes,
    importBusy,
    registerPendingEdit,
    savePendingThemes,
  ]);

  const systemColors = getThemeColors(brand.defaultTheme);
  const importedReviewOpen = candidate?.source === 'imported';

  return (
    <SettingsPanel
      panelId="theme"
      title="Theme"
      description="Choose a built-in palette, bring in VS Code colors, or design a theme for your workspace."
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
              disabled={!draft.loaded || busy}
              onSelect={() => void selectBuiltIn('system')}
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
                disabled={!draft.loaded || busy}
                onSelect={() => void selectBuiltIn(theme.id as AppTheme)}
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
                Imported and designed palettes stay here until you delete them.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.jsonc,application/json,text/plain"
                className="sr-only"
                aria-label="Choose a VS Code theme JSON or JSONC file"
                onChange={(event) => void startImport(event.currentTarget.files?.[0])}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  !draft.loaded ||
                  busy ||
                  importBusy ||
                  designBusy ||
                  Boolean(candidate) ||
                  Boolean(editing)
                }
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp size={14} aria-hidden="true" />
                Import VS Code theme
              </Button>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-text-tertiary">
            Imports recognized workbench, syntax, and terminal colors from standalone JSON or JSONC
            files. Unsupported colors use Mezair’s matching light or dark defaults. Files are
            limited to 1 MiB; VSIX installation and external includes are not supported.
          </p>

          {error && !candidate && !editing && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
            >
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss theme error"
                onClick={() => setError(null)}
                className="shrink-0 rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {candidate?.source === 'imported' && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium text-text-primary">Review imported theme</h5>
              <DraftReview
                theme={candidate}
                busy={busy}
                error={error}
                autoFocus
                allowColorEditing
                onChange={setCandidate}
                onSave={() => void saveCandidate()}
                onCancel={discardCandidate}
              />
            </div>
          )}

          {customThemes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-text-secondary">
              No custom themes yet. Import a standalone VS Code JSON/JSONC theme or describe one
              below.
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
                        disabled={!draft.loaded || busy}
                        onClick={() => void selectCustom(theme)}
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
                          disabled={busy || Boolean(editing)}
                          aria-label={`Edit ${theme.name}`}
                          onClick={() => {
                            invalidateDesignRequest();
                            setEditing(theme);
                            setError(null);
                          }}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || Boolean(editing)}
                          aria-label={`Duplicate ${theme.name}`}
                          onClick={() => void duplicateTheme(theme)}
                        >
                          <Copy size={14} aria-hidden="true" />
                          Duplicate
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || Boolean(editing)}
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
                            disabled={busy}
                            onClick={() => void deleteTheme(theme.id)}
                          >
                            Delete theme
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
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

          {editing && (
            <div className="space-y-3 rounded-lg border border-border bg-bg-secondary p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-text-primary">Edit theme</h5>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    Changes are saved only when you choose Save changes.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label="Close theme editor"
                  onClick={() => setEditing(null)}
                >
                  <X size={14} />
                </Button>
              </div>
              <label className="block max-w-md space-y-1">
                <span className="text-sm font-medium text-text-primary">Theme name</span>
                <input
                  maxLength={60}
                  disabled={busy}
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </label>
              <ThemePreview theme={editing} label="Theme" />
              <ColorEditor theme={editing} disabled={busy} onChange={setEditing} />
              {error && (
                <p role="alert" className="text-sm text-error">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || !editing.name.trim()}
                  onClick={() => void saveEdit()}
                >
                  {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  Save changes
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>

        <section
          aria-labelledby="theme-designer-heading"
          className="space-y-3 border-t border-border-subtle pt-5"
        >
          <div className="flex items-start gap-2.5">
            <Sparkles size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <h4 id="theme-designer-heading" className="text-sm font-semibold text-text-primary">
                Design a theme
              </h4>
              <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">
                Uses your configured {providerLabel} provider and {modelLabel}. Describe a look for
                a draft, or answer a few questions to shape it. Nothing applies until you choose
                Save &amp; use.
              </p>
            </div>
          </div>

          {conversation.length > 0 && (
            <ol
              className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border bg-bg-primary p-3"
              aria-label="Theme design conversation"
              aria-live="polite"
            >
              {conversation.map((message, index) => (
                <li
                  key={`${index}-${message.role}`}
                  className={`text-sm ${message.role === 'user' ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  <span className="mr-2 text-xs font-medium text-text-tertiary">
                    {message.role === 'user' ? 'You' : 'Designer'}
                  </span>
                  <span className="whitespace-pre-wrap">{message.content}</span>
                </li>
              ))}
            </ol>
          )}

          {question && (
            <div
              role="group"
              aria-label="Answer the theme designer’s question"
              className="space-y-2 rounded-lg border border-border bg-bg-secondary p-3"
            >
              {question.options && question.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {question.options.map((option) => (
                    <Button
                      key={option}
                      variant="secondary"
                      size="sm"
                      disabled={busy || designBusy}
                      onClick={() => void sendDesignMessage(option, 'guided')}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              )}
              {(!question.options || question.options.length === 0) && (
                <p className="text-xs text-text-tertiary">Type your answer below.</p>
              )}
              {guidedQuestions >= 3 && (
                <p className="text-xs text-text-tertiary">
                  That was the last guided question. Your answer will shape the draft.
                </p>
              )}
            </div>
          )}

          {designProviderUnavailable ? (
            draft.loaded ? (
              <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
                Theme design needs Codex, Claude, OpenAI, Azure or LLMGateway. Choose one in{' '}
                <SettingsLink to="providers#agent-providers">Providers</SettingsLink> to generate a
                theme. Imports and manual editing are still available.
              </p>
            ) : (
              <p role="status" className="text-sm text-text-tertiary">
                Loading your configured provider and model…
              </p>
            )
          ) : (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendDesignMessage(designInput, submitModeRef.current);
              }}
            >
              <label htmlFor="theme-design-prompt" className="sr-only">
                Describe your theme or answer the designer
              </label>
              <textarea
                id="theme-design-prompt"
                maxLength={4000}
                rows={3}
                value={designInput}
                onChange={(event) => setDesignInput(event.target.value)}
                disabled={!draft.loaded || busy || designBusy || importedReviewOpen}
                placeholder="Make a Mezair theme inspired by the Ferrari F1 Team"
                className="w-full resize-y rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={
                    !draft.loaded || busy || designBusy || importedReviewOpen || !designInput.trim()
                  }
                  onClick={() => {
                    submitModeRef.current = 'generate';
                  }}
                >
                  {designBusy ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus size={14} aria-hidden="true" />
                  )}
                  Create a draft
                </Button>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={
                    !draft.loaded || busy || designBusy || importedReviewOpen || !designInput.trim()
                  }
                  onClick={() => {
                    submitModeRef.current = 'guided';
                  }}
                >
                  Guide me step by step
                </Button>
                {candidate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy || designBusy}
                    onClick={discardCandidate}
                  >
                    Discard draft
                  </Button>
                )}
                {importedReviewOpen && (
                  <span className="text-xs text-text-tertiary">
                    Save or cancel the imported theme review before starting a design.
                  </span>
                )}
                {designBusy && (
                  <span role="status" className="text-xs text-text-tertiary">
                    Designing with your configured provider…
                  </span>
                )}
              </div>
            </form>
          )}

          {designError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
            >
              <span>{designError}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || designBusy || !retryRequest}
                onClick={() => retryRequest && void runDesignRequest(retryRequest)}
              >
                Try again
              </Button>
            </div>
          )}
          {candidate?.source === 'generated' && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium text-text-primary">Review designed theme</h5>
              <DraftReview
                theme={candidate}
                busy={busy || designBusy}
                error={error}
                onChange={setCandidate}
                onSave={() => void saveCandidate()}
                onCancel={discardCandidate}
              />
            </div>
          )}
          {(conversation.length > 0 || candidate) && (
            <button
              type="button"
              disabled={busy || designBusy}
              onClick={clearDesignDraft}
              className="text-xs text-text-tertiary underline underline-offset-2 hover:text-text-primary disabled:opacity-50"
            >
              Start over
            </button>
          )}
        </section>
      </div>
    </SettingsPanel>
  );
}
