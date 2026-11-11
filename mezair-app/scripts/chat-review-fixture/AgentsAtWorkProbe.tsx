import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { RepoIndexProvider } from '../../src/renderer/contexts/RepoIndexContext';
import { ChatView } from '../../src/renderer/components/chat/ChatView';
import type { ChatEntry } from '../../src/renderer/contexts/ChatContext';
import { buildChatModelOptions } from '../../src/renderer/utils/chat-model-options';
import type { MezairAPI } from '../../src/shared/ipc-api';
import type {
  AgentProvider,
  ChatThread,
  CodexEvent,
  CodexSession,
  RepoInfo,
} from '../../src/shared/types';
import '../../src/renderer/styles/global.css';

/*
 * Website capture fixture: several coding agents at work in one Acme workspace.
 *
 * Everything here is synthetic. The Acme workspace, its storefront repository,
 * the threads, the transcript, commands and model catalogs are invented. The
 * production ChatView (thread rail, transcript and composer) renders against
 * the injected context values from context-mocks.mjs and an inert
 * window.mezair stand-in. No agent, provider, Git command or backend is called.
 *
 * Serve: pnpm exec vite --config scripts/chat-review.vite.config.ts --host 127.0.0.1 --port 4180
 * Open:  http://127.0.0.1:4180/agents-at-work.html   (add ?picker to open the model picker)
 *
 * The active thread uses Cursor; the other threads use Codex, Claude Code and
 * Devin. The rail shows each thread's state but not its agent.
 */

localStorage.clear();
document.documentElement.dataset.theme = 'dark';
// A natural mix of thread access. Badges and the composer chip name each level by
// the mode the selected agent (Cursor) applies: Ask, Agent or Full access.
localStorage.setItem(
  'mezair:chat-thread-access:v1:ws-acme',
  JSON.stringify({
    defaultLevel: 'on-request',
    appliedLevel: 'on-request',
    threads: {
      'thread-apartment-line': 'read-only',
      'thread-cdn-signer': 'workspace-auto',
      'thread-search-focus': 'workspace-auto',
      'thread-gift-card': 'full-access',
    },
  }),
);

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const persona = {
  id: 'coder',
  name: 'Coder',
  description: 'Writes and verifies code changes.',
  capabilities: { canWriteFiles: true, canReadFiles: true, canRunCommands: true },
};
const repo = {
  id: 'repo-storefront',
  name: 'storefront',
  path: '/Users/demo/code/storefront',
  defaultBranch: 'main',
  status: 'indexed',
  indexTier: 'enriched',
  languages: [{ language: 'TypeScript', percentage: 100, fileCount: 412 }],
  fileCount: 412,
  branchCount: 6,
} as unknown as RepoInfo;
const workspace = { id: 'ws-acme', name: 'Acme', repos: [repo] };

const ACTIVE_THREAD = 'thread-search-focus';

/** One thread per agent; the rail shows each thread's state, not its agent. */
type ThreadSeed = Pick<ChatThread, 'id' | 'title' | 'attentionState' | 'lastMessageAt'> &
  Partial<Pick<ChatThread, 'activeTurnStartedAt' | 'attentionUpdatedAt' | 'lastViewedAt'>> & {
    agent: AgentProvider;
  };
const SEEDS: ThreadSeed[] = [
  {
    id: 'thread-coupon-total',
    agent: 'codex',
    title: 'Checkout keeps the stale cart total after a coupon is removed',
    attentionState: 'working',
    activeTurnStartedAt: ago(4),
    lastMessageAt: ago(1),
  },
  {
    id: 'thread-apartment-line',
    agent: 'claude',
    title: 'Address form drops the apartment line on autofill',
    attentionState: 'working',
    activeTurnStartedAt: ago(2),
    lastMessageAt: ago(1),
  },
  {
    id: 'thread-cdn-signer',
    agent: 'devin',
    title: 'Migrate image CDN URLs to the v2 signer',
    attentionState: 'approval',
    attentionUpdatedAt: ago(3),
    lastMessageAt: ago(3),
  },
  {
    id: ACTIVE_THREAD,
    agent: 'cursor',
    title: 'Search input loses focus after filters update',
    attentionState: 'complete',
    attentionUpdatedAt: ago(6),
    lastMessageAt: ago(6),
    lastViewedAt: ago(0),
  },
  {
    id: 'thread-gift-card',
    agent: 'codex',
    title: 'Gift card balance rounds half-cents incorrectly',
    attentionState: 'complete',
    attentionUpdatedAt: ago(18),
    lastMessageAt: ago(18),
    lastViewedAt: ago(40),
  },
];
const THREADS: Array<ChatThread & { agent: AgentProvider }> = SEEDS.map((thread) => ({
  personaId: 'coder',
  workspaceId: workspace.id,
  repoIds: [repo.id],
  activeRepoId: repo.id,
  createdAt: ago(90),
  updatedAt: thread.lastMessageAt ?? ago(0),
  messageCount: 4,
  ...thread,
}));

