import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileDiff, FilePlus, Loader2, RefreshCw, Trash2, Undo2, X } from 'lucide-react';
import type { GitFileChange, RepoInfo } from '../../../shared/types';
import { parseFileDiff, type GitDiffHunk, type GitHunkAction } from '../../../shared/git-hunks';
import { SegmentedControl } from '../ui';
import { DiffViewer } from './DiffViewer';

type ReviewSide = 'unstaged' | 'staged';
const EMPTY_FILES: GitFileChange[] = [];

interface LoadedDiff {
  key: string;
  reviewFingerprint?: string;
  fileHeader: string;
  hunks: GitDiffHunk[];
  binary: boolean;
}

/**
 * Review beside the conversation: the working tree's changes for the thread's
 * repositories, file by file and hunk by hunk. Stage accepts a hunk into the
 * index; Discard reverts it in the working tree (two-step). Every action is
 * checked against the hunk the user saw, so a file the agent is still editing
 * is never changed blind.
 */
export function ChatReviewPanel({
  repos,
  busy,
  onClose,
}: {
  repos: RepoInfo[];
  /** Refreshes when a turn ends so new agent edits appear. */
  busy: boolean;
  onClose: () => void;
}) {
  const [repoId, setRepoId] = useState<string | null>(repos[0]?.id ?? null);
  const [side, setSide] = useState<ReviewSide>('unstaged');
  const [status, setStatus] = useState<{
    repoId: string;
    revision: number;
    files: GitFileChange[];
  } | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadedDiff, setDiff] = useState<LoadedDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingHunk, setPendingHunk] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const statusRequest = useRef(0);
  const diffRequest = useRef(0);

  const effectiveRepoId = repos.some((repo) => repo.id === repoId)
    ? repoId
    : (repos[0]?.id ?? null);
  const ready = Boolean(
    effectiveRepoId && status?.repoId === effectiveRepoId && status.revision === revision,
  );
  const files = status?.repoId === effectiveRepoId ? status.files : EMPTY_FILES;
  const contextRef = useRef('');
  const contextKey = `${effectiveRepoId}:${side}:${revision}`;
  contextRef.current = contextKey;

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  // Agent edits land at the end of a turn; refresh then.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) refresh();
    wasBusy.current = busy;
  }, [busy, refresh]);

  useEffect(() => {
    if (!effectiveRepoId) {
      setStatus(null);
      return;
    }
    const request = ++statusRequest.current;
    setLoading(true);
    setError(null);
    window.mezair.git
      .status(effectiveRepoId)
      .then((status) => {
        if (request !== statusRequest.current) return;
        setStatus({ repoId: effectiveRepoId, revision, files: status.files });
      })
      .catch((err: unknown) => {
        if (request !== statusRequest.current) return;
        setError(err instanceof Error ? err.message : 'Could not read the repository status.');
        setStatus(null);
      })
      .finally(() => {
        if (request === statusRequest.current) setLoading(false);
      });
    return () => {
      statusRequest.current++;
    };
  }, [effectiveRepoId, revision]);

  const visibleFiles = useMemo(
    () => files.filter((file) => (side === 'staged' ? file.staged : hasUnstagedChanges(file))),
    [files, side],
  );

  useEffect(() => {
    if (selectedPath && visibleFiles.some((file) => file.path === selectedPath)) return;
    setSelectedPath(visibleFiles[0]?.path ?? null);
  }, [selectedPath, visibleFiles]);

  const selectedFile = visibleFiles.find((file) => file.path === selectedPath) ?? null;
  const diffKey = `${contextKey}:${selectedPath}`;
  const diff = ready && loadedDiff?.key === diffKey ? loadedDiff : null;
  const untracked = selectedFile?.status === 'untracked';

  useEffect(() => {
    setConfirmDiscard(null);
    const request = ++diffRequest.current;
    if (!ready || !effectiveRepoId || !selectedFile) {
      setDiff(null);
      return;
    }
    window.mezair.git
      .diff(effectiveRepoId, selectedFile.path, side === 'staged')
      .then((result) => {
        if (request !== diffRequest.current) return;
        const parsed = parseFileDiff(result.hunks);
        setDiff({
          key: diffKey,
          reviewFingerprint: result.reviewFingerprint,
          fileHeader: parsed.fileHeader,
          hunks: parsed.hunks,
          binary: parsed.binary,
        });
      })
      .catch((err: unknown) => {
        if (request !== diffRequest.current) return;
        setError(err instanceof Error ? err.message : 'Could not load the diff.');
        setDiff(null);
      });
    return () => {
      diffRequest.current++;
    };
  }, [effectiveRepoId, selectedPath, side, untracked, revision, ready, diffKey, selectedFile]);

  const applyHunk = async (hunk: GitDiffHunk, action: GitHunkAction) => {
    if (!ready || !effectiveRepoId || !selectedFile || !diff) return;
    const startedContext = contextRef.current;
    const id = `${hunk.index}:${hunk.fingerprint}`;
    setPendingHunk(id);
    setActionError(null);
    try {
      await window.mezair.git.applyHunk(
        effectiveRepoId,
        selectedFile.path,
        hunk.index,
        hunk.fingerprint,
        action,
      );
      if (contextRef.current !== startedContext) return;
      setConfirmDiscard(null);
      refresh();
    } catch (err) {
      if (contextRef.current !== startedContext) return;
      setActionError(err instanceof Error ? err.message : 'Could not apply that change.');
      refresh();
    } finally {
      setPendingHunk(null);
    }
  };

  const applyFile = async (action: 'stage' | 'unstage' | 'discard') => {
    if (!ready || !effectiveRepoId || !selectedFile) return;
    const startedContext = contextRef.current;
    setPendingHunk('file');
    setActionError(null);
    try {
      const paths =
        action === 'unstage' && selectedFile.oldPath
          ? [selectedFile.path, selectedFile.oldPath]
          : [selectedFile.path];
      if (action === 'stage') await window.mezair.git.stage(effectiveRepoId, paths);
      else if (action === 'unstage') await window.mezair.git.unstage(effectiveRepoId, paths);
      else {
        if (busy || !diff?.reviewFingerprint) return;
        await window.mezair.git.discardReviewed(
          effectiveRepoId,
          selectedFile.path,
          diff.reviewFingerprint,
        );
      }
      if (contextRef.current !== startedContext) return;
      setConfirmDiscard(null);
      refresh();
    } catch (err) {
      if (contextRef.current !== startedContext) return;
      setActionError(err instanceof Error ? err.message : 'Could not update the file.');
    } finally {
      setPendingHunk(null);
    }
  };

  const busyAction = pendingHunk !== null;

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Review changes">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <FileDiff size={14} aria-hidden="true" className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Review</h2>
        {repos.length > 1 && (
          <select
            aria-label="Repository"
            value={effectiveRepoId ?? ''}
            onChange={(event) => {
              setRepoId(event.target.value);
              setActionError(null);
              setConfirmDiscard(null);
            }}
            className="ml-1 max-w-40 truncate rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh changes"
            title="Refresh changes"
            className="rounded-md p-1.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <RefreshCw
              size={13}
              className={loading ? 'animate-spin motion-reduce:animate-none' : ''}
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review"
            title="Close review"
            className="rounded-md p-1.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X size={13} />
          </button>
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <SegmentedControl<ReviewSide>
          label="Changes to review"
          size="sm"
          value={side}
          onChange={setSide}
          options={[
            {
              value: 'unstaged',
              label: `Unstaged ${files.filter(hasUnstagedChanges).length}`,
            },
            { value: 'staged', label: `Staged ${files.filter((file) => file.staged).length}` },
          ]}
        />
        {busy && (
          <span className="ml-auto text-xs text-text-tertiary" role="status">
            Agent is working; the list refreshes when the turn ends.
          </span>
        )}
      </div>

      {(actionError || error) && (
        <p role="alert" className="border-b border-border/60 px-3 py-2 text-xs text-error">
          {actionError || error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(72px,30%)_minmax(0,1fr)]">
        <ul
          aria-label="Changed files"
          className="min-h-0 overflow-y-auto border-b border-border/60 p-1.5"
        >
          {visibleFiles.length === 0 && !loading && (
            <li className="px-2 py-3 text-xs text-text-tertiary">
              {side === 'staged' ? 'Nothing staged yet.' : 'No unstaged changes.'}
            </li>
          )}
          {visibleFiles.map((file) => (
            <li key={`${file.path}:${file.staged}`}>
              <button
                type="button"
                aria-current={file.path === selectedPath ? 'true' : undefined}
                onClick={() => setSelectedPath(file.path)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                  file.path === selectedPath
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary'
                }`}
              >
                <span className="w-14 shrink-0 text-text-tertiary">{file.status}</span>
                <span className="min-w-0 truncate font-mono">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="min-h-0 overflow-y-auto">
          {selectedFile && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border/60 bg-bg-secondary px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
                {selectedFile.path}
              </span>
              {side === 'unstaged' ? (
                <>
                  <ReviewButton
                    disabled={busyAction || !ready}
                    onClick={() => void applyFile('stage')}
                    icon={<Check size={12} aria-hidden="true" />}
                  >
                    Stage file
                  </ReviewButton>
                  {confirmDiscard === 'file' ? (
                    <ReviewButton
                      tone="danger"
                      disabled={busyAction || !ready || busy || !diff?.reviewFingerprint}
                      onClick={() => void applyFile('discard')}
                      icon={<Trash2 size={12} aria-hidden="true" />}
                    >
                      {untracked ? 'Delete file?' : 'Discard file?'}
                    </ReviewButton>
                  ) : (
                    <ReviewButton
                      disabled={busyAction || !ready || busy || !diff?.reviewFingerprint}
                      onClick={() => setConfirmDiscard('file')}
                      icon={<Trash2 size={12} aria-hidden="true" />}
                    >
                      {untracked ? 'Delete' : 'Discard file'}
                    </ReviewButton>
                  )}
                </>
              ) : (
                <ReviewButton
                  disabled={busyAction || !ready}
                  onClick={() => void applyFile('unstage')}
                  icon={<Undo2 size={12} aria-hidden="true" />}
                >
                  Unstage file
                </ReviewButton>
              )}
            </div>
          )}

          {untracked && (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-text-secondary">
              <FilePlus size={13} aria-hidden="true" />
              New file. Stage it to keep it, or delete it.
            </p>
          )}
          {diff?.binary && (
            <p className="px-3 py-3 text-xs text-text-secondary">
              Binary change. Stage or discard the whole file.
            </p>
          )}
          {diff && !diff.binary && diff.hunks.length === 0 && selectedFile && !untracked && (
            <p className="px-3 py-3 text-xs text-text-tertiary">No line changes to show.</p>
          )}

          {diff?.hunks.map((hunk) => {
            const id = `${hunk.index}:${hunk.fingerprint}`;
            const pending = pendingHunk === id;
            return (
              <section
                key={`${diff.key}:${id}`}
                aria-label={`Change ${hunk.index + 1} of ${diff.hunks.length}`}
                className="border-b border-border/60"
              >
                <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
                  <span className="text-xs tabular-nums text-text-tertiary">
                    Change {hunk.index + 1} of {diff.hunks.length} · line {hunk.newStart}
                    <span className="ml-2 text-success">+{hunk.additions}</span>
                    <span className="ml-1 text-error">−{hunk.deletions}</span>
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {pending && (
                      <Loader2
                        size={12}
                        aria-label="Applying"
                        className="animate-spin text-text-tertiary motion-reduce:animate-none"
                      />
                    )}
                    {side === 'unstaged' ? (
                      <>
                        <ReviewButton
                          disabled={busyAction || !ready}
                          onClick={() => void applyHunk(hunk, 'stage')}
                          icon={<Check size={12} aria-hidden="true" />}
                        >
                          Stage
                        </ReviewButton>
                        {confirmDiscard === id ? (
                          <>
                            <ReviewButton
                              tone="danger"
                              disabled={busyAction || !ready}
                              onClick={() => void applyHunk(hunk, 'discard')}
                            >
                              Discard this change
                            </ReviewButton>
                            <ReviewButton onClick={() => setConfirmDiscard(null)}>
                              Keep
                            </ReviewButton>
                          </>
                        ) : (
                          <ReviewButton
                            disabled={busyAction || !ready}
                            onClick={() => setConfirmDiscard(id)}
                            icon={<Trash2 size={12} aria-hidden="true" />}
                          >
                            Discard
                          </ReviewButton>
                        )}
                      </>
                    ) : (
                      <ReviewButton
                        disabled={busyAction || !ready}
                        onClick={() => void applyHunk(hunk, 'unstage')}
                        icon={<Undo2 size={12} aria-hidden="true" />}
                      >
                        Unstage
                      </ReviewButton>
                    )}
                  </span>
                </div>
                <div className="px-1 pb-2">
                  <DiffViewer
                    filePath={selectedPath ?? ''}
                    diff={`${diff.fileHeader}${hunk.text}`}
                  />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function hasUnstagedChanges(file: GitFileChange): boolean {
  return file.workingTreeChanged ?? !file.staged;
}

function ReviewButton({
  children,
  onClick,
  disabled,
  icon,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 ${
        tone === 'danger'
          ? 'border-error/40 text-error hover:bg-error/10'
          : 'border-border text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
