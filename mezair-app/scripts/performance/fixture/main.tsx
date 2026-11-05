import { useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { ChatTranscript } from '../../../src/renderer/components/chat/ChatTranscript';
import * as turnModel from '../../../src/renderer/components/chat/chat-turns';
import { useChatScroll } from '../../../src/renderer/components/chat/useChatScroll';
import type { ChatEntry } from '../../../src/renderer/contexts/ChatContext';
import type { RepoInfo } from '../../../src/shared/types';
import type { ChatErrorProviderOption } from '../../../src/renderer/components/chat/ChatErrorNotice';
import '../../../src/renderer/styles/global.css';

// Synthetic data only. No Electron bridge, account, repository or provider is used.
const noop = () => undefined;
const repos: RepoInfo[] = [];
const providers: ChatErrorProviderOption[] = [];
// The baseline predates the incremental composer. This same fixture can be
// copied into that checkout and still exercises its production composition path.
const makeComposer = () =>
  'createChatTurnComposer' in turnModel
    ? (turnModel.createChatTurnComposer as () => typeof turnModel.composeChatTurns)()
    : turnModel.composeChatTurns;

function Transcript({ entries }: { entries: ChatEntry[] }) {
  const compose = useMemo(makeComposer, []);
  const turns = useMemo(() => compose(entries, { active: true }), [compose, entries]);
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scroll = useChatScroll({
    containerRef,
    scopeKey: 'performance-fixture',
    contentReady: true,
    contentVersion: entries,
  });
  return (
    <div style={{ height: 800, display: 'flex', flexDirection: 'column' }}>
      <ChatTranscript
        paneKind="transcript"
        personaId="coder"
        hasRepos={false}
        hasGovernanceDocs={false}
        isDbExpertPersona={false}
        onSuggestionClick={noop}
        turns={turns}
        activeThreadId={null}
        busy
        isBaPersona={false}
        personaName="Coder"
        personaColour="#85b788"
        onReuseMessage={noop}
        changesRepos={repos}
        error={null}
        errorProviders={providers}
        messagesContainerRef={containerRef}
        messagesEndRef={endRef}
        showJumpToLatest={scroll.showJumpToLatest}
        onJumpToLatest={scroll.jumpToLatest}
      />
    </div>
  );
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
interface ScrollGeometrySnapshot {
  scrollTop: number;
  scrollHeight: number;
  turnContentTop: number;
  processingCardHeight: number;
}

function readScrollGeometry(
  container: HTMLElement,
  processingCard: HTMLElement,
  turn: HTMLElement,
): ScrollGeometrySnapshot {
  const containerTop = container.getBoundingClientRect().top;
  const turnTop = turn.getBoundingClientRect().top;
  return {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    turnContentTop: turnTop - containerTop + container.scrollTop,
    processingCardHeight: processingCard.getBoundingClientRect().height,
  };
}

function sameScrollGeometry(left: ScrollGeometrySnapshot, right: ScrollGeometrySnapshot): boolean {
  return (
    Math.abs(left.scrollTop - right.scrollTop) < 0.5 &&
    left.scrollHeight === right.scrollHeight &&
    Math.abs(left.turnContentTop - right.turnContentTop) < 0.5 &&
    Math.abs(left.processingCardHeight - right.processingCardHeight) < 0.5
  );
}

function formatScrollGeometry(geometry: ScrollGeometrySnapshot): string {
  return `scrollTop=${geometry.scrollTop.toFixed(2)}px, scrollHeight=${geometry.scrollHeight}px, turnContentTop=${geometry.turnContentTop.toFixed(2)}px, processingCardHeight=${geometry.processingCardHeight.toFixed(2)}px`;
}

async function waitForStableExpandedGeometry(
  container: HTMLElement,
  disclosure: HTMLButtonElement,
  processingCard: HTMLElement,
  turn: HTMLElement,
  label: string,
  referenceScrollTop?: number,
): Promise<{ geometry: ScrollGeometrySnapshot; maxScrollDeviation: number }> {
  let previous = readScrollGeometry(container, processingCard, turn);
  let stableFrames = 0;
  let maxScrollDeviation =
    referenceScrollTop === undefined ? 0 : Math.abs(previous.scrollTop - referenceScrollTop);

  // The virtualizer batches ResizeObserver measurements through animation frames.
  // Require several stable snapshots so expansion and streaming don't overlap that correction.
  for (let frameNumber = 0; frameNumber < 24; frameNumber += 1) {
    await frame();
    if (!disclosure.isConnected || !processingCard.isConnected || !turn.isConnected) {
      throw new Error(`${label} target detached before geometry settled.`);
    }
    if (disclosure.getAttribute('aria-expanded') !== 'true') {
      throw new Error(`${label} disclosure closed before geometry settled.`);
    }

    const current = readScrollGeometry(container, processingCard, turn);
    if (referenceScrollTop !== undefined) {
      maxScrollDeviation = Math.max(
        maxScrollDeviation,
        Math.abs(current.scrollTop - referenceScrollTop),
      );
    }
    stableFrames = sameScrollGeometry(previous, current) ? stableFrames + 1 : 0;
    if (stableFrames >= 3) return { geometry: current, maxScrollDeviation };
    previous = current;
  }

  throw new Error(`${label} did not settle within 24 frames (${formatScrollGeometry(previous)}).`);
}

const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ];

function history(count = 100): ChatEntry[] {
  const entries: ChatEntry[] = [];
  for (let turn = 0; turn < count; turn++) {
    entries.push({ kind: 'user', id: `user-${turn}`, content: `Review request ${turn + 1}.` });
    for (let action = 0; action < 30; action++) {
      entries.push({
        kind: 'event',
        event: {
          type: 'command_exec',
          command: `pnpm verify --check=${action}`,
          exitCode: 0,
          output: 'Verified the synthetic input.\n'.repeat(30),
          toolStatus: 'completed',
        },
      });
    }
    entries.push({
      kind: 'assistant',
      id: `answer-${turn}`,
      phase: 'final',
      content:
        `Completed request ${turn + 1}.\n\n` +
        '- Checked the current behaviour and the expected result.\n'.repeat(8) +
        '\n**Validation:** all synthetic checks passed.\n',
    });
    if (turn < count - 1)
      entries.push({ kind: 'event', event: { type: 'turn_outcome', turnOutcome: 'completed' } });
  }
  return entries;
}

const root = createRoot(document.getElementById('root')!);
Object.assign(window, {
  async runPerformanceScenario(options: { turns?: number } = {}) {
    const turnCount = options.turns ?? 100;
    if (!Number.isSafeInteger(turnCount) || turnCount < 1)
      throw new Error('Performance history must contain a positive integer number of turns.');
    let entries = history(turnCount);
    const render = () =>
      flushSync(() =>
        root.render(
          <MemoryRouter>
            <Transcript entries={entries} />
          </MemoryRouter>,
        ),
      );
    const initialStart = performance.now();
    render();
    const mountMs = performance.now() - initialStart;
    await frame();
    await frame();
    const samples: number[] = [];
    for (let tick = 0; tick < 60; tick++) {
      entries = [...entries];
      const previous = entries[entries.length - 1] as Extract<ChatEntry, { kind: 'assistant' }>;
      entries[entries.length - 1] = { ...previous, content: `${previous.content} next` };
      const start = performance.now();
      render();
      samples.push(performance.now() - start);
      await frame();
    }
    const container = document.querySelector<HTMLElement>('[aria-label="Chat transcript"]')!;
    container.scrollTop = container.scrollHeight * 0.6;
    await frame();
    await frame();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    let turnRectReads = 0;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.dataset.chatTurnKey) turnRectReads++;
      return originalRect.call(this);
    };
    for (let event = 0; event < 20; event++) container.dispatchEvent(new Event('scroll'));
    await frame();
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    const compose = makeComposer();
    const prior = compose(entries, { active: true });
    const composeSamples: number[] = [];
    let retainedTurns = 0;
    const composeBatchStart = performance.now();
    for (let tick = 0; tick < 200; tick++) {
      const next = [...entries];
      const last = next[next.length - 1] as Extract<ChatEntry, { kind: 'assistant' }>;
      next[next.length - 1] = { ...last, content: `${last.content} ${tick}` };
      const start = performance.now();
      const turns = compose(next, { active: true });
      composeSamples.push(performance.now() - start);
      if (tick === 0) retainedTurns = turns.filter((turn, index) => turn === prior[index]).length;
    }
    const composeBatchMs = performance.now() - composeBatchStart;
    Object.assign(window, {
      async checkTranscript() {
        const check = (condition: boolean, message: string) => {
          if (!condition) throw new Error(message);
        };
        const changeLiveAnswer = () => {
          const last = entries[entries.length - 1] as Extract<ChatEntry, { kind: 'assistant' }>;
          entries = [...entries.slice(0, -1), { ...last, content: `${last.content} more` }];
          render();
        };
        const expand = document.querySelector<HTMLButtonElement>(
          'button[aria-label^="Expand processing"]',
        )!;
        const processingCard = expand.closest<HTMLElement>('.processing-card');
        const expandedTurn = expand.closest<HTMLElement>('[data-chat-turn-key]');
        check(Boolean(processingCard && expandedTurn), 'Expanded processing must belong to a turn');
        expand.click();
        const expansionLayout = await waitForStableExpandedGeometry(
          container,
          expand,
          processingCard!,
          expandedTurn!,
          'Processing expansion',
        );
        check(
          document.querySelectorAll('.processing-item').length === 30,
          'Expanded work must mount its 30 operations',
        );
        const startTop = expansionLayout.geometry.scrollTop;
        changeLiveAnswer();
        const streamingLayout = await waitForStableExpandedGeometry(
          container,
          expand,
          processingCard!,
          expandedTurn!,
          'Streaming update',
          startTop,
        );
        check(
          document.querySelectorAll('.processing-item').length === 30,
          'Streaming must preserve expanded history',
        );
        check(
          Math.abs(streamingLayout.geometry.scrollTop - startTop) < 2 &&
            streamingLayout.maxScrollDeviation < 2,
          `Streaming must preserve a reader’s scroll offset (start=${startTop.toFixed(2)}px, settled=${streamingLayout.geometry.scrollTop.toFixed(2)}px, maxDeviation=${streamingLayout.maxScrollDeviation.toFixed(2)}px, before=${formatScrollGeometry(expansionLayout.geometry)}, after=${formatScrollGeometry(streamingLayout.geometry)}).`,
        );
        const latest = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
          button.textContent?.includes('Jump to live work'),
        );
        check(Boolean(latest), 'An unpinned reader must have a jump-to-live control');
        latest!.click();
        await frame();
        await frame();
        check(
          container.scrollHeight - container.scrollTop - container.clientHeight < 2,
          'Jump to live must reach the bottom',
        );
        changeLiveAnswer();
        await frame();
        await frame();
        check(
          container.scrollHeight - container.scrollTop - container.clientHeight < 2,
          'Pinned streaming must follow the live answer',
        );
        entries = [{ kind: 'user', id: 'replacement', content: 'Replacement thread' }];
        render();
        await frame();
        await frame();
        check(
          document.querySelectorAll('[data-chat-turn-key]').length === 1,
          'Thread replacement must release old turns',
        );
        return [
          'expand operations',
          'preserve expansion during streaming',
          'preserve reader offset',
          'jump to live',
          'follow pinned response',
          'replace history',
        ];
      },
    });
    return {
      mountMs,
      streamMedianMs: percentile(samples, 0.5),
      streamP95Ms: percentile(samples, 0.95),
      composeMedianMs: percentile(composeSamples, 0.5),
      composeBatchMs,
      retainedTurns,
      domElements: document.querySelectorAll('*').length,
      hiddenWorkRows: document.querySelectorAll('.processing-item[hidden]').length,
      turnRectReads,
      turns: turnCount,
      actionsPerTurn: 30,
      streamUpdates: 60,
    };
  },
  async checkAdvanced() {
    flushSync(() => root.render(null));
    return (await import('./advanced-checks')).checkAdvanced();
  },
  async checkNativeHighlight() {
    const { highlightCode } = await import('../../../src/renderer/components/chat/shiki');
    const html = await highlightCode('const nativeProbe: string = "ready";', 'ts');
    if (!html.includes('color') || !html.includes('span'))
      throw new Error('Native syntax worker did not highlight.');
    return 'Native packaged renderer syntax highlighting passed';
  },
  async checkDashboard() {
    return (await import('./dashboard-checks')).checkDashboard();
  },
});
