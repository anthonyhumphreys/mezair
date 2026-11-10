import { useDelegationState } from './DelegationViewState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, GitFork, Loader2, Square } from 'lucide-react';
import type {
  ChatDelegationAction,
  ChatDelegationIntegration,
  ChatDelegationIntegrationPlan,
  ChatDelegationRun,
  ChatDelegationVerificationSelection,
} from '../../../shared/chat-delegation';
import { sharedPollingCache } from '../../utils/shared-polling-cache';
import { MarkdownRenderer } from './MarkdownRenderer';
import { agentProviderLabel } from '../../utils/agent-display';

const STATUS: Record<string, string> = {
  queued: 'Queued',
  running: 'Working',
  paused: 'Needs attention',
  completed: 'Finished',
  failed: 'Could not finish',
  cancelled: 'Stopped',
  waiting: 'Waiting',
  interrupted: 'Interrupted',
  skipped: 'Not started',
};
const actionClass =
  'rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

export function integrationApplicationHeadline(
  appliedRepositoryCount: number,
  repositoryCount: number,
): string {
  if (repositoryCount > 0 && appliedRepositoryCount >= repositoryCount)
    return 'Verified changes have been applied to each source repository.';
  if (appliedRepositoryCount > 0)
    return `Changes have been applied in ${appliedRepositoryCount} of ${repositoryCount} repositories. Apply each remaining repository separately.`;
  return 'The combined result is in a retained integration checkout. It has not been applied to your repository.';
}

/** Live delegated runs for a thread (polled, shared across subscribers). */
export function useThreadDelegations(threadId: string | null) {
  const [snapshot, setSnapshot] = useState<{
    threadId: string;
    runs: ChatDelegationRun[];
    error: boolean;
  }>({ threadId: '', runs: [], error: false });
  const key = `chat-delegations:${threadId ?? ''}`;
  const subscription = useRef(0);
  useEffect(() => {
    if (!threadId) {
      subscription.current++;
      setSnapshot({ threadId: '', runs: [], error: false });
      return;
    }
    const generation = ++subscription.current;
    const unsubscribe = sharedPollingCache.subscribe(
      key,
      () => window.mezair.chat.listDelegations(threadId),
      (value) => {
        if (subscription.current !== generation) return;
        setSnapshot(() => {
          const runs = value.value ?? EMPTY_RUNS;
          return {
            threadId,
            runs,
            error: Boolean(value.error),
          };
        });
      },
      { pollIntervalMs: 3000, maxAgeMs: 2000, maxStaleMs: 15000 },
    );
    return () => {
      if (subscription.current === generation) subscription.current += 1;
      unsubscribe();
    };
  }, [key, threadId]);
  const current = Boolean(threadId) && snapshot.threadId === threadId;
  const refresh = useCallback(() => sharedPollingCache.refresh(key), [key]);
  return {
    runs: current ? snapshot.runs : EMPTY_RUNS,
    error: current && snapshot.error,
    refresh,
  };
}

const EMPTY_RUNS: ChatDelegationRun[] = [];

/**
 * Assigns each run to the turn whose time window contains its start, so
 * delegated agents appear inside the turn that launched them. Runs older than
 * the first loaded turn are returned under `unplaced`.
 */
export function placeDelegationsInTurns(
  runs: ChatDelegationRun[],
  turns: Array<{ key: string; startedAt?: string }>,
): { byTurn: Map<string, ChatDelegationRun[]>; unplaced: ChatDelegationRun[] } {
  const byTurn = new Map<string, ChatDelegationRun[]>();
  const unplaced: ChatDelegationRun[] = [];
  const starts = turns.map((turn) => ({
    key: turn.key,
    at: turn.startedAt ? Date.parse(turn.startedAt) : NaN,
  }));
  for (const run of runs) {
    const created = Date.parse(run.createdAt);
    let owner: string | null = null;
    for (const turn of starts) {
      if (Number.isNaN(turn.at)) owner = null;
      else if (turn.at <= created) owner = turn.key;
      else break;
    }
    if (!owner || Number.isNaN(created)) {
      unplaced.push(run);
      continue;
    }
    const list = byTurn.get(owner) ?? [];
    list.push(run);
    byTurn.set(owner, list);
  }
  return { byTurn, unplaced };
}

