import { useEffect, useId, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { AgentProvider } from '../../../shared/types';
import type { ChatModelOption } from '../../utils/chat-model-options';
import {
  filterModelOptions,
  MODEL_PROVIDER_LABELS,
  modelSelectionKey,
} from '../../utils/model-picker';

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
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.provider === provider && option.id === model),
    ),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = filterModelOptions(options, query);
  const groups = new Map<AgentProvider, ChatModelOption[]>();
  for (const option of filtered) {
    const group = groups.get(option.provider) ?? [];
    group.push(option);
    groups.set(option.provider, group);
  }
  const ordered = [...groups.values()].flat();
  const indices = new Map(ordered.map((option, index) => [option, index]));
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
  }, [active, query]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
        <Search size={15} className="shrink-0 text-text-secondary" />
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
            }
          }}
          placeholder="Search models or providers…"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear model search"
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
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
        className="min-h-0 max-h-80 overflow-y-auto overscroll-contain p-1.5"
      >
        {[...groups].map(([groupProvider, models]) => (
          <div key={groupProvider} role="group" aria-labelledby={`${id}-${groupProvider}`}>
            <div
              id={`${id}-${groupProvider}`}
              className="px-2.5 pb-0.5 pt-2.5 text-xs font-medium text-text-tertiary"
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
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => onSelect(option)}
                  title={option.description || option.id}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left ${index === active ? 'bg-bg-hover' : ''}`}
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${selected ? 'font-medium text-accent' : 'text-text-primary'}`}
                  >
                    {option.label}
                  </span>
                  {selected && <Check size={15} className="shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        ))}
        {ordered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-text-secondary" role="status">
            {options.length
              ? 'No matching models. Try a model or provider name.'
              : 'No models available. Enable a provider in AI connections.'}
          </div>
        )}
      </div>
    </div>
  );
}
