/** `auto` omits the model override, preserving the user's Claude Code settings. */
export const CLAUDE_MODEL_OPTIONS = [
  { id: 'auto', label: 'Use CLI default' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
] as const;

export function resolveClaudeModel(model: string | undefined): string | undefined {
  const value = model?.trim();
  // A newly enabled provider must never inherit a GPT deployment from Settings.
  if (!value || value === 'auto' || /^(gpt-|codex(?:-|$)|o[1-9](?:-|$))/.test(value))
    return undefined;
  return value;
}
