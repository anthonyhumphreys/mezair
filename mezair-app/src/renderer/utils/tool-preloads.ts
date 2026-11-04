import { preloadable } from './preloadable';

export const terminalImport = preloadable(() => import('../components/terminal/TerminalPanel'));
export const paletteImport = preloadable(() => import('../components/layout/CommandPalette'));
