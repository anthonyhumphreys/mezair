import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { ComposedChatTurn } from './chat-turns';
import { getChatTurnRequestTargets } from './chat-run-outcome';
import { readChatScrollPosition, getSessionStorage } from './chat-scroll-position';
import {
  REVEAL_TRANSCRIPT_EVENT,
  type RevealTranscriptRequest,
} from '../../utils/reveal-transcript';
import { createTranscriptViewState, TranscriptViewState } from './TranscriptViewState';
import { createChatTurnSearch } from './chat-transcript-search';

const estimateSize = () => 520;
const WINDOW_THRESHOLD = 80;

export function VirtualChatTurns({
  turns,
  scopeKey,
  containerRef,
  pendingTurnKey,
  renderTurn,
}: {
  turns: ComposedChatTurn[];
  scopeKey: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  pendingTurnKey?: string;
  renderTurn: (turn: ComposedChatTurn, index: number, searchActive: boolean) => ReactNode;
}) {
  const [viewState] = useState(createTranscriptViewState);
  const [initialPosition] = useState(() => readChatScrollPosition(getSessionStorage(), scopeKey));
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(24);
  const [selectionPins, setSelectionPins] = useState<number[]>([]);
  const [focusPin, setFocusPin] = useState(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const deferredQuery = useDeferredValue(query.trim());
  // Closing search releases indexed text instead of retaining it for the thread's lifetime.
  const searchTurns = useMemo(createChatTurnSearch, [searchOpen]);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastRange = useRef<number[]>([]);
  const scheduled = useRef(new Set<number>());
  const schedule = useCallback((action: () => void) => {
    const id = requestAnimationFrame(() => {
      scheduled.current.delete(id);
      action();
    });
    scheduled.current.add(id);
  }, []);
  useEffect(
    () => () => {
      scheduled.current.forEach(cancelAnimationFrame);
      scheduled.current.clear();
    },
    [],
  );
  const enabled = turns.length > WINDOW_THRESHOLD;
  const signature = turns.map((turn) => turn.key).join('\0');
  const getItemKey = useMemo(() => {
    const keys = turns.map((turn) => `${scopeKey ?? 'new'}:${turn.key}`);
    return (index: number) => keys[index];
  }, [signature, scopeKey]);
  const pendingIndex = turns.findIndex((turn) => turn.key === pendingTurnKey);
  const savedIndex =
    initialPosition?.mode === 'offset'
      ? turns.findIndex((turn) => turn.key === initialPosition.anchor?.turnKey)
      : -1;
  const rangeExtractor = useCallback(
    (range: Range) =>
      [
        ...new Set(
          [
            ...defaultRangeExtractor(range),
            ...selectionPins,
            focusPin,
            pendingIndex,
            savedIndex,
            turns.length - 1,
          ].filter((index) => index >= 0 && index < turns.length),
        ),
      ].sort((a, b) => a - b),
    [selectionPins, focusPin, pendingIndex, savedIndex, turns.length],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: turns.length,
    // Child layout effects run before the ancestor container ref is attached.
    // The list ref already has a DOM ancestor on that first commit.
    getScrollElement: () =>
      containerRef.current ??
      listRef.current?.closest<HTMLDivElement>('[data-chat-scroll-container]') ??
      null,
    estimateSize,
    getItemKey,
    overscan: 4,
    rangeExtractor,
    gap: 24,
    scrollMargin: margin,
    anchorTo: 'end',
    followOnAppend: false,
    scrollEndThreshold: 96,
    initialOffset: () =>
      initialPosition?.mode === 'offset'
        ? initialPosition.scrollTop
        : Math.max(0, turns.length * 544 - 800),
    enabled,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualItems = virtualizer.getVirtualItems();
  lastRange.current = virtualItems.map((item) => item.index);

  useLayoutEffect(() => {
    const list = listRef.current,
      container =
        containerRef.current ??
        listRef.current?.closest<HTMLDivElement>('[data-chat-scroll-container]');
    if (!list || !container) return;
    setMargin(
      list.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop,
    );
  }, [containerRef, searchOpen, enabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const jump = (event: Event) => {
      const detail = (event as CustomEvent<{ behavior: ScrollBehavior; handled: boolean }>).detail;
      detail.handled = true;
      virtualizer.scrollToEnd({ behavior: 'auto' });
    };
    container.addEventListener('mezair:transcript-end', jump);
    return () => container.removeEventListener('mezair:transcript-end', jump);
  }, [containerRef, enabled, virtualizer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selectionChanged = () => {
      const selection = document.getSelection();
      const selected =
        selection &&
        !selection.isCollapsed &&
        (container.contains(selection.anchorNode) || container.contains(selection.focusNode));
      setSelectionPins((previous) =>
        selected
          ? [...new Set([...previous, ...lastRange.current])]
          : previous.length
            ? []
            : previous,
      );
    };
    const focusChanged = () => {
      const element = document.activeElement?.closest<HTMLElement>('[data-chat-turn-key]');
      setFocusPin(
        element && container.contains(element)
          ? turns.findIndex((turn) => turn.key === element.dataset.chatTurnKey)
          : -1,
      );
    };
    document.addEventListener('selectionchange', selectionChanged);
    document.addEventListener('focusin', focusChanged);
    return () => {
      document.removeEventListener('selectionchange', selectionChanged);
      document.removeEventListener('focusin', focusChanged);
    };
  }, [containerRef, signature]);

  const reveal = useCallback(
    (index: number, after?: () => void) => {
      if (enabled) virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' });
      else
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-chat-turn-key="${CSS.escape(turns[index].key)}"]`)
          ?.scrollIntoView({ block: 'center' });
      schedule(() => schedule(() => after?.()));
    },
    [enabled, virtualizer, turns, containerRef, schedule],
  );
  useEffect(() => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<RevealTranscriptRequest>).detail;
      const index = turns.findIndex(
        (turn) =>
          turn.key === request.turnKey ||
          (request.surfaceId &&
            turn.surfaces.some((surface) => surface.intent.id === request.surfaceId)) ||
          (request.requestId &&
            getChatTurnRequestTargets(turn).some((target) => target.id === request.requestId)),
      );
      if (index >= 0) reveal(index, request.after);
    };
    window.addEventListener(REVEAL_TRANSCRIPT_EVENT, listener);
    return () => window.removeEventListener(REVEAL_TRANSCRIPT_EVENT, listener);
  }, [turns, reveal]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'f'
      )
        return;
      event.preventDefault();
      setSearchOpen(true);
      schedule(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [schedule]);
  const matches = useMemo(
    () => (searchOpen ? searchTurns(turns, deferredQuery) : []),
    [turns, deferredQuery, searchOpen, searchTurns],
  );
  const activeMatchIndex = Math.min(matchIndex, Math.max(0, matches.length - 1));
  const activeMatch = matches[activeMatchIndex];
  useEffect(() => {
    setMatchIndex(0);
    if (matches.length) reveal(matches[0].index);
    // A stream update must not steal the reading position; only a new search does.
  }, [deferredQuery, searchOpen]);
  const moveMatch = (direction: number) => {
    if (!matches.length) return;
    const next = (activeMatchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    reveal(matches[next].index);
  };
  const row = (turn: ComposedChatTurn, index: number) => (
    <TranscriptViewState key={turn.key} store={viewState} path={turn.key}>
      {renderTurn(turn, index, searchOpen && activeMatch?.index === index)}
    </TranscriptViewState>
  );
  return (
    <>
      {searchOpen && (
        <div
          role="search"
          className="sticky top-0 z-20 mb-4 rounded-lg border border-border bg-bg-elevated p-2 text-xs"
        >
          <div className="flex min-w-0 items-center gap-2">
            <input
              ref={searchRef}
              aria-label="Find in loaded conversation"
              maxLength={512}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setMatchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  moveMatch(event.shiftKey ? -1 : 1);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSearchOpen(false);
                  setQuery('');
                  containerRef.current?.focus();
                }
              }}
              className="min-w-0 flex-1 rounded bg-bg-primary px-2 py-1 text-text-primary"
              placeholder="Find in loaded conversation…"
            />
            <span
              role="status"
              className="whitespace-nowrap text-text-secondary"
              aria-label={
                matches.length
                  ? `${activeMatchIndex + 1} of ${matches.length} matching turns`
                  : 'No matching turns'
              }
            >
              {matches.length ? `${activeMatchIndex + 1}/${matches.length} turns` : '0 turns'}
            </span>
            <button
              type="button"
              aria-label="Previous match"
              disabled={!matches.length}
              onClick={() => moveMatch(-1)}
              title="Previous matching turn (Shift+Enter)"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              <ChevronUp size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next match"
              disabled={!matches.length}
              onClick={() => moveMatch(1)}
              title="Next matching turn (Enter)"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Close conversation search"
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
                containerRef.current?.focus();
              }}
              title="Close conversation search (Esc)"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <p
            className="mt-1 flex min-h-4 min-w-0 items-baseline gap-0.5 overflow-hidden whitespace-nowrap px-1 text-text-secondary"
            data-chat-search-preview
          >
            {activeMatch ? (
              <>
                <span className="shrink-0 text-text-muted">Turn {activeMatch.index + 1} · </span>
                <span className="min-w-0 max-w-[30%] truncate">{activeMatch.before}</span>
                <mark className="min-w-0 max-w-[50%] shrink-0 truncate rounded-sm bg-accent/20 text-text-primary">
                  {activeMatch.text}
                </mark>
                <span className="min-w-0 flex-1 truncate">{activeMatch.after}</span>
              </>
            ) : (
              <span className="min-w-0 truncate">
                {deferredQuery
                  ? 'No matching turns in loaded history.'
                  : 'Search loaded messages, questions, and work.'}
              </span>
            )}
          </p>
        </div>
      )}
      <div
        ref={listRef}
        data-chat-turn-window
        className={enabled ? 'relative w-full' : 'w-full space-y-6'}
        style={enabled ? { height: virtualizer.getTotalSize(), overflowAnchor: 'none' } : undefined}
      >
        {enabled
          ? virtualItems.map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start - margin}px)`,
                }}
              >
                {row(turns[item.index], item.index)}
              </div>
            ))
          : turns.map(row)}
      </div>
    </>
  );
}
