import { SegmentedControl } from '../../ui/SegmentedControl';
import { useState } from 'react';
import type { RepoInfo } from '../../../../shared/types';
import { ChatReviewPanel } from '../ChatReviewPanel';
import { UserMessage } from '../ChatMessage';
import { DelegationViewState, useDelegationState } from '../DelegationViewState';
import { CheckpointRewindDialog } from '../turn-changes/CheckpointRewind';
import { DelegationIntegrationPanel } from '../ChatDelegations';
import type { ChatDelegationRun } from '../../../../shared/chat-delegation';

const repos = [
  { id: 'a', name: 'Repository A' },
  { id: 'b', name: 'Repository B' },
] as RepoInfo[];
export function installReviewPreview() {
  let finishIntegration: (() => void) | undefined;
  let integrationCalls = 0;
  let statusReads = 0;
  let finishStage: (() => void) | undefined;
  let previewRevision = 0;
  window.mezair.chat = {
    ...window.mezair.chat,
    prepareDelegationIntegration: async () => ({
      permissionMode: 'workspace-auto',
      permissionExplanation: 'Synthetic checks only.',
      repositories: [
        {
          repositoryId: 'a',
          name: 'Repository A',
          candidates: [{ command: 'pnpm test', label: 'Test', source: 'detected' }],
          recommendedCommands: ['pnpm test'],
        },
      ],
    }),
    integrateDelegation: async () => {
      integrationCalls++;
      return new Promise((resolve) => {
        finishIntegration = () => resolve(integrationRun);
      });
    },
    previewCheckpoint: async () => ({
      messageId: 'message',
      fingerprint: `preview-${previewRevision}`,
      repos: [
        {
          repoId: 'a',
          createdAt: 'now',
          changes: [
            { path: 'reviewed.txt', effect: 'restore' },
            ...(previewRevision ? [{ path: 'new-unreviewed.txt', effect: 'remove' } as const] : []),
          ],
        },
      ],
    }),
    restoreCheckpoint: async (_threadId, _messageId, fingerprint) => {
      if (fingerprint !== `preview-${previewRevision}`)
        throw new Error('The confirmed preview token was not used.');
      if (!previewRevision) {
        previewRevision++;
        throw new Error(
          'Files changed since the preview. Review the updated file list and confirm again.',
        );
      }
      return { filesChanged: 2, undoKey: 'synthetic-undo' };
    },
  };
  Object.assign(window, {
    finishIntegrationProbe: () => finishIntegration?.(),
    integrationProbeCalls: () => integrationCalls,
  });
  const git = window.mezair.git;
  git.status = async (repoId) => {
    statusReads++;
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
    reviewFingerprint: 'synthetic-reviewed-file',
    hunks:
      'diff --git a/same-name.txt b/same-name.txt\n--- a/same-name.txt\n+++ b/same-name.txt\n@@ -1 +1 @@\n-old\n+new\n',
  });
  git.applyHunk = async () => {
    throw new Error('The file changed since review. Refresh and try again.');
  };
  git.stage = async () =>
    new Promise<void>((resolve) => {
      finishStage = resolve;
    });
  Object.assign(window, {
    finishStageProbe: () => finishStage?.(),
    reviewStatusReads: () => statusReads,
  });
  git.unstage = async () => undefined;
  git.discard = async () => undefined;
  git.discardReviewed = async () => {
    throw new Error('The file changed since review. Refresh and try again.');
  };
}
const integrationRun: ChatDelegationRun = {
  id: 'verification-run',
  title: 'Verify',
  reason: 'Synthetic test',
  status: 'completed',
  createdAt: 'now',
  tasks: [],
  hasRemoteChanges: false,
  integrationState: 'integrated',
  integration: {
    integrationId: 'integration',
    mergeState: 'integrated',
    combined: true,
    verificationState: 'not-run',
    verificationAttempt: 0,
    verificationSelections: [],
    verification: [],
    appliedAt: null,
    applyAllowed: true,
    repositories: [],
  },
};
function IntegrationProbe() {
  const [moved, setMoved] = useState(false);
  const panel = (
    <DelegationIntegrationPanel
      threadId="verification-thread"
      run={integrationRun}
      integration={integrationRun.integration}
      onIntegrationUpdate={() => undefined}
      onRefresh={async () => undefined}
    />
  );
  return (
    <DelegationViewState>
      <button className="rounded border border-border p-2" onClick={() => setMoved(!moved)}>
        Move verification panel
      </button>
      {moved ? <section>{panel}</section> : <div>{panel}</div>}
    </DelegationViewState>
  );
}
function RewindProbe() {
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  return (
    <>
      <button className="rounded border border-border p-2" onClick={() => setOpen(true)}>
        Preview file rewind
      </button>
      {restored && <p role="status">Confirmed updated rewind</p>}
      {open && (
        <CheckpointRewindDialog
          open
          threadId="synthetic-thread"
          messageId="message"
          repos={repos}
          onClose={() => setOpen(false)}
          onRestored={() => setRestored(true)}
        />
      )}
    </>
  );
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
function KeyboardProbe() {
  const [disabledSelection, setDisabledSelection] = useState('disabled');
  const [panel, setPanel] = useState<string | null>('review');
  const options = [
    { value: 'activity', label: 'Activity probe' },
    { value: 'review', label: 'Review probe' },
    { value: 'preview', label: 'Preview probe' },
  ];
  return (
    <>
      <SegmentedControl
        label="Disabled selected option"
        value={disabledSelection}
        onChange={setDisabledSelection}
        options={[
          { value: 'first', label: 'First enabled' },
          { value: 'second', label: 'Second enabled' },
          { value: 'disabled', label: 'Disabled', disabled: true },
        ]}
      />
      <SegmentedControl
        label="Toggle panel navigation"
        value={panel ?? ''}
        options={options}
        onChange={setPanel}
        onReselect={() => setPanel(null)}
      />
    </>
  );
}
export function ReviewPreview() {
  const [reviewBusy, setReviewBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [moved, setMoved] = useState(false);
  return (
    <main className="h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto grid h-full max-w-6xl gap-4 p-4 md:grid-cols-2">
        <ChatReviewPanel
          repos={repos}
          busy={reviewBusy}
          refreshKey={refreshKey}
          onClose={() => undefined}
        />
        <section className="space-y-5 p-3">
          <h1 className="text-lg font-semibold">Synthetic review states</h1>
          <p>
            Repository B loads after four seconds. Its old file actions must disappear while
            loading. Per-hunk Stage simulates a stale-file error that must remain visible.
          </p>
          <button onClick={() => setReviewBusy((value) => !value)}>Toggle review busy</button>
          <button onClick={() => setRefreshKey((value) => value + 1)}>
            Refresh after recovery
          </button>
          <KeyboardProbe />
          <UserMessage
            content="Edit this message; a failed resend must retain your changes."
            onEditResend={async () => false}
          />
          <RewindProbe />
          <IntegrationProbe />
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
