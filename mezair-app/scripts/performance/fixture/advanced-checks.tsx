import { lazy, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { ChatTranscript } from '../../../src/renderer/components/chat/ChatTranscript';
import { createChatTurnComposer } from '../../../src/renderer/components/chat/chat-turns';
import { useChatScroll } from '../../../src/renderer/components/chat/useChatScroll';
import { MarkdownRenderer } from '../../../src/renderer/components/chat/MarkdownRenderer';
import { MessageStreamingContext } from '../../../src/renderer/components/chat/surface-fences';
import {
  highlightCode,
  disposeHighlightResources,
} from '../../../src/renderer/components/chat/shiki';
import { ArtifactPreview } from '../../../src/renderer/components/chat/ArtifactPreview';
import type { ChatArtifact } from '../../../src/shared/types';
import { SketchFrame } from '../../../src/renderer/components/surfaces/kinds/sketch/SketchFrame';
import { preloadable } from '../../../src/renderer/utils/preloadable';
import {
  ErrorBoundary,
  DeferredLoadError,
} from '../../../src/renderer/components/layout/ErrorBoundary';
import { ChatInput } from '../../../src/renderer/components/chat/ChatInput';
import type { ChatEntry } from '../../../src/renderer/contexts/ChatContext';
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (count = 5) => {
  for (let n = 0; n < count; n++) await frame();
};

interface RichPreviewSnapshot {
  iframeCount: number;
  sketchFrameCount: number;
  pdfFrameCount: number;
  pdfUrlMatches: boolean;
  urlCount: number;
  observerCount: number;
  previewText: string;
}

function readRichPreviewSnapshot(
  host: HTMLElement,
  urls: ReadonlySet<string>,
  observers: ReadonlySet<MutationObserver>,
): RichPreviewSnapshot {
  const iframes = [...host.querySelectorAll<HTMLIFrameElement>('iframe')];
  const sketchFrames = iframes.filter((iframe) => iframe.title === 'Lifecycle probe');
  const pdfFrames = iframes.filter((iframe) => iframe.title === 'Lifecycle PDF');
  const pdfSource = pdfFrames[0]?.getAttribute('src');
  return {
    iframeCount: iframes.length,
    sketchFrameCount: sketchFrames.length,
    pdfFrameCount: pdfFrames.length,
    pdfUrlMatches: pdfFrames.length === 1 && Boolean(pdfSource && urls.has(pdfSource)),
    urlCount: urls.size,
    observerCount: observers.size,
    previewText: (host.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
}

function formatRichPreviewSnapshot(snapshot: RichPreviewSnapshot): string {
  return `iframes=${snapshot.iframeCount} (sketch=${snapshot.sketchFrameCount}, pdf=${snapshot.pdfFrameCount}), pdfUrlMatches=${snapshot.pdfUrlMatches}, blobUrls=${snapshot.urlCount}, observers=${snapshot.observerCount}, text=${JSON.stringify(snapshot.previewText)}`;
}

async function waitForRichPreviewReadiness(
  host: HTMLElement,
  urls: ReadonlySet<string>,
  observers: ReadonlySet<MutationObserver>,
  cycle: number,
): Promise<RichPreviewSnapshot> {
  let snapshot = readRichPreviewSnapshot(host, urls, observers);
  for (let frameNumber = 0; frameNumber <= 120; frameNumber += 1) {
    if (isRichPreviewReady(snapshot)) return snapshot;
    if (frameNumber < 120) await frame();
    snapshot = readRichPreviewSnapshot(host, urls, observers);
  }
  throw new Error(
    `Rich preview cycle ${cycle + 1} did not become ready within 120 frames (${formatRichPreviewSnapshot(snapshot)}).`,
  );
}

function isRichPreviewReady(snapshot: RichPreviewSnapshot): boolean {
  return (
    snapshot.iframeCount === 2 &&
    snapshot.sketchFrameCount === 1 &&
    snapshot.pdfFrameCount === 1 &&
    snapshot.pdfUrlMatches &&
    snapshot.urlCount === 1 &&
    snapshot.observerCount === 1
  );
}

const noop = () => undefined;
const empty: never[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
export async function checkAdvanced() {
  Object.assign(window.mezair, {
    voice: { onResult: () => noop, onError: () => noop, onStatus: () => noop },
    chat: { listDelegations: async () => [] },
  });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b1020';
  document.body.append(host);
  const root = createRoot(host);
  const passed: string[] = [];
  let busy = true;
  let entries: ChatEntry[] = Array.from(
    { length: 1000 },
    (_, n) =>
      [
        { kind: 'user', id: `vuser-${n}`, content: `History request ${n}` },
        {
          kind: 'event',
          event: {
            type: 'command_exec',
            command: 'synthetic',
            exitCode: 0,
            toolStatus: 'completed',
            output: 'done',
          },
        },
        {
          kind: 'assistant',
          id: `vanswer-${n}`,
          phase: 'final',
          content: `Answer ${n}\n\n${'Variable-height paragraph. '.repeat((n % 9) + 1)}`,
        },
      ] as ChatEntry[],
  ).flat();
  function Transcript() {
    const [compose, scrollRef, endRef] = [
      useMemo(createChatTurnComposer, []),
      useRef<HTMLDivElement>(null),
      useRef<HTMLDivElement>(null),
    ];
    const scroll = useChatScroll({
      containerRef: scrollRef,
      scopeKey: 'virtual-check',
      contentVersion: entries,
      contentReady: true,
    });
    return (
      <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
        <ChatTranscript
          paneKind="transcript"
          personaId="coder"
          hasRepos={false}
          hasGovernanceDocs={false}
          isDbExpertPersona={false}
          onSuggestionClick={noop}
          turns={compose(entries, { active: busy })}
          activeThreadId="virtual-check"
          busy={busy}
          isBaPersona={false}
          personaName="Coder"
          personaColour="#85b788"
          onReuseMessage={noop}
          changesRepos={empty}
          error={null}
          errorProviders={empty}
          messagesContainerRef={scrollRef}
          messagesEndRef={endRef}
          showJumpToLatest={scroll.showJumpToLatest}
          onJumpToLatest={scroll.jumpToLatest}
        />
      </div>
    );
  }
  const render = () =>
    flushSync(() =>
      root.render(
        <MemoryRouter>
          <Transcript />
        </MemoryRouter>,
      ),
    );
  const checkLatestStability = async (container: HTMLElement, label: string) => {
    container.scrollTop = container.scrollHeight;
    await settle(12);
    const overscroll = getComputedStyle(container).overscrollBehaviorY;
    const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    let writes = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get() {
        return scrollTop.get!.call(this);
      },
      set(value: number) {
        writes++;
        scrollTop.set!.call(this, value);
      },
    });
    try {
      // Transcript updates can retain the same rendered height. Writing the
      // existing offset still interrupts native trackpad momentum on macOS.
      const row = [...container.querySelectorAll<HTMLElement>('[data-chat-turn-key]')].at(-1)!;
      const bottom = row.getBoundingClientRect().bottom;
      for (let tick = 0; tick < 30; tick++) {
        entries = [...entries];
        render();
        await frame();
        check(
          container.querySelectorAll('[data-chat-turn-window]').length === 1,
          `${label}: a transcript update must retain exactly one turn list`,
        );
        check(
          Math.abs(row.getBoundingClientRect().bottom - bottom) <= 1,
          `${label}: the latest message must stay still across unchanged-height updates`,
        );
      }
      check(
        writes === 0 && overscroll === 'none',
        `${label}: unchanged layout rewrote scrollTop ${writes} times; overscroll is ${overscroll}`,
      );
    } finally {
      Reflect.deleteProperty(container, 'scrollTop');
    }
    const latestRow = () =>
      [...container.querySelectorAll<HTMLElement>('[data-chat-turn-key]')].at(-1)!;
    const previousHeight = latestRow().getBoundingClientRect().height;
    const growthMarker = 'Scroll stability response growth';
    const last = entries.at(-1) as Extract<ChatEntry, { kind: 'assistant' }>;
    entries = [
      ...entries.slice(0, -1),
      {
        ...last,
        content: `${last.content}\n\n${growthMarker}\n\n${'A growing response.\n\n'.repeat(10)}`,
      },
    ];
    render();
    await settle(12);
    check(
      latestRow().textContent?.includes(growthMarker) &&
        latestRow().getBoundingClientRect().height > previousHeight,
      `${label}: the appended response must render and grow before checking its scroll position`,
    );
    check(
      Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) <= 1,
      `${label}: a response that grows must still follow latest`,
    );
    passed.push(
      `${label}: stable latest without redundant scroll writes; growing response follows`,
    );
  };
  try {
    render();
    await settle();
    const container = host.querySelector<HTMLElement>('[aria-label="Chat transcript"]')!;
    check(
      host.querySelectorAll('[data-chat-turn-key]').length > 0 &&
        host.querySelectorAll('[data-chat-turn-key]').length < 30,
      `1,000 turns must retain 1–29 mounted rows; got ${host.querySelectorAll('[data-chat-turn-key]').length}; viewport ${container.clientHeight}; list ${host.querySelector<HTMLElement>('[data-chat-turn-window]')?.style.height}; scroll ${container.scrollTop}/${container.scrollHeight}`,
    );
    passed.push('1,000 variable-height turns windowed');
    await checkLatestStability(container, 'virtualized chat');
    const row = host.querySelector<HTMLElement>('[data-chat-turn-key]')!;
    const key = row.dataset.chatTurnKey!;
    const expand = row.querySelector<HTMLButtonElement>('[aria-label^="Expand processing"]')!;
    expand.click();
    await settle();
    expand.focus();
    const text = document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode()!;
    const selection = document.getSelection()!,
      range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
    const selected = selection.toString();
    container.scrollTop = 0;
    await settle();
    check(
      row.isConnected && document.activeElement === expand && selection.toString() === selected,
      'Selection and keyboard focus must survive window changes',
    );
    passed.push('selection and focus pinned across scroll');
    selection.removeAllRanges();
    expand.blur();
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new FocusEvent('focusin'));
    await settle();
    window.dispatchEvent(new CustomEvent('mezair:reveal-transcript', { detail: { turnKey: key } }));
    await settle(12);
    const restored = [...host.querySelectorAll<HTMLElement>('[data-chat-turn-key]')].find(
      (item) => item.dataset.chatTurnKey === key,
    )!;
    check(
      restored?.querySelector('.processing-item'),
      'Explicit disclosure choice must survive unmount/remount',
    );
    passed.push('work disclosure retained across remount');
    // Keep the currently visible turn fixed when older pages arrive.
    const visible = [...host.querySelectorAll<HTMLElement>('[data-chat-turn-key]')].find(
      (item) => item.getBoundingClientRect().bottom > container.getBoundingClientRect().top + 40,
    )!;
    const beforeTop = visible.getBoundingClientRect().top,
      visibleKey = visible.dataset.chatTurnKey;
    entries = [
      { kind: 'user', id: 'prepended-user', content: 'Earlier page' },
      { kind: 'assistant', id: 'prepended-answer', content: 'Earlier answer' },
      ...entries,
    ];
    render();
    await settle(10);
    const anchored = [...host.querySelectorAll<HTMLElement>('[data-chat-turn-key]')].find(
      (item) => item.dataset.chatTurnKey === visibleKey,
    )!;
    check(
      anchored && Math.abs(anchored.getBoundingClientRect().top - beforeTop) < 3,
      'Prepending an earlier page must retain the visible anchor',
    );
    passed.push('prepend preserves reading anchor');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Find in loaded conversation"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'History request 20',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(15);
    check(
      [...host.querySelectorAll('[data-chat-turn-key]')].some((item) =>
        item.textContent?.includes('History request 20'),
      ),
      'Find must reveal offscreen matches',
    );
    passed.push('find reveals loaded offscreen turns');
    busy = false;
    entries = [
      { kind: 'user', id: 'short-user', content: 'A short conversation' },
      {
        kind: 'assistant',
        id: 'short-answer',
        phase: 'final',
        content: 'A paragraph in the latest response.\n\n'.repeat(50),
      },
    ];
    render();
    await settle(12);
    await checkLatestStability(container, 'short settled chat');
    root.render(null);
    await settle();
    let loads = 0;
    const intent = preloadable(async () => {
      loads++;
      return 1;
    });
    check(loads === 0, 'No startup preloading');
    intent.warm();
    await intent.load();
    check(loads === 1, 'Intent preload and opening share one import');
    passed.push('intent-only import coalescing');
    let composerRenders = 0;
    Object.assign(globalThis, {
      __MEZAIR_PERF_RENDER_COUNTS__: () => {
        composerRenders++;
      },
    });
    const onSend = async () => true;
    const renderComposer = (tick: number) =>
      flushSync(() =>
        root.render(
          <>
            <p>{tick}</p>
            <ChatInput onSend={onSend} onStop={noop} busy disabled={false} />
          </>,
        ),
      );
    renderComposer(0);
    await settle();
    check(composerRenders > 0, 'Composer render instrumentation must observe the initial mount');
    composerRenders = 0;
    for (let n = 1; n <= 60; n++) renderComposer(n);
    check(
      composerRenders === 0,
      'Stable composer props must cause zero component renders across 60 transcript updates',
    );
    passed.push('zero composer component renders across 60 transcript updates');
    Reflect.deleteProperty(globalThis, '__MEZAIR_PERF_RENDER_COUNTS__');
    const full =
      Array.from(
        { length: 100 },
        (_, n) => `## Block ${n}\n\nA completed paragraph with **formatting** and a link.\n\n`,
      ).join('') +
      '```ts\n' +
      'const value = 1;\n'.repeat(200) +
      '```\n\nTail';
    let content = full;
    const markdown = () =>
      flushSync(() =>
        root.render(
          <MessageStreamingContext.Provider value>
            <MarkdownRenderer content={content} />
          </MessageStreamingContext.Provider>,
        ),
      );
    markdown();
    await settle();
    const stable = host.querySelector('h2');
    const samples: number[] = [];
    for (let n = 0; n < 60; n++) {
      content += ' next';
      const start = performance.now();
      markdown();
      samples.push(performance.now() - start);
      await frame();
    }
    check(
      host.querySelector('h2') === stable,
      'Completed Markdown blocks must retain DOM identity',
    );
    passed.push('completed Markdown DOM retained with long code');
    const html = await highlightCode('const greeting: string = "hello";', 'ts');
    check(
      html.includes('span') && html.includes('color'),
      'Module worker must produce syntax highlighting',
    );
    passed.push('real worker syntax highlighting');
    // Account for resources owned by the mounted components, not browser internals.
    const created = URL.createObjectURL,
      revoked = URL.revokeObjectURL;
    const urls = new Set<string>();
    URL.createObjectURL = (blob) => {
      const url = created(blob);
      urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      urls.delete(url);
      revoked(url);
    };
    Object.assign(window.mezair, {
      chat: {
        readArtifactFile: async () => ({
          name: 'probe.pdf',
          mimeType: 'application/pdf',
          size: 15,
          dataBase64: btoa('%PDF-1.4\n%%EOF'),
        }),
      },
    });
    const artifact: ChatArtifact = {
      id: 'lifecycle-pdf',
      threadId: 'fixture',
      kind: 'pdf',
      title: 'Lifecycle PDF',
      content: '',
      version: 1,
      createdAt: '',
      updatedAt: '',
    } as ChatArtifact;
    const OriginalObserver = window.MutationObserver;
    const observers = new Set<MutationObserver>();
    window.MutationObserver = class extends OriginalObserver {
      observe(target: Node, options?: MutationObserverInit) {
        observers.add(this);
        super.observe(target, options);
      }
      disconnect() {
        observers.delete(this);
        super.disconnect();
      }
    };
    try {
      for (let cycle = 0; cycle < 30; cycle++) {
        flushSync(() =>
          root.render(
            <>
              <SketchFrame html="<p>Lifecycle probe</p>" title="Lifecycle probe" />
              <ArtifactPreview artifact={artifact} mode="preview" />
            </>,
          ),
        );
        const mounted = await waitForRichPreviewReadiness(host, urls, observers, cycle);
        check(
          mounted.iframeCount === 2 &&
            mounted.sketchFrameCount === 1 &&
            mounted.pdfFrameCount === 1 &&
            mounted.pdfUrlMatches &&
            mounted.urlCount === 1 &&
            mounted.observerCount === 1,
          `Rich previews must own one sketch frame and one PDF URL/frame (${formatRichPreviewSnapshot(mounted)}).`,
        );
        flushSync(() => root.render(null));
        await settle(2);
        const released = readRichPreviewSnapshot(host, urls, observers);
        check(
          released.iframeCount === 0 && released.urlCount === 0 && released.observerCount === 0,
          `Closing previews must release every frame and blob URL (${formatRichPreviewSnapshot(released)}).`,
        );
      }
    } finally {
      URL.createObjectURL = created;
      URL.revokeObjectURL = revoked;
      window.MutationObserver = OriginalObserver;
    }
    disposeHighlightResources();
    passed.push('30 rich preview cycles release frames, blob URLs and theme observers');
    let closed = false;
    const Broken = lazy(() => Promise.reject(new Error('Synthetic lazy import failure')));
    flushSync(() =>
      root.render(
        <>
          <p>Shell still available</p>
          <ErrorBoundary
            fallback={
              <DeferredLoadError
                label="Probe"
                onClose={() => {
                  closed = true;
                }}
              />
            }
          >
            <Broken />
          </ErrorBoundary>
        </>,
      ),
    );
    await settle();
    check(
      host.textContent?.includes('Shell still available') && host.querySelector('[role=alert]'),
      'Failed deferred views must leave the shell mounted',
    );
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Close')!
      .click();
    check(closed, 'Failed optional views must remain dismissible');
    passed.push('failed deferred imports leave shell controls available');
    flushSync(() => root.render(null));
    const extra = await (await import('./extra-checks')).checkExtra();
    samples.sort((a, b) => a - b);
    return {
      passed,
      markdownP95Ms: samples[Math.floor(samples.length * 0.95)],
      composerRendersDuring60Updates: composerRenders,
      extra,
    };
  } finally {
    root.unmount();
    host.remove();
    disposeHighlightResources();
    document.getSelection()?.removeAllRanges();
    sessionStorage.removeItem('mezair:chat-scroll:virtual-check');
  }
}
