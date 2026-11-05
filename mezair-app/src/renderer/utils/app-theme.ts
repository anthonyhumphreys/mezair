import type { AppTheme } from '../../shared/types.js';
import {
  getThemeAppearance,
  getThemeColors,
  THEME_COLOR_TOKENS,
  type CustomTheme,
  type ThemeColors,
  normalizeCustomThemesForRenderer,
} from '../../shared/theme-palette.js';

export interface AppThemeApplication {
  requestedTheme: AppTheme;
  effectiveTheme: AppTheme;
  missingCustomTheme?: string;
  appearance: 'light' | 'dark';
  colors: ThemeColors;
}

/** Applies a complete, validated palette and removes properties owned by the previous theme. */
export function applyAppTheme(
  requestedTheme: AppTheme,
  customThemes: readonly CustomTheme[] = [],
  root: HTMLElement = document.documentElement,
): AppThemeApplication {
  const safeCustomThemes = normalizeCustomThemesForRenderer(customThemes);
  let effectiveTheme = requestedTheme;
  let missingCustomTheme: string | undefined;
  let selectedCustomTheme: CustomTheme | undefined;

  if (requestedTheme.startsWith('custom:')) {
    const id = requestedTheme.slice('custom:'.length);
    selectedCustomTheme = safeCustomThemes.find((candidate) => candidate.id === id);
    if (!selectedCustomTheme) {
      missingCustomTheme = id;
      effectiveTheme = 'dark';
    }
  }

  const colors = selectedCustomTheme?.colors ?? getThemeColors(effectiveTheme);
  const appearance = selectedCustomTheme?.appearance ?? getThemeAppearance(effectiveTheme);

  for (const token of THEME_COLOR_TOKENS) {
    const property = token === 'overlay-ring' ? '--overlay-ring' : `--color-${token}`;
    root.style.removeProperty(property);
  }
  for (const token of THEME_COLOR_TOKENS) {
    const property = token === 'overlay-ring' ? '--overlay-ring' : `--color-${token}`;
    root.style.setProperty(property, colors[token]);
  }

  root.dataset.theme = effectiveTheme;
  root.style.colorScheme = appearance;

  const application: AppThemeApplication = {
    requestedTheme,
    effectiveTheme,
    ...(missingCustomTheme === undefined ? {} : { missingCustomTheme }),
    appearance,
    colors,
  };
  root.ownerDocument.defaultView?.dispatchEvent(
    new CustomEvent('mezair:theme-applied', {
      detail: { theme: effectiveTheme, colors, appearance },
    }),
  );
  return application;
}
