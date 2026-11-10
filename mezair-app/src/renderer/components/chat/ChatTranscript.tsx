import { DelegationViewState } from './DelegationViewState';
import { memo, useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, ArrowDown } from 'lucide-react';
import type { AgentProvider, RepoInfo, ChatAttachment } from '../../../shared/types';
import type { ChatDelegationRun } from '../../../shared/chat-delegation';
import { buildChatTurnTimeline, type ComposedChatTurn } from './chat-turns';
import { SurfaceHost } from '../surfaces/SurfaceHost';
import { QuestionIntentSurface } from './AgentUIIntentSurface';
import { AssistantMessage, TurnWorkMessage, UserMessage } from './ChatMessage';
import { ChatErrorNotice, type ChatErrorProviderOption } from './ChatErrorNotice';
import { ChatPaneState, type ChatPaneKind } from './ChatPaneState';
import { TurnChangesFooter, TurnUsageFooter } from './TurnChangesFooter';
import { createLaterEditedPathsCollector } from './chat-transcript-data';
import { getChatTurnLiveState } from './chat-view-utils';
import { ChatRunOutcomeFooter } from './ChatRunOutcomeFooter';
import {
  getPendingQuestionTarget,
  shouldShowRunOutcomeFooter,
  summarizeChatTurnRun,
  type ChatQuestionTarget,
} from './chat-run-outcome';
import { stripFindingMarkers } from '../../utils/finding-parser';
import type { StarterPrompt } from '../../utils/starter-prompts';
import {
  ChatDelegationList,
  placeDelegationsInTurns,
  useThreadDelegations,
} from './ChatDelegations';
import { summarizeTurnChanges } from './chat-turn-changes';
import { VirtualChatTurns } from './VirtualChatTurns';
import { TranscriptViewScope } from './TranscriptViewState';

const EMPTY_REPOS: RepoInfo[] = [];

interface ChatTranscriptProps {
  paneKind: ChatPaneKind;
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  scrollScopeKey?: string | null;
  scaffoldRootPath?: string;
  blockedReason?: string;
  onOpenWorkspace?: () => void;
  personaId: string;
  hasRepos: boolean;
  hasGovernanceDocs: boolean;
  isDbExpertPersona: boolean;
  /** C2 — repo-grounded prompts; the empty state falls back to persona sets. */
  starterPrompts?: StarterPrompt[];
  onSuggestionClick: (prompt: string) => void;
  scaffoldBusyMessage?: string;
  turns: ComposedChatTurn[];
  activeThreadId: string | null;
  changeReviewThreadId?: string;
  busy: boolean;
  isBaPersona: boolean;
  personaName: string;
  personaColour: string;
  onBranch?: (sourceIndex: number) => void;
  onReuseMessage: (sourceIndex: number, content: string) => void;
  changesRepos: RepoInfo[];
  changesPreferredRepoId?: string | null;
  error: string | null;
  errorRetryLabel?: string;
  errorProviders: ChatErrorProviderOption[];
  onErrorRetry?: () => void;
  onSwitchProvider?: (provider: AgentProvider) => void;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
  onJumpToLatest: () => void;
  /** Message ids with a pre-turn checkpoint (rewind available). */
  checkpointIds?: ReadonlySet<string>;
  onRewind?: (messageId: string) => void;
  /** Inline edit of a sent message; resends in a new branch. */
  onEditResend?: (
    sourceIndex: number,
    messageId: string | undefined,
    text: string,
    restoreFiles: boolean,
    attachments?: ChatAttachment[],
  ) => Promise<boolean>;
  /** Resends the latest request (shown on the last settled answer). */
  onRetry?: (content: string, attachments?: ChatAttachment[]) => void;
}

/**
 * Scrollable transcript column — extracted from ChatView (Phase 5 split).
 * Hosts the derived pane state (blocked/scaffold/empty/pick-item), the turn
 * list with per-turn change footers (CH2), the classified error notice
 * (CH5), and the jump-to-latest pill.
 */