/** Delegated runs rendered inside a turn (or at the end for unplaced runs). */
export function ChatDelegationList({
  threadId,
  runs,
  error = false,
  onRefresh,
  label = 'Delegated work',
}: {
  threadId: string;
  runs: ChatDelegationRun[];
  error?: boolean;
  onRefresh: () => Promise<void>;
  label?: string;
}) {
  const [showOlder, setShowOlder] = useState(false);
  if (!runs.length && !error) return null;
  return (
    <section aria-label={label} className="w-full rounded-xl border border-border-subtle px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-text-secondary">
        <GitFork size={14} aria-hidden="true" /> {label}
        <span className="font-normal tabular-nums text-text-tertiary">{runs.length}</span>
      </div>
      {error && (
        <p className="mb-2 text-xs text-warning" role="status">
          Could not refresh delegated work. Showing the last available status.{' '}
          <button type="button" className={actionClass} onClick={() => void onRefresh()}>
            Retry
          </button>
        </p>
      )}
      <div className="divide-y divide-border-subtle">
        {runs
          .filter(
            (run, index) =>
              showOlder ||
              index < 3 ||
              ['running', 'queued', 'paused'].includes(run.status) ||
              run.cancellationPending,
          )
          .map((run) => (
            <DelegationRun
              key={`${threadId}:${run.id}`}
              run={run}
              threadId={threadId}
              onRefresh={onRefresh}
            />
          ))}
      </div>
      {runs.length > 3 && (
        <button type="button" className={actionClass} onClick={() => setShowOlder(!showOlder)}>
          {showOlder ? 'Show recent work' : 'Show earlier work'}
        </button>
      )}
    </section>
  );
}

/** Thread-level list (all runs), kept for surfaces without a turn transcript. */
export function ChatDelegations({ threadId }: { threadId: string }) {
  const { runs, error, refresh } = useThreadDelegations(threadId);
  return <ChatDelegationList threadId={threadId} runs={runs} error={error} onRefresh={refresh} />;
}