const liveThreadStatuses: Record<string, CodexSession['status']> = Object.fromEntries(
  THREADS.filter((thread) => thread.attentionState === 'working').map((thread) => [
    thread.id,
    'busy' as const,
  ]),
);

const TASK =
  'The search input loses focus whenever a filter chip updates the results. Find the cause, fix it, and add a test that types after a filter change.';

const EVENTS: CodexEvent[] = [
  {
    type: 'tool_call',
    itemId: 'focus-read-bar',
    toolName: 'read_file',
    toolStatus: 'completed',
    toolInput: { path: 'src/components/search/SearchBar.tsx' },
    toolOutput: 'export function SearchBar({ query, onQueryChange }: SearchBarProps) {',
  },
  {
    type: 'tool_call',
    itemId: 'focus-search-key',
    toolName: 'search',
    toolStatus: 'completed',
    toolInput: { query: '<SearchBar' },
    toolOutput: 'src/components/search/SearchResults.tsx:41  <SearchBar key={filtersKey}',
  },
  {
    type: 'tool_call',
    itemId: 'focus-read-results',
    toolName: 'read_file',
    toolStatus: 'completed',
    toolInput: { path: 'src/components/search/SearchResults.tsx' },
    toolOutput: 'const filtersKey = filters.map((filter) => filter.id).join(",");',
  },
  {
    type: 'file_edit',
    itemId: 'focus-fix',
    filePath: 'src/components/search/SearchResults.tsx',
    diff: '@@ -39,5 +39,4 @@\n   return (\n     <section aria-label="Search results">\n-      <SearchBar key={filtersKey} query={query} onQueryChange={setQuery} />\n+      <SearchBar query={query} onQueryChange={setQuery} />',
  },
  {
    type: 'file_edit',
    itemId: 'focus-test',
    filePath: 'test/search-bar.test.tsx',
    diff: "@@ -22,3 +22,12 @@\n   });\n+\n+  it('keeps focus while filters update', async () => {\n+    render(<SearchResults />);\n+    await user.type(screen.getByRole('searchbox'), 'linen');\n+    await user.click(screen.getByRole('button', { name: 'In stock' }));\n+    await user.type(screen.getByRole('searchbox'), ' shirt');\n+    expect(screen.getByRole('searchbox')).toHaveFocus();\n+    expect(screen.getByRole('searchbox')).toHaveValue('linen shirt');\n+  });",
  },
  {
    type: 'command_exec',
    itemId: 'focus-tests',
    command: 'pnpm test -- search',
    output:
      ' ✓ test/search-bar.test.tsx (4)\n ✓ test/search-filters.test.ts (2)\n Tests  6 passed (6)',
    exitCode: 0,
    toolStatus: 'completed',
  },
  {
    type: 'command_exec',
    itemId: 'focus-typecheck',
    command: 'pnpm typecheck',
    output: 'tsc --noEmit',
    exitCode: 0,
    toolStatus: 'completed',
  },
];

const event = (value: CodexEvent): ChatEntry => ({
  kind: 'event',
  event: { ...value, sessionId: 'fixture-cursor-session', agentLabel: 'Cursor' },
});

const ENTRIES: ChatEntry[] = [
  { kind: 'user', id: 'focus-request', content: TASK, timestamp: ago(9) },
  {
    kind: 'thinking',
    content:
      'I’ll find where the search input is rendered and check what remounts it when the filters change.',
  },
  ...EVENTS.map(event),
  {
    kind: 'assistant',
    phase: 'final',
    content:
      'The input was being remounted. `SearchResults` passed `key={filtersKey}` to `SearchBar`, so every filter change replaced the input and its focus. I removed the key; the query already lives in `useSearchParams`, so nothing else needed resetting.\n\nAdded **keeps focus while filters update** to `test/search-bar.test.tsx`. Search tests: 6 passed. Typecheck is clean.',
  },
  {
    ...event({ type: 'turn_outcome', turnOutcome: 'completed' }),
    timestamp: ago(6),
  },
];

