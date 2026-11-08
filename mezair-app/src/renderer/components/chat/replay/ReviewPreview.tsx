import { useState } from 'react';
import type { RepoInfo } from '../../../../shared/types';
import { ChatReviewPanel } from '../ChatReviewPanel';
import { UserMessage } from '../ChatMessage';
import { DelegationViewState, useDelegationState } from '../DelegationViewState';

const repos = [
  { id: 'a', name: 'Repository A' },
  { id: 'b', name: 'Repository B' },
] as RepoInfo[];
export function installReviewPreview() {
  const git = window.mezair.git;
  git.status = async (repoId) => {
    if (repoId === 'b') await new Promise((resolve) => setTimeout(resolve, 4000));
    return {
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        { path: 'same-name.txt', status: 'modified', staged: false, workingTreeChanged: true },
      ],
    };
  };
  git.diff = async () => ({
    filePath: 'same-name.txt',
    oldContent: 'old',
    newContent: 'new',
    hunks:
      'diff --git a/same-name.txt b/same-name.txt\n--- a/same-name.txt\n+++ b/same-name.txt\n@@ -1 +1 @@\n-old\n+new\n',
  });
  git.applyHunk = async () => {
    throw new Error('The file changed since review. Refresh and try again.');
  };
  git.stage = async () => undefined;
  git.unstage = async () => undefined;
  git.discard = async () => undefined;
}
function DraftProbe() {
  const [text, setText] = useDelegationState('thread:run', 'commands', 'pnpm test');
  return (
    <label className="block py-2">
      Unsaved integration command
      <input
        aria-label="Unsaved integration command"
        className="ml-2 rounded border border-border bg-bg-secondary p-2"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </label>
  );
}
export function ReviewPreview() {
  const [moved, setMoved] = useState(false);
  return (
    <main className="h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto grid h-full max-w-6xl gap-4 p-4 md:grid-cols-2">
        <ChatReviewPanel repos={repos} busy={false} onClose={() => undefined} />
        <section className="space-y-5 p-3">
          <h1 className="text-lg font-semibold">Synthetic review states</h1>
          <p>
            Repository B loads after four seconds. Its old file actions must disappear while
            loading. Per-hunk Stage simulates a stale-file error that must remain visible.
          </p>
          <UserMessage
            content="Edit this message; a failed resend must retain your changes."
            onEditResend={async () => false}
          />
          <DelegationViewState>
            <button className="rounded border border-border p-2" onClick={() => setMoved(!moved)}>
              Move delegated run
            </button>
            {moved ? (
              <section>
                <DraftProbe />
              </section>
            ) : (
              <div>
                <DraftProbe />
              </div>
            )}
          </DelegationViewState>
        </section>
      </div>
    </main>
  );
}
