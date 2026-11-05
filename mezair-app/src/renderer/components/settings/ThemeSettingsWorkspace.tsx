import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileUp, Loader2, Plus, Sparkles, X } from 'lucide-react';
import type { AgentProvider, AppTheme } from '../../../shared/types';
import type { ThemeDesignMessage } from '../../../shared/theme-design';
import type { ThemeDesignOptions } from '../../../shared/theme-design';
import {
  getThemeContrastWarnings,
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
import { boundThemeDesignMessages } from './theme-settings-model';

const MAX_THEME_FILE_BYTES = 1024 * 1024;
const THEME_CHANGE_EVENT = 'mezair:themes-changed';

type WorkspaceIntent = 'import' | 'create' | 'edit' | 'duplicate';

interface ThemeSettingsWorkspaceProps {
  initialIntent: WorkspaceIntent;
  initialEditThemeId?: string;
  onClose: () => void;
}

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
  {
    label: 'Syntax',
    keys: [
      'syntax-background',
      'syntax-text',
      'syntax-constant',
      'syntax-string',
      'syntax-comment',
      'syntax-keyword',
      'syntax-parameter',
      'syntax-function',
      'syntax-string-expression',
      'syntax-punctuation',
      'syntax-link',
    ],
  },
  { label: 'Terminal', keys: ['terminal-background', 'terminal-foreground'] },
];

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