/** Synthetic model catalogs, built with the production option builder. */
const MODEL_OPTIONS = buildChatModelOptions(
  ['codex', 'claude', 'cursor', 'devin'],
  'cursor',
  'composer-2',
  {
    installed: true,
    models: [
      {
        id: 'gpt-6.1-sol',
        displayName: 'GPT-6.1 Sol',
        description: 'Frontier agentic coding model.',
        supportedReasoningEfforts: ['medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'xhigh',
        serviceTiers: [],
      },
    ],
  } as never,
  { installed: true, models: [{ id: 'composer-2', label: 'Composer 2' }] },
  null,
  { installed: true, authenticated: true, models: [{ id: 'swe-2', label: 'SWE-2' }] },
  { installed: true, models: [{ id: 'opus', label: 'Opus' }] } as never,
);

const noop = () => undefined;
const api = (parts: string[] = []): unknown =>
  new Proxy(noop, {
    get: (_target, key) => api([...parts, String(key)]),
    apply: () => {
      const path = parts.join('.');
      const method = parts.at(-1)!;
      if (method.startsWith('on')) return noop;
      if (path === 'chat.threadExists') return Promise.resolve(true);
      if (path === 'chat.listThreads') return Promise.resolve(THREADS);
      if (path === 'settings.get')
        return Promise.resolve({
          codexMode: 'on-request',
          chatBusyEnter: 'guide',
          chatLayout: 'classic',
          enabledLlmProviders: ['codex', 'claude', 'cursor', 'devin'],
          llmProvider: 'cursor',
          theme: 'dark',
        });
      if (path === 'syncRuntime.status')
        return Promise.resolve({ backends: [], meshHosts: [], authState: 'signed-out' });
      if (method.startsWith('get')) return Promise.resolve(null);
      return Promise.resolve([]);
    },
  });
window.mezair = api() as MezairAPI;

let state: Record<string, unknown>;
Object.assign(window, {
  __chatViewProbe: {
    read: (hook: string) =>
      hook === 'useWorkspace'
        ? {
            repos: [repo],
            activeWorkspace: workspace,
            workspaceAccessDefault: 'on-request',
            setWorkspaceAccessDefault: noop,
            featureAvailability: { chatEnabled: true },
            activeScaffoldSession: null,
          }
        : state,
  },
});

function Probe() {
  const [threadId, setThreadId] = useState(ACTIVE_THREAD);
  const activeThread = THREADS.find((thread) => thread.id === threadId) ?? THREADS[0];
  state = {
    personas: [persona],
    activePersona: persona,
    entries: threadId === ACTIVE_THREAD ? ENTRIES : [],
    repos: [repo],
    activeRepos: [repo],
    activeArtifacts: [],
    selectedGovernanceDocs: [],
    scaffoldModeActive: false,
    scaffoldStatus: null,
    error: null,
    threads: THREADS,
    activeThread,
    activeThreadId: threadId,
    isTemporaryChat: false,
    chatLayout: 'classic',
    sideQuestion: null,
    historyReady: true,
    historyHasEarlier: false,
    historyLoadingEarlier: false,
    model: 'composer-2',
    modelProvider: 'cursor',
    modelOptions: MODEL_OPTIONS,
    modelPickerPreferences: { style: 'dropdown', presets: [] },
    reasoningLevel: 'medium',
    reasoningOptions: [],
    collaborationMode: 'default',
    session: {
      id: 'fixture-cursor-session',
      repoId: repo.id,
      appThreadId: threadId,
      personaId: 'coder',
      provider: 'cursor',
      status: 'ready',
      startedAt: ago(9),
      capabilities: { followUp: { queue: true, guide: false } },
    },
    busy: false,
    liveThreadStatuses,
    activePlan: null,
    agentUIIntents: [],
    activeGoal: null,
    forkThread: async () => null,
    startNewSession: async () => undefined,
    selectThread: async (id: string) => setThreadId(id),
    send: async () => false,
    followUp: async () => undefined,
    setSelectedGovernanceDocs: noop,
    setActiveRepos: noop,
    setModel: noop,
    setReasoningLevel: noop,
    setCollaborationMode: noop,
    stopSession: noop,
    interrupt: noop,
    invalidateThreadAccess: async () => undefined,
    renameThread: noop,
    settleThread: noop,
    deleteThread: noop,
    setChatLayout: noop,
  };
  return (
    <MemoryRouter>
      <RepoIndexProvider>
        <main className="h-screen bg-bg-primary text-text-primary">
          <ChatView userRole="developer" />
        </main>
      </RepoIndexProvider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById('root')!).render(<Probe />);

// Below 1500 px the thread rail starts collapsed. In wide windows, expand it once
// the way a user would; it then stays open.
const expandThreads = (attempts = 30) => {
  if (window.innerWidth < 1200) return;
  const expand = document.querySelector<HTMLButtonElement>('button[aria-label="Expand threads"]');
  if (expand) expand.click();
  else if (attempts > 0) window.setTimeout(() => expandThreads(attempts - 1), 100);
};
window.setTimeout(expandThreads, 300);
// Captures show no focus caret in the composer.
window.setTimeout(() => (document.activeElement as HTMLElement | null)?.blur(), 1500);

// `?picker` opens the composer's model picker once the view has settled, then
// scrolls its list past the selected Cursor models so the other agents show.
if (new URLSearchParams(window.location.search).has('picker')) {
  const open = () => {
    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Model and run settings"], button[aria-label^="Choose model"]',
    );
    if (!trigger) {
      window.setTimeout(open, 100);
      return;
    }
    trigger.click();
    window.setTimeout(() => {
      const list = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Models"]');
      const next = list?.querySelectorAll<HTMLElement>('[role="group"]')[1];
      if (list && next) list.scrollTop = next.offsetTop - list.offsetTop;
      (document.activeElement as HTMLElement | null)?.blur();
    }, 200);
  };
  window.setTimeout(open, 600);
}
