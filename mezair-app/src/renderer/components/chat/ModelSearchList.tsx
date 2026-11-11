import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { AgentProvider } from '../../../shared/types';
import type { ChatModelOption } from '../../utils/chat-model-options';
import {
  filterModelOptions,
  MODEL_PROVIDER_LABELS,
  modelSelectionKey,
} from '../../utils/model-picker';

type AgentTab = AgentProvider | 'all';

const agentName = (provider: AgentProvider) => MODEL_PROVIDER_LABELS[provider].replace(' CLI', '');

/**
 * Model search with an agent rail: pick an agent on the left, then one of its models.
 * Typing searches every agent, so the rail is a shortcut rather than a filter you must clear.
 */
export function ModelSearchList({
  options,
  provider,
  model,
  onSelect,
}: {
  options: ChatModelOption[];
  provider: AgentProvider;
  model: string;
  onSelect: (option: ChatModelOption) => void;
}) {
  const id = useId();
  const agents = [...new Set(options.map((option) => option.provider))];
  const showRail = agents.length > 1;
  const [tab, setTab] = useState<AgentTab>(() =>
    showRail && agents.includes(provider) ? provider : 'all',
  );
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const view: AgentTab = query ? 'all' : tab;
  const visible =
    view === 'all'
      ? filterModelOptions(options, query)
      : options.filter((option) => option.provider === view);
  const groups = new Map<AgentProvider, ChatModelOption[]>();
  for (const option of visible) {
    const group = groups.get(option.provider) ?? [];
    group.push(option);
    groups.set(option.provider, group);
  }
  const ordered = [...groups.values()].flat();
  const indices = new Map(ordered.map((option, index) => [option, index]));
  const selectedIndex = ordered.findIndex(
    (option) => option.provider === provider && option.id === model,
  );
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const active = Math.min(activeIndex, ordered.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const row = listRef.current?.querySelector('[data-active="true"]');
    // Keep a group's heading visible with its first model, so the list never opens mid-heading.
    const heading = row?.previousElementSibling;
    if (heading && heading.getAttribute('role') !== 'option') {
      heading.scrollIntoView({ block: 'nearest' });
    }
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, view]);

  const tabs: AgentTab[] = ['all', ...agents];
  const chooseTab = (next: AgentTab) => {
    setTab(next);
    setQuery('');
    const rows = next === 'all' ? options : options.filter((option) => option.provider === next);
    setActiveIndex(
      Math.max(
        0,
        rows.findIndex((option) => option.provider === provider && option.id === model),
      ),
    );
  };
  const focusTab = (next: AgentTab) => {
    railRef.current?.querySelector<HTMLButtonElement>(`[data-agent-tab="${next}"]`)?.focus();
  };
  const onRailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(view);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = tabs[(index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length];
      chooseTab(next);
      focusTab(next);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      {showRail && (
        <div
          ref={railRef}
          role="tablist"
          aria-label="Agents"
          aria-orientation="vertical"
          onKeyDown={onRailKeyDown}
          className="flex w-28 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-subtle bg-text-primary/[0.025] p-1.5"
        >
          {tabs.map((agent) => {
            const current = view === agent;
            return (
              <button
                key={agent}
                type="button"
                role="tab"
                data-agent-tab={agent}
                aria-selected={current}
                aria-controls={`${id}-list`}
                tabIndex={current ? 0 : -1}
                onClick={() => {
                  chooseTab(agent);
                  inputRef.current?.focus();
                }}
                className={`relative flex h-8 shrink-0 items-center truncate rounded-md pl-3 pr-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                  current
                    ? 'bg-bg-hover font-medium text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
                }`}
              >
                {current && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0.5 w-0.5 rounded-full bg-accent"
                  />
                )}
                {agent === 'all' ? 'All' : agentName(agent)}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
          <Search size={14} className="shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Search models and providers"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex(
                  ordered.length
                    ? (active + (event.key === 'ArrowDown' ? 1 : -1) + ordered.length) %
                        ordered.length
                    : 0,
                );
              } else if (event.key === 'Enter' && ordered[active]) {
                event.preventDefault();
                onSelect(ordered[active]);
              } else if (event.key === 'ArrowLeft' && showRail && !query) {
                event.preventDefault();
                focusTab(view);
              }
            }}
            placeholder="Search models…"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear model search"
              onClick={() => {
                setQuery('');
                setActiveIndex(Math.max(0, selectedIndex));
                inputRef.current?.focus();
              }}
              className="rounded p-1 text-text-secondary hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label="Models"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
        >
          {[...groups].map(([groupProvider, models]) => (
            <div key={groupProvider} role="group" aria-labelledby={`${id}-${groupProvider}`}>
              <div
                id={`${id}-${groupProvider}`}
                className={
                  view === 'all'
                    ? 'px-2.5 pb-0.5 pt-2.5 text-xs font-medium text-text-tertiary'
                    : 'sr-only'
                }
              >
                {MODEL_PROVIDER_LABELS[groupProvider]}
              </div>
              {models.map((option) => {
                const index = indices.get(option)!;
                const selected = option.provider === provider && option.id === model;
                return (
                  <button
                    key={modelSelectionKey(option.provider, option.id)}
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    data-active={index === active}
                    title={option.description || option.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => onSelect(option)}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left ${index === active ? 'bg-bg-hover' : ''}`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${selected ? 'font-medium text-accent' : 'text-text-primary'}`}
                    >
                      {option.label}
                    </span>
                    {selected && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          ))}
          {ordered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-secondary" role="status">
              {options.length
                ? 'No matching models. Try a model or agent name.'
                : 'No models available. Enable a provider in AI connections.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