export function ChatTranscript({
  paneKind,
  hasEarlier,
  loadingEarlier,
  onLoadEarlier,
  scrollScopeKey,
  scaffoldRootPath,
  blockedReason,
  onOpenWorkspace,
  personaId,
  hasRepos,
  hasGovernanceDocs,
  isDbExpertPersona,
  starterPrompts,
  onSuggestionClick,
  scaffoldBusyMessage,
  turns,
  activeThreadId,
  changeReviewThreadId,
  busy,
  isBaPersona,
  personaName,
  personaColour,
  onBranch,
  onReuseMessage,
  changesRepos,
  changesPreferredRepoId,
  error,
  errorRetryLabel,
  errorProviders,
  onErrorRetry,
  onSwitchProvider,
  messagesContainerRef,
  messagesEndRef,
  showJumpToLatest,
  onJumpToLatest,
  checkpointIds,
  onRewind,
  onEditResend,
  onRetry,
}: ChatTranscriptProps) {
  const delegations = useThreadDelegations(paneKind === 'transcript' ? activeThreadId : null);
  const placedDelegations = useMemo(
    () => placeDelegationsInTurns(delegations.runs, turns),
    [delegations.runs, turns],
  );
  const [reviewRequest, setReviewRequest] = useState<{
    threadId: string | null;
    turnKey: string;
    filePath: string;
    requestId: number;
  } | null>(null);
  const reviewRequestSequence = useRef(0);
  const pendingQuestionTarget = getPendingQuestionTarget(turns);
  const centered = paneKind !== 'transcript';
  const collectLaterPaths = useMemo(createLaterEditedPathsCollector, []);
  const laterEditedPathsByTurn = useMemo(
    () => collectLaterPaths(turns),
    [collectLaterPaths, turns],
  );
  const requestFileReview = useCallback(
    (turnKey: string, filePath: string) => {
      reviewRequestSequence.current += 1;
      setReviewRequest({
        threadId: activeThreadId,
        turnKey,
        filePath,
        requestId: reviewRequestSequence.current,
      });
    },
    [activeThreadId],
  );

  return (
    <DelegationViewState key={activeThreadId}>
      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesContainerRef}
          role="region"
          aria-label="Chat transcript"
          data-chat-scroll-container
          tabIndex={0}
          className={`h-full overflow-y-auto overscroll-none [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${centered ? 'flex' : ''}`}
        >
          <div
            data-chat-transcript-content
            className={`mx-auto w-full max-w-[1040px] px-4 xl:px-6 ${
              centered
                ? 'flex min-h-full flex-1 items-center justify-center py-6'
                : 'flex flex-col pb-8 pt-6'
            }`}
          >
            <ChatPaneState
              kind={paneKind}
              scaffoldRootPath={scaffoldRootPath}
              blockedReason={blockedReason}
              onOpenWorkspace={onOpenWorkspace}
              personaId={personaId}
              hasRepos={hasRepos}
              hasGovernanceDocs={hasGovernanceDocs}
              isDbExpertPersona={isDbExpertPersona}
              starterPrompts={starterPrompts}
              onSuggestionClick={onSuggestionClick}
            />

            {scaffoldBusyMessage && (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-info/20 bg-info/5 px-4 py-3">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-info" />
                <p className="text-sm text-text-primary leading-relaxed">{scaffoldBusyMessage}</p>
              </div>
            )}

            {hasEarlier && (
              <button
                type="button"
                disabled={loadingEarlier}
                onClick={onLoadEarlier}
                className="mx-auto mb-4 block rounded-md border border-border px-3 py-2 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
              </button>
            )}
            {turns.length > 0 && (
              <VirtualChatTurns
                key={`turns:${activeThreadId ?? 'new'}`}
                turns={turns}
                scopeKey={scrollScopeKey ?? activeThreadId}
                containerRef={messagesContainerRef}
                pendingTurnKey={pendingQuestionTarget?.turnKey}
                renderTurn={(turn, turnIndex, searchActive) => (
                  <ChatTranscriptTurn
                    key={`${activeThreadId ?? 'new'}:${turn.key}`}
                    turn={turn}
                    turnIndex={turnIndex}
                    searchActive={searchActive}
                    activeThreadId={activeThreadId}
                    changeReviewThreadId={changeReviewThreadId}
                    busy={busy && turnIndex === turns.length - 1}
                    threadBusy={busy}
                    isBaPersona={isBaPersona}
                    personaName={personaName}
                    personaColour={personaColour}
                    onBranch={onBranch}
                    onReuseMessage={onReuseMessage}
                    changesRepos={changesRepos.length ? changesRepos : EMPTY_REPOS}
                    changesPreferredRepoId={changesPreferredRepoId}
                    pendingQuestionTarget={
                      pendingQuestionTarget?.turnKey === turn.key ? pendingQuestionTarget : null
                    }
                    laterTurnEditedPaths={laterEditedPathsByTurn.get(turn.key)}
                    reviewRequest={
                      reviewRequest?.threadId === activeThreadId &&
                      reviewRequest.turnKey === turn.key
                        ? reviewRequest
                        : undefined
                    }
                    requestFileReview={requestFileReview}
                    delegationRuns={placedDelegations.byTurn.get(turn.key)}
                    onRefreshDelegations={delegations.refresh}
                    isLastTurn={turnIndex === turns.length - 1}
                    hasCheckpoint={Boolean(turn.user?.id && checkpointIds?.has(turn.user.id))}
                    onRewind={onRewind}
                    onEditResend={onEditResend}
                    onRetry={onRetry}
                  />
                )}
              />
            )}

            {activeThreadId && paneKind === 'transcript' && (
              <div className="mt-6">
                <ChatDelegationList
                  threadId={activeThreadId}
                  runs={placedDelegations.unplaced}
                  error={delegations.error}
                  onRefresh={delegations.refresh}
                  label={turns.length > 0 ? 'Earlier delegated work' : 'Delegated work'}
                />
              </div>
            )}
            {error && (
              <ChatErrorNotice
                error={error}
                retryLabel={errorRetryLabel}
                providers={errorProviders}
                onRetry={onErrorRetry}
                onSwitchProvider={onSwitchProvider}
              />
            )}
          </div>
          <div ref={messagesEndRef} />
        </div>
        {showJumpToLatest && turns.length > 0 && (
          <button
            type="button"
            aria-label="Jump to latest messages"
            onClick={onJumpToLatest}
            className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary shadow-lg transition-colors hover:border-accent/40 hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <ArrowDown size={13} />
            {busy ? 'Jump to the running turn' : 'Jump to latest'}
          </button>
        )}
      </div>
    </DelegationViewState>
  );
}