function DelegationRun({
  run,
  threadId,
  onRefresh,
}: {
  run: ChatDelegationRun;
  threadId: string;
  onRefresh: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ChatDelegationRun | null>(null);
  const [open, setOpen] = useDelegationState(`${threadId}:${run.id}`, 'open', false);
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = `${threadId}:${run.id}`;
  const identityRef = useRef(identity);
  const mounted = useRef(true);
  const request = useRef(0);
  identityRef.current = identity;
  const isCurrent = useCallback(
    () => mounted.current && identityRef.current === identity,
    [identity],
  );
  const active = run.status === 'running' || run.status === 'queued' || run.status === 'paused';
  const pending = run.cancellationPending || stopping;
  const status = pending ? 'Stop requested' : STATUS[run.status];
  const version = JSON.stringify(run.tasks.map((task) => [task.id, task.status, task.error]));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    const id = ++request.current;
    setLoading(true);
    void window.mezair.chat
      .readDelegation(threadId, run.id)
      .then(
        (value) => {
          if (current && isCurrent() && id === request.current) {
            setDetail(value);
            setError(null);
          }
        },
        () => {
          if (current && isCurrent())
            setError('Could not load the task reports. Close and reopen to retry.');
        },
      )
      .finally(() => {
        if (current && isCurrent()) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, threadId, run.id, version, isCurrent]);

  const stop = async () => {
    setStopping(true);
    setError(null);
    try {
      await window.mezair.chat.stopDelegation(threadId, run.id);
      if (!isCurrent()) return;
      await onRefresh();
    } catch {
      if (isCurrent())
        setError('Could not confirm the stop request. Retry or inspect the execution details.');
    } finally {
      if (isCurrent()) setStopping(false);
    }
  };

  const act = async (action: ChatDelegationAction, taskId?: string) => {
    setActing(true);
    setError(null);
    try {
      const value = await window.mezair.chat.actOnDelegation(threadId, run.id, action, taskId);
      if (!isCurrent()) return;
      setDetail(value);
      await onRefresh();
    } catch (cause) {
      if (isCurrent())
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not complete this action. Retry or inspect the execution details.',
        );
    } finally {
      if (isCurrent()) setActing(false);
    }
  };

  const updateDetail = (value: ChatDelegationRun) => {
    if (isCurrent()) setDetail(value);
  };

  return (
    <div className="py-3">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`delegation-${run.id}`}
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="block break-words text-sm font-medium text-text-primary">
            {run.title}
          </span>
          <span
            className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary"
            role="status"
          >
            {pending || run.status === 'running' || run.status === 'queued' ? (
              <Loader2
                size={12}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : run.status === 'completed' ? (
              <Check size={12} className="text-success" aria-hidden="true" />
            ) : run.status === 'paused' || run.status === 'failed' ? (
              <AlertCircle size={12} className="text-warning" aria-hidden="true" />
            ) : null}
            {status} · {run.tasks.filter((task) => task.status === 'completed').length}/
            {run.tasks.length} tasks
            <span className="ml-1 text-text-tertiary">
              {open ? 'Hide details' : 'Show details'}
            </span>
          </span>
        </button>
        {(active || pending) && (
          <button
            type="button"
            disabled={stopping}
            onClick={() => void stop()}
            className={actionClass}
            aria-label={`${pending ? 'Retry stop for' : 'Stop'} ${run.title}`}
          >
            <span className="inline-flex items-center gap-1">
              <Square size={11} aria-hidden="true" /> {pending ? 'Retry stop' : 'Stop'}
            </span>
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-warning">
          {error}
        </p>
      )}
      {open && (
        <div id={`delegation-${run.id}`} className="mt-3 space-y-3">
          <p className="max-w-[72ch] text-xs leading-5 text-text-secondary">{run.reason}</p>
          {(detail?.tasks ?? run.tasks).map((task) => (
            <div key={task.id} className="border-t border-border-subtle pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-1 text-xs">
                <span className="max-w-full break-words font-medium text-text-primary">
                  {task.name}
                </span>
                <span className="text-text-tertiary">
                  {pending && task.status === 'cancelled' ? 'Stop requested' : STATUS[task.status]}
                </span>
              </div>
              <p className="mt-1 break-words text-xs text-text-tertiary">
                {task.destination} · {agentProviderLabel(task.provider)} · {task.model} ·{' '}
                {task.mode === 'read-only' ? 'Read only' : 'Chat access'}
              </p>
              {task.error && (
                <p className="mt-2 whitespace-pre-wrap break-words text-xs text-warning">
                  {task.error}
                </p>
              )}
              {task.output && (
                <div className="mt-2 max-h-72 max-w-[72ch] overflow-auto break-words text-sm text-text-primary">
                  <MarkdownRenderer content={task.output} />
                </div>
              )}
              {task.outputTruncated && (
                <p className="mt-1 text-xs text-text-tertiary">
                  Report shortened. Full output is available in execution details.
                </p>
              )}
              {!active &&
                !pending &&
                (task.status === 'failed' || task.status === 'interrupted') && (
                  <button
                    disabled={acting}
                    className={`${actionClass} mt-2`}
                    onClick={() => void act('retry', task.id)}
                  >
                    Retry {task.name}
                  </button>
                )}
              {run.status === 'paused' && task.status === 'interrupted' && (
                <button
                  disabled={acting}
                  className={`${actionClass} mt-2`}
                  onClick={() => void act('retry', task.id)}
                >
                  Retry {task.name}
                </button>
              )}
            </div>
          ))}
          {loading && (
            <p role="status" className="text-xs text-text-tertiary">
              Loading task reports…
            </p>
          )}
          {run.error && (
            <p className="whitespace-pre-wrap break-words text-xs text-warning">{run.error}</p>
          )}
          {run.hasRemoteChanges && (
            <DelegationIntegrationPanel
              key={identity}
              threadId={threadId}
              run={run}
              integration={detail?.integration ?? run.integration}
              onIntegrationUpdate={updateDetail}
              onRefresh={onRefresh}
            />
          )}
          {run.status === 'paused' && !run.tasks.some((task) => task.status === 'interrupted') && (
            <button disabled={acting} className={actionClass} onClick={() => void act('resume')}>
              Resume work
            </button>
          )}
          {run.cancellationPending && (
            <p className="text-xs text-text-secondary">
              Waiting for the remote worker to confirm it stopped.
            </p>
          )}
          <a
            href={`#/workflows?run=${encodeURIComponent(run.id)}`}
            className={`${actionClass} inline-block`}
          >
            Execution details
          </a>
        </div>
      )}
    </div>
  );
}

