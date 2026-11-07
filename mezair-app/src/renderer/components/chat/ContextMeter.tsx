/** How full the model's context window was after the latest turn. */
export interface ChatContextUsage {
  used: number;
  size: number;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

export function contextFill(usage: ChatContextUsage): number {
  if (!(usage.size > 0) || !(usage.used >= 0)) return 0;
  return Math.min(1, usage.used / usage.size);
}

/**
 * Compact context-window meter for the composer footer. It reports the figure
 * the provider gave for the last turn; it never estimates the next one.
 */
export function ContextMeter({ usage }: { usage: ChatContextUsage }) {
  const fill = contextFill(usage);
  const percent = Math.round(fill * 100);
  const tone = fill >= 0.9 ? 'bg-error' : fill >= 0.7 ? 'bg-warning' : 'bg-text-tertiary';
  const text = fill >= 0.9 ? 'text-error' : fill >= 0.7 ? 'text-warning' : 'text-text-tertiary';
  const description = `Context window ${percent}% full after the last turn: ${formatTokens(usage.used)} of ${formatTokens(usage.size)} tokens.${
    fill >= 0.7
      ? ' Earlier detail may be compacted soon. Fork or start a new thread to keep the agent focused.'
      : ''
  }`;
  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className="inline-flex items-center gap-1.5 px-1 text-xs"
      data-testid="context-meter"
    >
      <span className="relative h-1 w-6 overflow-hidden rounded-full bg-border" aria-hidden="true">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${tone}`}
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </span>
      <span className={`tabular-nums ${text}`} aria-hidden="true">
        {percent}%
      </span>
    </span>
  );
}
