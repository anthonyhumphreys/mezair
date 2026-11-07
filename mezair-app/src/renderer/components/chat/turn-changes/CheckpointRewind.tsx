import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileMinus, FilePlus, FileText, Loader2 } from 'lucide-react';
import type {
  ChatCheckpointFileChange,
  ChatCheckpointPreview,
  ChatCheckpointRestoreResult,
  RepoInfo,
} from '../../../../shared/types';
import { Button, Dialog } from '../../ui';

/**
 * Message ids in a thread that have a pre-turn checkpoint. Refreshes when a
 * turn starts or ends (`revision`) so a just-sent message gains its rewind.
 */
export function useThreadCheckpoints(threadId: string | null | undefined, revision: unknown) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!threadId) {
      setIds(new Set());
      return;
    }
    let cancelled = false;
    window.mezair.chat
      .listCheckpoints(threadId)
      .then((rows) => {
        if (cancelled) return;
        setIds(new Set(rows.filter((row) => row.kind === 'turn').map((row) => row.messageId)));
      })
      .catch(() => {
        if (!cancelled) setIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, revision, reload]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);
  return { checkpointIds: ids, refresh };
}

const EFFECT_COPY: Record<ChatCheckpointFileChange['effect'], string> = {
  restore: 'Restored',
  recreate: 'Recreated',
  remove: 'Removed',
};

function EffectIcon({ effect }: { effect: ChatCheckpointFileChange['effect'] }) {
  if (effect === 'remove') return <FileMinus size={13} aria-hidden="true" className="text-error" />;
  if (effect === 'recreate')
    return <FilePlus size={13} aria-hidden="true" className="text-success" />;
  return <FileText size={13} aria-hidden="true" className="text-info" />;
}

/**
 * Previews and performs "Rewind files to before this message". The preview
 * is read from git on open, so it reflects edits made after the turn too.
 */
export function CheckpointRewindDialog({
  open,
  threadId,
  messageId,
  repos,
  onClose,
  onRestored,
}: {
  open: boolean;
  threadId: string;
  messageId: string;
  repos: RepoInfo[];
  onClose: () => void;
  onRestored: (result: ChatCheckpointRestoreResult) => void;
}) {
  const [preview, setPreview] = useState<ChatCheckpointPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setLoading(true);
    window.mezair.chat
      .previewCheckpoint(threadId, messageId)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Could not read the checkpoint.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadId, messageId]);

  const total = useMemo(
    () => preview?.repos.reduce((sum, repo) => sum + repo.changes.length, 0) ?? 0,
    [preview],
  );
  const repoName = (repoId: string) => repos.find((repo) => repo.id === repoId)?.name ?? repoId;

  const restore = async () => {
    setRestoring(true);
    setError(null);
    try {
      const result = await window.mezair.chat.restoreCheckpoint(threadId, messageId);
      onRestored(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rewind the files.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={restoring ? () => undefined : onClose}
      title="Rewind files to before this message?"
      description="Files go back to how they were when you sent this message. Your Git index, branches and commits are not changed, and the current files are saved first so you can undo the rewind."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={restoring}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void restore()}
            disabled={loading || restoring || total === 0 || Boolean(error && !preview)}
          >
            {restoring && <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />}
            {total === 0 ? 'Nothing to rewind' : `Rewind ${total} file${total === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="max-h-[50vh] overflow-y-auto" aria-busy={loading}>
        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
            Comparing with the checkpoint…
          </p>
        )}
        {preview && total === 0 && (
          <p className="text-sm text-text-secondary">The files already match this checkpoint.</p>
        )}
        {preview?.repos
          .filter((repo) => repo.changes.length > 0)
          .map((repo) => (
            <section key={repo.repoId} className="mb-3 last:mb-0">
              {preview.repos.length > 1 && (
                <h3 className="mb-1.5 text-xs font-semibold text-text-primary">
                  {repoName(repo.repoId)}
                </h3>
              )}
              <ul className="space-y-0.5">
                {repo.changes.map((change) => (
                  <li
                    key={change.path}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs"
                  >
                    <EffectIcon effect={change.effect} />
                    <span className="min-w-0 flex-1 truncate font-mono text-text-primary">
                      {change.path}
                    </span>
                    <span className="shrink-0 text-text-secondary">
                      {EFFECT_COPY[change.effect]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {error && (
          <p role="alert" className="mt-2 text-xs text-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