export function DelegationIntegrationPanel({
  threadId,
  run,
  integration,
  onIntegrationUpdate,
  onRefresh,
}: {
  threadId: string;
  run: ChatDelegationRun;
  integration?: ChatDelegationIntegration;
  onIntegrationUpdate: (run: ChatDelegationRun) => void;
  onRefresh: () => Promise<void>;
}) {
  const identity = `${threadId}:${run.id}`;
  const identityRef = useRef(identity);
  const mounted = useRef(true);
  const operation = useRef(0);
  identityRef.current = identity;
  const isCurrent = useCallback(
    () => mounted.current && identityRef.current === identity,
    [identity],
  );
  const [plan, setPlan] = useDelegationState<ChatDelegationIntegrationPlan | null>(
    identity,
    'plan',
    null,
  );
  const [selections, setSelections] = useDelegationState<ChatDelegationVerificationSelection[]>(
    identity,
    'selections',
    [],
  );
  const [customCommands, setCustomCommands] = useDelegationState<Record<string, string>>(
    identity,
    'commands',
    {},
  );
  const [busy, setBusy] = useDelegationState(identity, 'operation-busy', false);
  const [error, setError] = useDelegationState<string | null>(identity, 'operation-error', null);
  const integrated = integration?.combined ?? run.integrationState === 'integrated';
  const canCombine = run.status === 'completed' && !integrated;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const selectionCommands = (repositoryId: string) =>
    selections.find((item) => item.repositoryId === repositoryId)?.commands ?? [];

  const changeCommands = (repositoryId: string, commands: string[]) => {
    setSelections((previous) => {
      const rest = previous.filter((item) => item.repositoryId !== repositoryId);
      return commands.length ? [...rest, { repositoryId, commands }] : rest;
    });
  };

  const openPlan = async () => {
    if (busy) return;
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await window.mezair.chat.prepareDelegationIntegration(threadId, run.id);
      if (id !== operation.current) return;
      const stored = integration?.verificationSelections ?? [];
      setPlan(value);
      setSelections(
        value.repositories.map((repository) => {
          const previous = stored.find(
            (item) => item.repositoryId === repository.repositoryId,
          )?.commands;
          return {
            repositoryId: repository.repositoryId,
            commands: previous ?? repository.recommendedCommands,
          };
        }),
      );
      setCustomCommands({});
    } catch (cause) {
      if (id === operation.current)
        setError(
          cause instanceof Error ? cause.message : 'Could not prepare the integration review.',
        );
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  const submitSelections = async (selectedChecks: ChatDelegationVerificationSelection[]) => {
    if (busy) return;
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await window.mezair.chat.integrateDelegation(threadId, run.id, selectedChecks);
      if (id !== operation.current) return;
      if (isCurrent()) onIntegrationUpdate(value);
      setPlan(null);
      if (isCurrent()) await onRefresh();
    } catch (cause) {
      if (id === operation.current)
        setError(cause instanceof Error ? cause.message : 'Could not integrate these results.');
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  const retryVerification = async () => {
    if (busy) return;
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await window.mezair.chat.retryDelegationVerification(threadId, run.id);
      if (id !== operation.current) return;
      if (isCurrent()) onIntegrationUpdate(value);
      if (isCurrent()) await onRefresh();
    } catch (cause) {
      if (id === operation.current)
        setError(cause instanceof Error ? cause.message : 'Could not retry verification.');
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  const applyRepository = async (repositoryId: string) => {
    if (busy) return;
    const id = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const value = await window.mezair.chat.applyDelegationIntegration(
        threadId,
        run.id,
        repositoryId,
      );
      if (id !== operation.current) return;
      if (isCurrent()) onIntegrationUpdate(value);
      if (isCurrent()) await onRefresh();
    } catch (cause) {
      if (id === operation.current)
        setError(cause instanceof Error ? cause.message : 'Could not apply verified changes.');
    } finally {
      if (id === operation.current) setBusy(false);
    }
  };

  const openCheckout = async (path: string) => {
    setError(null);
    try {
      await window.mezair.repo.openInVSCode(path);
    } catch (cause) {
      if (isCurrent())
        setError(
          cause instanceof Error ? cause.message : 'Could not open the integration checkout.',
        );
    }
  };

  const addCustomCommand = (repositoryId: string) => {
    const command = customCommands[repositoryId]?.trim() ?? '';
    if (!command) return;
    const selected = selectionCommands(repositoryId);
    if (command.length > 500) {
      setError('Keep each verification command under 500 characters.');
      return;
    }
    if (selected.includes(command)) {
      setError('That command is already selected for this repository.');
      return;
    }
    if (selected.length >= 3) {
      setError('Choose up to 3 checks per repository.');
      return;
    }
    setError(null);
    changeCommands(repositoryId, [...selected, command]);
    setCustomCommands((previous) => ({ ...previous, [repositoryId]: '' }));
  };

  const integrationState = integration?.verificationState ?? 'not-run';
  const showRetry = integrated && ['failed', 'blocked', 'stale'].includes(integrationState);
  const appliedRepositoryCount =
    integration?.repositories.filter((repository) => repository.appliedAt).length ?? 0;
  const repositoryCount = integration?.repositories.length ?? 0;

  return (
    <section
      aria-label="Integration and verification"
      className="space-y-3 rounded-md border border-border-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-text-primary">Result integration</span>
        {integrated ? (
          <span className="inline-flex items-center gap-1 text-success">
            <Check size={12} aria-hidden="true" /> Branches combined
          </span>
        ) : integration?.mergeState === 'conflicted' ? (
          <span className="text-warning">Merge conflicts</span>
        ) : integration?.mergeState === 'failed' ? (
          <span className="text-warning">Combine failed</span>
        ) : integration?.mergeState === 'integrating' ? (
          <span className="text-text-secondary">Combining result branches</span>
        ) : run.status === 'completed' ? (
          <span className="text-text-secondary">Ready for review</span>
        ) : (
          <span className="text-text-secondary">Waiting for delegated work to finish</span>
        )}
        {integrated && <VerificationBadge state={integrationState} />}
      </div>
      {integrated && (
        <p className="text-xs text-text-secondary">
          {integrationApplicationHeadline(appliedRepositoryCount, repositoryCount)}
        </p>
      )}
      {integrated && integration?.applyAllowed === false && (
        <p className="text-xs text-text-tertiary">
          This read-only delegation can be reviewed in its integration checkout but cannot apply
          changes.
        </p>
      )}
      {integration?.error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-warning">
          {integration.error}
        </p>
      )}
      {integration?.repositories.map((repository) => (
        <div key={repository.repositoryId} className="space-y-2 border-t border-border-subtle pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-text-primary">{repository.name}</span>
            {repository.worktreePath && (
              <button
                type="button"
                disabled={busy}
                className={actionClass}
                onClick={() => void openCheckout(repository.worktreePath)}
              >
                Open integration checkout
              </button>
            )}
          </div>
          <p className="break-all text-xs text-text-tertiary">
            {repository.branch} · {repository.worktreePath}
          </p>
          {repository.appliedAt ? (
            <p className="text-xs text-success">
              Applied to {repository.destinationBranch ?? 'the source branch'} at{' '}
              <code>{repository.appliedCommit?.slice(0, 12) ?? 'unknown commit'}</code>
            </p>
          ) : (
            <>
              {repository.applyError && (
                <p role="alert" className="whitespace-pre-wrap text-xs text-warning">
                  {repository.applyError}
                </p>
              )}
              {integration?.applyAllowed &&
                integration.verificationState === 'passed' &&
                (integration.verificationSelections.find(
                  (selection) => selection.repositoryId === repository.repositoryId,
                )?.commands.length ?? 0) > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    className={actionClass}
                    onClick={() => void applyRepository(repository.repositoryId)}
                  >
                    {busy ? 'Applying…' : 'Apply verified changes'}
                  </button>
                )}
            </>
          )}
          {repository.conflicts.map((conflict) => (
            <div key={`${conflict.dispatchId}:${conflict.ref}`} className="text-xs text-warning">
              <p>
                Could not combine {conflict.ref}. Resolve in the retained checkout, then inspect the
                execution details.
              </p>
              {conflict.conflictedFiles.length > 0 && (
                <p className="mt-1 break-words">Files: {conflict.conflictedFiles.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      ))}
      {integration?.verification.map((result, index) => (
        <div
          key={`${result.repositoryId}:${result.command}:${index}`}
          className="space-y-1 border-t border-border-subtle pt-3 text-xs"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <code className="break-all text-text-primary">{result.command}</code>
            <span className="text-text-secondary">
              {!result.approvalGranted
                ? 'Approval declined'
                : result.timedOut
                  ? 'Timed out'
                  : `Exit ${result.exitCode ?? 'unknown'}`}
              {' · '}
              {Math.round(result.durationMs / 1000)}s
            </span>
          </div>
          {result.logTail && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-secondary p-2 text-text-tertiary">
              {result.logTail}
            </pre>
          )}
        </div>
      ))}
      {integration?.verificationState === 'running' && (
        <p role="status" className="text-xs text-text-secondary">
          Verification is running…
        </p>
      )}
      {integration?.verificationState === 'not-run' && integrated && (
        <p className="text-xs text-text-secondary">
          Verification has not run. Select checks below when you are ready.
        </p>
      )}
      {showRetry && integration?.verificationSelections.length ? (
        <button
          type="button"
          disabled={busy}
          className={actionClass}
          onClick={() => void retryVerification()}
        >
          {busy ? 'Retrying verification…' : 'Retry verification'}
        </button>
      ) : null}
      {!plan && canCombine && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className={actionClass}
            onClick={() => void openPlan()}
          >
            {busy ? 'Preparing review…' : 'Review integration checks'}
          </button>
          <span className="text-xs text-text-tertiary">
            Checks are shown before any command runs.
          </span>
        </div>
      )}
      {!plan && integrated && (
        <button
          type="button"
          disabled={busy}
          className={actionClass}
          onClick={() => void openPlan()}
        >
          {busy ? 'Preparing review…' : 'Review or edit checks'}
        </button>
      )}
      {plan && (
        <div className="space-y-4 border-t border-border-subtle pt-3">
          <div>
            <h3 className="text-xs font-medium text-text-primary">
              {canCombine ? 'Review checks before combining' : 'Review checks before running'}
            </h3>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              {plan.permissionExplanation} Each selected command runs in the retained integration
              checkout. The app will ask for command approval when required.
            </p>
          </div>
          {plan.repositories.map((repository) => {
            const selected = selectionCommands(repository.repositoryId);
            return (
              <fieldset
                key={repository.repositoryId}
                className="space-y-2 border-t border-border-subtle pt-3"
              >
                <legend className="text-xs font-medium text-text-primary">{repository.name}</legend>
                <p className="text-xs text-text-tertiary">
                  Up to 3 checks. Detected commands are suggestions; review each command before
                  running it.
                </p>
                {repository.candidates.length ? (
                  repository.candidates.map((candidate) => {
                    const checked = selected.includes(candidate.command);
                    const disabled = !checked && selected.length >= 3;
                    return (
                      <label
                        key={`${candidate.command}:${candidate.source}`}
                        className="flex items-start gap-2 text-xs text-text-secondary"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled || busy}
                          onChange={(event) =>
                            changeCommands(
                              repository.repositoryId,
                              event.target.checked
                                ? [...selected, candidate.command]
                                : selected.filter((command) => command !== candidate.command),
                            )
                          }
                          className="mt-0.5 accent-accent"
                        />
                        <span className="min-w-0">
                          <span className="mr-1 text-text-tertiary">
                            {candidate.source === 'saved' ? 'Saved' : 'Detected'}
                          </span>
                          <span className="mr-1">{candidate.label}</span>
                          <code className="break-all text-text-primary">{candidate.command}</code>
                          {repository.recommendedCommands.includes(candidate.command) && (
                            <span className="ml-1 text-text-tertiary">Recommended</span>
                          )}
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-xs text-text-tertiary">
                    No repository checks were found. Add a command you trust, or combine without
                    running checks.
                  </p>
                )}
                {selected
                  .filter(
                    (command) =>
                      !repository.candidates.some((candidate) => candidate.command === command),
                  )
                  .map((command) => (
                    <div key={command} className="flex items-start gap-2 text-xs">
                      <span aria-hidden="true" className="mt-0.5 text-success">
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mr-1 text-text-tertiary">Custom</span>
                        <code className="break-all text-text-primary">{command}</code>
                      </span>
                      <button
                        type="button"
                        className={actionClass}
                        onClick={() =>
                          changeCommands(
                            repository.repositoryId,
                            selected.filter((item) => item !== command),
                          )
                        }
                        aria-label={`Remove custom check ${command}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                <div className="flex flex-wrap gap-2">
                  <label
                    className="sr-only"
                    htmlFor={`custom-check-${run.id}-${repository.repositoryId}`}
                  >
                    Custom verification command for {repository.name}
                  </label>
                  <input
                    id={`custom-check-${run.id}-${repository.repositoryId}`}
                    type="text"
                    value={customCommands[repository.repositoryId] ?? ''}
                    maxLength={500}
                    onChange={(event) =>
                      setCustomCommands((previous) => ({
                        ...previous,
                        [repository.repositoryId]: event.target.value,
                      }))
                    }
                    placeholder="Add a command, e.g. pnpm test"
                    disabled={busy || selected.length >= 3}
                    className="min-w-56 flex-1 rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <button
                    type="button"
                    className={actionClass}
                    disabled={
                      busy ||
                      selected.length >= 3 ||
                      !(customCommands[repository.repositoryId] ?? '').trim()
                    }
                    onClick={() => addCustomCommand(repository.repositoryId)}
                  >
                    Add command
                  </button>
                </div>
              </fieldset>
            );
          })}
          <div className="flex flex-wrap gap-2">
            {canCombine ? (
              <>
                <button
                  type="button"
                  disabled={busy || !selections.some((item) => item.commands.length > 0)}
                  className={actionClass}
                  onClick={() => void submitSelections(selections)}
                >
                  {busy ? 'Combining…' : 'Combine and run selected checks'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={actionClass}
                  onClick={() => void submitSelections([])}
                >
                  Combine without checks
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy || !selections.some((item) => item.commands.length > 0)}
                className={actionClass}
                onClick={() => void submitSelections(selections)}
              >
                {busy ? 'Running checks…' : 'Run selected checks'}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className={actionClass}
              onClick={() => setPlan(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-warning">
          {error}
        </p>
      )}
    </section>
  );
}

function VerificationBadge({ state }: { state: ChatDelegationIntegration['verificationState'] }) {
  const labels: Record<ChatDelegationIntegration['verificationState'], string> = {
    'not-run': 'Verification not run',
    running: 'Verification running',
    passed: 'Verification passed',
    failed: 'Verification failed',
    blocked: 'Verification blocked',
    stale: 'Verification evidence is stale',
  };
  const style =
    state === 'passed'
      ? 'text-success'
      : ['failed', 'blocked', 'stale'].includes(state)
        ? 'text-warning'
        : 'text-text-secondary';
  return <span className={style}>· {labels[state]}</span>;
}
