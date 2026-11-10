import { useEffect, useState, type ReactNode } from 'react';

/**
 * One item that needs the user before (or while) they type. Items are passed
 * most-urgent first; the slot shows one at a time so a decision never competes
 * with notices for the same space.
 */
export interface ChatAttentionItem {
  id: string;
  /** Short name for the "also waiting" switcher, e.g. "Approval: npm test". */
  label: string;
  node: ReactNode;
}

/** Shared frame width for everything stacked above the composer. */
export const COMPOSER_ALIGNED = 'mx-auto w-full max-w-[1040px] px-3 xl:px-5' as const;

/**
 * The single attention area above the composer. Shows the most urgent item;
 * any others are listed in one quiet row and can be brought forward.
 */
export function ChatAttentionSlot({
  items,
  status,
}: {
  items: ChatAttentionItem[];
  /** Low-priority, always-visible state (plan progress, queue depth, side question). */
  status?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  if (!selected && !status) return null;
  const others = items.filter((item) => item !== selected);

  return (
    <div className={`${COMPOSER_ALIGNED} space-y-1.5`} data-testid="chat-attention-slot">
      {selected && (
        <section aria-label="Needs your attention" className="min-w-0">
          {selected.node}
        </section>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-text-secondary">
          <span>Also waiting:</span>
          {others.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className="max-w-64 truncate rounded-md px-1.5 py-0.5 font-medium text-text-primary underline decoration-border underline-offset-2 hover:bg-bg-tertiary hover:decoration-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {status && <div className="flex flex-wrap items-center gap-2 pb-0.5">{status}</div>}
    </div>
  );
}