type ChatTranscriptTurnProps = Pick<
  ChatTranscriptProps,
  | 'activeThreadId'
  | 'changeReviewThreadId'
  | 'busy'
  | 'isBaPersona'
  | 'personaName'
  | 'personaColour'
  | 'onBranch'
  | 'onReuseMessage'
  | 'changesRepos'
  | 'changesPreferredRepoId'
  | 'onRewind'
  | 'onEditResend'
  | 'onRetry'
> & {
  threadBusy: boolean;
  delegationRuns?: ChatDelegationRun[];
  onRefreshDelegations: () => Promise<void>;
  isLastTurn: boolean;
  hasCheckpoint: boolean;
  turn: ComposedChatTurn;
  turnIndex: number;
  searchActive?: boolean;
  pendingQuestionTarget: ChatQuestionTarget | null;
  laterTurnEditedPaths?: string[];
  reviewRequest?: { requestId: number; filePath: string };
  requestFileReview: (turnKey: string, filePath: string) => void;
};

// A streamed delta updates the live turn; settled turns retain their DOM and state.
const ChatTranscriptTurn = memo(function ChatTranscriptTurn({
  turn,
  turnIndex,
  searchActive = false,
  activeThreadId,
  changeReviewThreadId,
  busy,
  isBaPersona,
  personaName,
  personaColour,
  onBranch,
  onReuseMessage,
  changesRepos,
  changesPreferredRepoId,
  pendingQuestionTarget,
  laterTurnEditedPaths,
  reviewRequest,
  requestFileReview,
  delegationRuns,
  onRefreshDelegations,
  isLastTurn,
  hasCheckpoint,
  threadBusy,
  onRewind,
  onEditResend,
  onRetry,
}: ChatTranscriptTurnProps) {
  const liveState = getChatTurnLiveState({
    busy,
    isLatest: true,
    hasWork: turn.work.length > 0,
    hasAnswer: Boolean(turn.answer),
    hasTrailingWork: turn.trailingWork.length > 0,
  });
  const turnComplete = liveState === null;
  const timeline = buildChatTurnTimeline(turn);
  const lastWorkIndex = timeline.findLastIndex((item) => item.kind === 'work');
  const runSummary = summarizeChatTurnRun(turn, {
    busy,
    pendingTarget: pendingQuestionTarget,
  });
  const turnChanges = turnComplete
    ? summarizeTurnChanges([...turn.work, ...turn.trailingWork])
    : null;
  const showChangesFooter = Boolean(
    turnComplete && turnChanges && (turn.answer || turn.runOutcome || runSummary?.changes),
  );
  const userEntry = turn.user;
  const userMessageId = userEntry?.id;
  const canRetry = Boolean(
    onRetry &&
    isLastTurn &&
    turnComplete &&
    (userEntry?.content.trim() || userEntry?.attachments?.length),
  );

  return (
    <section
      key={`${activeThreadId ?? 'new'}:${turn.key}`}
      data-chat-turn-key={turn.key}
      data-chat-search-active={searchActive || undefined}
      className={`w-full space-y-4 ${searchActive ? 'rounded-sm outline outline-1 outline-offset-4 outline-accent/50' : ''}`}
      aria-label={`Turn ${turnIndex + 1}`}
    >
      {userEntry && (
        <UserMessage
          content={userEntry.content}
          attachments={userEntry.attachments}
          delivery={userEntry.delivery}
          deliveryError={userEntry.deliveryError}
          deliveryIntent={userEntry.deliveryIntent}
          timestamp={userEntry.timestamp}
          onEdit={() => onReuseMessage(userEntry.sourceIndex, userEntry.content)}
          onEditResend={
            onEditResend && userEntry.delivery !== 'failed'
              ? (text, restoreFiles) =>
                  onEditResend(
                    userEntry.sourceIndex,
                    userMessageId,
                    text,
                    restoreFiles,
                    userEntry.attachments,
                  )
              : undefined
          }
          editResendDisabled={threadBusy}
          onRewind={
            onRewind && hasCheckpoint && userMessageId && !threadBusy
              ? () => onRewind(userMessageId)
              : undefined
          }
          onBranch={onBranch ? () => onBranch(userEntry.sourceIndex) : undefined}
        />
      )}
      {timeline.map((item, index) => {
        if (item.kind === 'work') {
          const currentWork = index === lastWorkIndex;
          return (
            <TurnWorkMessage
              key={item.key}
              items={item.items}
              disclosureId={`work-${item.sourceIndex - (turn.user?.sourceIndex ?? 0)}`}
              active={currentWork && liveState !== null}
              outcome={turnComplete ? turn.runOutcome : undefined}
              waiting={currentWork && runSummary?.state === 'awaiting-user'}
              answering={liveState === 'responding'}
              startedAt={turn.startedAt}
              endedAt={turn.endedAt}
            />
          );
        }
        if (item.kind === 'pending-message')
          return (
            <UserMessage
              key={item.key}
              disclosureId={item.key}
              content={item.entry.content}
              attachments={item.entry.attachments}
              delivery={item.entry.delivery}
              deliveryError={item.entry.deliveryError}
              deliveryIntent={item.entry.deliveryIntent}
              onEdit={() => onReuseMessage(item.entry.sourceIndex, item.entry.content)}
            />
          );
        if (item.kind === 'surface') return <SurfaceHost key={item.key} intent={item.intent} />;
        if (item.kind === 'receipt')
          return (
            <div key={item.key} className="max-w-[72ch]">
              <QuestionIntentSurface intent={item.intent} />
            </div>
          );
        return (
          <TranscriptViewScope key={item.key} name={`reply-${item.key}`}>
            <AssistantMessage
              content={item.entry.content}
              transformContent={isBaPersona ? stripFindingMarkers : undefined}
              label={personaName}
              colour={personaColour}
              active={liveState === 'responding'}
              timestamp={item.entry.timestamp}
              onBranch={onBranch ? () => onBranch(item.entry.sourceIndex) : undefined}
              onRegenerate={
                canRetry && item.entry === turn.answer
                  ? () => onRetry!(userEntry!.content, userEntry!.attachments)
                  : undefined
              }
            />
          </TranscriptViewScope>
        );
      })}
      {lastWorkIndex < 0 && !turn.answer && liveState && (
        <TurnWorkMessage items={[]} active startedAt={turn.startedAt} />
      )}
      {activeThreadId && delegationRuns && delegationRuns.length > 0 && (
        <ChatDelegationList
          threadId={activeThreadId}
          runs={delegationRuns}
          onRefresh={onRefreshDelegations}
        />
      )}
      {runSummary && shouldShowRunOutcomeFooter(runSummary) && (
        <ChatRunOutcomeFooter
          summary={runSummary}
          repos={changesRepos}
          preferredRepoId={changesPreferredRepoId}
          hideChanges={showChangesFooter}
          onReviewFile={
            turnComplete ? (filePath) => requestFileReview(turn.key, filePath) : undefined
          }
        />
      )}
      {/* One turn-end row: changed files, review, and usage. */}
      {showChangesFooter ? (
        <TurnChangesFooter
          workItems={[...turn.work, ...turn.trailingWork]}
          repos={changesRepos}
          preferredRepoId={changesPreferredRepoId}
          threadId={changeReviewThreadId}
          turnId={turn.key}
          laterTurnEditedPaths={laterTurnEditedPaths}
          reviewRequest={reviewRequest}
          usage={turn.usage}
        />
      ) : (
        turnComplete && turn.usage && <TurnUsageFooter usage={turn.usage} />
      )}
    </section>
  );
});