export default function ThemeSettingsWorkspace({
  initialIntent,
  initialEditThemeId,
  onClose,
}: ThemeSettingsWorkspaceProps) {
  const { draft, onThemeChange, reportError, registerPendingEdit } = useSettingsContext();
  const brand = useBrand();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const importingRef = useRef(false);
  const requestSequence = useRef(0);
  const importSequence = useRef(0);
  const optionsSequence = useRef(0);
  const optionsStarted = useRef(false);
  const initialActionHandled = useRef(false);
  const designProviderRef = useRef<AgentProvider | ''>('');
  const designModelRef = useRef('');
  const mountedRef = useRef(true);

  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CustomTheme | null>(null);
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const [conversation, setConversation] = useState<ThemeDesignMessage[]>([]);
  const [designInput, setDesignInput] = useState('');
  const [designBusy, setDesignBusy] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  const [question, setQuestion] = useState<ThemeDesignResponse['question']>();
  const [guidedQuestions, setGuidedQuestions] = useState(0);
  const [retryRequest, setRetryRequest] = useState<ThemeDesignRequest | null>(null);
  const [designerOpen, setDesignerOpen] = useState(initialIntent === 'create');
  const [designOptions, setDesignOptions] = useState<ThemeDesignOptions | null>(null);
  const [designOptionsBusy, setDesignOptionsBusy] = useState(false);
  const [designOptionsError, setDesignOptionsError] = useState<string | null>(null);
  const [designOptionsRetry, setDesignOptionsRetry] = useState(0);
  const [designProvider, setDesignProvider] = useState<AgentProvider | ''>('');
  const [designModel, setDesignModel] = useState('');
  const [closeConfirm, setCloseConfirm] = useState(false);
  const submitModeRef = useRef<'generate' | 'guided'>('generate');

  designProviderRef.current = designProvider;
  designModelRef.current = designModel;

  const customThemes = draft.settings.customThemes ?? [];
  const persistedTheme = draft.settings.theme ?? brand.defaultTheme;
  const selectedTheme: AppTheme = persistedTheme;
  const designService = window.mezair.settings.designTheme;
  const selectedProviderOption = designOptions?.providers.find(
    (providerOption) => providerOption.id === designProvider,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequence.current += 1;
      importSequence.current += 1;
      optionsSequence.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!designerOpen || optionsStarted.current) return;
    optionsStarted.current = true;
    const requestId = ++optionsSequence.current;
    const previousProvider = designProviderRef.current;
    const previousModel = designModelRef.current;
    setDesignOptionsBusy(true);
    setDesignOptionsError(null);
    void window.mezair.settings
      .getThemeDesignOptions(designOptionsRetry > 0)
      .then((options) => {
        if (!mountedRef.current || requestId !== optionsSequence.current) return;
        setDesignOptions(options);
        const retainedProvider = options.providers.find(
          (providerOption) => providerOption.id === previousProvider,
        );
        const recommendedProvider =
          retainedProvider ??
          options.providers.find(
            (providerOption) => providerOption.id === options.defaultProvider,
          ) ??
          options.providers[0];
        setDesignProvider(recommendedProvider?.id ?? '');
        const retainedModel = recommendedProvider?.models.find(
          (model) => model.id === previousModel,
        );
        setDesignModel(
          retainedModel?.id ??
            recommendedProvider?.models.find(
              (model) => model.id === recommendedProvider?.defaultModel,
            )?.id ??
            recommendedProvider?.models[0]?.id ??
            '',
        );
      })
      .catch((optionsError: unknown) => {
        if (!mountedRef.current || requestId !== optionsSequence.current) return;
        setDesignOptionsError(
          optionsError instanceof Error
            ? optionsError.message
            : 'Could not load available theme design providers. Try again.',
        );
      })
      .finally(() => {
        if (mountedRef.current && requestId === optionsSequence.current)
          setDesignOptionsBusy(false);
      });
    return () => {
      optionsSequence.current += 1;
      optionsStarted.current = false;
    };
  }, [designerOpen, designOptionsRetry]);

  const invalidateDesignRequest = () => {
    requestSequence.current += 1;
    setDesignBusy(false);
    setDesignError(null);
    setRetryRequest(null);
  };

  const refreshDesignOptions = () => {
    setDesignOptionsError(null);
    setDesignOptionsRetry((version) => version + 1);
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
    if (!customThemes.some((theme) => theme.id === editing.id)) {
      setError(
        'This theme was deleted in another window. Your edits are still here; save them as a new theme or cancel.',
      );
      return;
    }
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

  const saveEditAsNew = async () => {
    if (!editing || !editing.name.trim()) return;
    if (customThemes.length >= 32) {
      setError('You can save up to 32 custom themes. Delete one before saving this theme as new.');
      return;
    }
    try {
      const copy = normalizeCustomTheme({
        ...editing,
        id: makeThemeId(),
        name: `${editing.name.trim()} copy`.slice(0, 60),
      });
      if ((await updateCustomThemes([...customThemes, copy])) && mountedRef.current) {
        setEditing(null);
        setError(null);
      }
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

  useEffect(() => {
    if (initialActionHandled.current || !draft.loaded) return;
    if (initialIntent === 'edit' || initialIntent === 'duplicate') {
      const initialTheme = customThemes.find((theme) => theme.id === initialEditThemeId);
      if (!initialTheme) {
        setError('That saved theme is no longer available. Choose another theme to edit.');
        initialActionHandled.current = true;
        return;
      }
      if (initialIntent === 'edit') {
        setEditing(initialTheme);
      } else {
        void duplicateTheme(initialTheme);
      }
    }
    initialActionHandled.current = true;
  }, [customThemes, draft.loaded, duplicateTheme, initialEditThemeId, initialIntent]);

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
    if (!trimmed || designBusy || designOptionsBusy || !designProvider || !designModel) return;
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
      provider: designProvider,
      model: designModel,
      ...(candidate ? { currentTheme: candidate } : {}),
      ...(!candidate && editing ? { currentTheme: editing } : {}),
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
    if (editing && !customThemes.some((theme) => theme.id === editing.id)) {
      const message =
        'This theme was deleted in another window. Save your edits as a new theme or cancel before leaving Settings.';
      reportError(message);
      setError(message);
      return false;
    }
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
    if (!hasPendingThemes) setCloseConfirm(false);
  }, [hasPendingThemes]);

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

  const importedReviewOpen = candidate?.source === 'imported';
  const retryWithCurrentSelection = () => {
    if (!retryRequest || !designProvider || !designModel) return;
    const currentTheme = candidate ?? editing;
    void runDesignRequest({
      messages: retryRequest.messages,
      mode: retryRequest.mode,
      provider: designProvider,
      model: designModel,
      ...(currentTheme ? { currentTheme } : {}),
    });
  };

  return (
    <SettingsPanel
      title="Theme tools"
      description="Import, edit, and design a custom palette. These tools load on request."
      saveKeys={['theme', 'customThemes']}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary p-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {initialIntent === 'create'
                ? 'Create a theme'
                : initialIntent === 'import'
                  ? 'Import a VS Code theme'
                  : initialIntent === 'duplicate'
                    ? 'Duplicate a saved theme'
                    : 'Edit a saved theme'}
            </p>
            <p className="mt-0.5 text-xs text-text-tertiary">
              Work stays as a draft until you save it. Your built-in and saved theme choices remain
              above.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || importBusy || designBusy}
            onClick={() => {
              if (hasPendingThemes) setCloseConfirm(true);
              else onClose();
            }}
          >
            Back to theme choices
          </Button>
        </div>

        {closeConfirm && (
          <div
            role="group"
            aria-label="Discard unsaved theme work?"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
          >
            <p className="text-sm text-text-secondary">
              Discard this unsaved theme work and close the tools?
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={busy || importBusy || designBusy}
                onClick={() => {
                  discardPendingThemes();
                  onClose();
                }}
              >
                Discard and close
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || importBusy || designBusy}
                onClick={() => setCloseConfirm(false)}
              >
                Keep working
              </Button>
            </div>
          </div>
        )}

        {initialIntent === 'import' && (
          <section aria-label="Import a VS Code theme" className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-text-primary">
                Import a VS Code color theme
              </h4>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Use a standalone JSON or JSONC theme file.
              </p>
            </div>
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
              disabled={!draft.loaded || busy || importBusy || designBusy || Boolean(candidate)}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={14} aria-hidden="true" />
              Choose theme file
            </Button>
            <p className="text-xs leading-relaxed text-text-tertiary">
              Imports recognized workbench, syntax, and terminal colors from standalone JSON or
              JSONC files. Unsupported colors use Mezair’s matching light or dark defaults. Files
              are limited to 1 MiB; VSIX installation and external includes are not supported.
            </p>
            {error && !candidate && (
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
          </section>
        )}

        {(initialIntent === 'edit' || initialIntent === 'duplicate') && (
          <section aria-label="Edit a saved theme" className="space-y-3">
            {error && !editing && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            {!editing && !error && (
              <p role="status" className="text-sm text-text-tertiary">
                {busy ? 'Creating a copy…' : 'Loading saved theme…'}
              </p>
            )}
            {editing && (
              <div className="space-y-3 rounded-lg border border-border bg-bg-secondary p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">
                      {initialIntent === 'duplicate' ? 'Edit copied theme' : `Edit ${editing.name}`}
                    </h4>
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
                  {!customThemes.some((theme) => theme.id === editing.id) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || !editing.name.trim()}
                      onClick={() => void saveEditAsNew()}
                    >
                      Save as new theme
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {designerOpen ? (
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
                  Choose a ready provider and model for this request, then describe a look or answer
                  a few questions. These choices do not change your Provider settings. Nothing
                  applies until you choose Save &amp; use.
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
                        disabled={busy || designBusy || designOptionsBusy}
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

            {(designOptionsBusy || (!designOptions && !designOptionsError)) && (
              <p role="status" className="text-sm text-text-tertiary">
                Loading available providers and models…
              </p>
            )}
            {designOptionsError && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
              >
                <span>{designOptionsError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={designOptionsBusy}
                  onClick={refreshDesignOptions}
                >
                  Retry
                </Button>
              </div>
            )}
            {designOptions && designOptions.providers.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
                <p>
                  No theme design providers are ready. Connect or enable a supported provider in{' '}
                  <SettingsLink to="providers#agent-providers">Providers</SettingsLink>, then check
                  again.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={designOptionsBusy}
                  onClick={refreshDesignOptions}
                >
                  Check again
                </Button>
              </div>
            )}
            {selectedProviderOption && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendDesignMessage(designInput, submitModeRef.current);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-sm text-text-secondary">
                    <span>Provider</span>
                    <select
                      value={designProvider}
                      disabled={busy || designBusy || designOptionsBusy}
                      onChange={(event) => {
                        const nextProvider = event.target.value as AgentProvider;
                        const providerOption = designOptions?.providers.find(
                          (option) => option.id === nextProvider,
                        );
                        setDesignProvider(nextProvider);
                        setDesignModel(
                          providerOption?.models.find(
                            (model) => model.id === providerOption?.defaultModel,
                          )?.id ??
                            providerOption?.models[0]?.id ??
                            '',
                        );
                      }}
                      className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
                    >
                      {designOptions?.providers.map((providerOption) => (
                        <option key={providerOption.id} value={providerOption.id}>
                          {providerOption.label}
                          {providerOption.id === designOptions?.defaultProvider
                            ? ' · Recommended'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1 text-sm text-text-secondary">
                    <span>Model</span>
                    <select
                      value={designModel}
                      disabled={
                        busy ||
                        designBusy ||
                        designOptionsBusy ||
                        !selectedProviderOption.models.length
                      }
                      onChange={(event) => setDesignModel(event.target.value)}
                      className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
                    >
                      {selectedProviderOption.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                          {model.id === selectedProviderOption.defaultModel ? ' · Recommended' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-text-tertiary">
                    Available, connected options only. Recommended defaults come from your provider
                    catalog. This selection is for theme design only and does not change global
                    settings.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={designOptionsBusy || designBusy || busy}
                    onClick={refreshDesignOptions}
                  >
                    Refresh choices
                  </Button>
                </div>
                <label htmlFor="theme-design-prompt" className="sr-only">
                  Describe your theme or answer the designer
                </label>
                <textarea
                  id="theme-design-prompt"
                  maxLength={4000}
                  rows={3}
                  value={designInput}
                  onChange={(event) => setDesignInput(event.target.value)}
                  disabled={
                    !draft.loaded ||
                    busy ||
                    designBusy ||
                    designOptionsBusy ||
                    importedReviewOpen ||
                    !designModel
                  }
                  placeholder="Make a Mezair theme inspired by…"
                  className="w-full resize-y rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={
                      !draft.loaded ||
                      busy ||
                      designBusy ||
                      designOptionsBusy ||
                      importedReviewOpen ||
                      !designModel ||
                      !designInput.trim()
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
                      !draft.loaded ||
                      busy ||
                      designBusy ||
                      designOptionsBusy ||
                      importedReviewOpen ||
                      !designModel ||
                      !designInput.trim()
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
                      Designing with {selectedProviderOption.label} ·{' '}
                      {selectedProviderOption.models.find((model) => model.id === designModel)
                        ?.label ?? designModel}
                      …
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
                  disabled={
                    busy ||
                    designBusy ||
                    designOptionsBusy ||
                    !retryRequest ||
                    !designProvider ||
                    !designModel
                  }
                  onClick={retryWithCurrentSelection}
                >
                  Retry with selected options
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
        ) : (
          <section className="space-y-3 border-t border-border-subtle pt-5">
            <div>
              <h4 className="text-sm font-semibold text-text-primary">Design with AI</h4>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Choose from available connected providers and models for this theme request.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || importBusy || designBusy || importedReviewOpen}
              onClick={() => setDesignerOpen(true)}
            >
              <Sparkles size={14} aria-hidden="true" />
              {initialIntent === 'edit' ? 'Refine with AI' : 'Open theme designer'}
            </Button>
          </section>
        )}
      </div>
    </SettingsPanel>
  );
}
