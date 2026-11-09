import { ArrowUp, Check, ChevronDown, Loader2, Square, type LucideIcon } from 'lucide-react';
import { Menu, MenuItem, MenuLabel, cx } from '../ui';

export interface ComposerSendOption<Id extends string = string> {
  id: Id;
  /** Menu label, e.g. "Queue next". */
  label: string;
  /** Primary button label, e.g. "Queue". */
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  disabled: boolean;
  pending: boolean;
  /** Accessible name for the primary button when this option is selected. */
  ariaLabel: string;
  run: () => void;
}

/**
 * One primary send action plus, when there are alternatives, a menu of the
 * other ways to send. Choosing a mode never submits the draft.
 */
export function ComposerSendControl<Id extends string>({
  options,
  selectedId,
  onSelect,
  menuLabel,
}: {
  options: ComposerSendOption<Id>[];
  selectedId: Id;
  onSelect: (id: Id) => void;
  menuLabel: string;
}) {
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  if (!selected) return null;
  const Icon = selected.icon;
  const pending = options.some((option) => option.pending);
  const iconOnlySend = selected.id === 'send';
  const hasMenu = options.length > 1;
  // The primary and its mode menu share one shape and one fill so they read as a
  // single split control. Idle-without-draft uses a quiet neutral fill rather than
  // dropping the fill entirely, so the button never changes size or shape.
  const ready = !selected.disabled;
  const fill = ready
    ? 'bg-accent text-accent-foreground'
    : 'bg-text-primary/[0.08] text-text-tertiary';

  return (
    <div
      className={cx(
        'composer-send-control flex h-8 shrink-0 items-stretch rounded-full transition-[background-color,color] duration-150',
        fill,
      )}
    >
      <button
        type="button"
        onClick={selected.run}
        disabled={selected.disabled}
        className={cx(
          'composer-send flex items-center justify-center gap-1.5 rounded-full text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-tertiary disabled:cursor-not-allowed',
          iconOnlySend ? 'w-8' : 'pl-2.5 pr-3',
          hasMenu && 'rounded-r-none',
        )}
        aria-label={selected.pending ? `${selected.label}: sending` : selected.ariaLabel}
        aria-busy={selected.pending}
        title={selected.description}
      >
        {selected.pending ? (
          <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
        ) : iconOnlySend ? (
          <ArrowUp size={17} strokeWidth={2.25} />
        ) : (
          <Icon size={13} />
        )}
        {!iconOnlySend && (selected.pending ? 'Sending…' : selected.shortLabel)}
      </button>
      {hasMenu && (
        <Menu
          label={menuLabel}
          side="top"
          align="end"
          menuClassName="w-72"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              disabled={pending}
              className={cx(
                'flex w-6 items-center justify-center rounded-r-full border-l pr-0.5 transition-[background-color] duration-150 hover:bg-text-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 disabled:opacity-50',
                ready ? 'border-accent-foreground/20' : 'border-text-primary/10',
              )}
              aria-label={menuLabel}
              title={menuLabel}
            >
              <ChevronDown size={13} strokeWidth={2.25} />
            </button>
          )}
        >
          <MenuLabel>Choose how to send</MenuLabel>
          {options.map((option) => {
            const OptionIcon = option.icon;
            const active = option.id === selected.id;
            return (
              <MenuItem
                key={option.id}
                disabled={pending}
                onSelect={() => onSelect(option.id)}
                className="items-start"
                icon={<OptionIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block font-medium text-text-primary">{option.label}</span>
                  <span className="block text-xs leading-snug text-text-tertiary">
                    {option.description}
                  </span>
                </span>
                <Check
                  size={13}
                  aria-hidden="true"
                  className={cx(
                    'mt-0.5 shrink-0 text-accent',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {active && <span className="sr-only">(default)</span>}
              </MenuItem>
            );
          })}
        </Menu>
      )}
    </div>
  );
}

/** Stops the current run. Clear and reachable, without shouting over the draft. */
export function ComposerStopButton({ onStop }: { onStop?: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      disabled={!onStop}
      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 disabled:cursor-not-allowed disabled:opacity-50"
      title="Stop the current run"
      aria-label="Stop current run"
    >
      <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      <span className="sr-only">Stop</span>
    </button>
  );
}
