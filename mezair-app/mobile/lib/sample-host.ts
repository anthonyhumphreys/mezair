/**
 * SYNTHETIC SAMPLE DATA - development only.
 *
 * Everything in this file is invented for screenshots: the Acme workspace, its
 * `storefront` repository, "Dana's MacBook Pro", every thread, session, approval
 * and message. No real desktop, agent, provider or network host is contacted.
 *
 * It stands in for a paired desktop host at the transport boundary: it stores one
 * paired connection the same way manual pairing does, and answers that host's
 * companion HTTP routes (`/api/overview`, thread history, approvals) through the
 * global `fetch` that `lib/mezair-api.ts` already calls. The production
 * normalisers, context and screens run unchanged on top of it. Requests to any
 * other origin pass through untouched.
 *
 * Enable with `EXPO_PUBLIC_MEZAIR_SAMPLE_DATA=1` in a development build. The only
 * import site, `app/_layout.tsx`, is guarded by `__DEV__`, so release bundles
 * drop this module entirely.
 */
import * as SecureStore from 'expo-secure-store';
import { buildApprovalPolicy } from '../../src/shared/companion-policy';
import type {
  ChatMessage,
  CodexSession,
  MobileApprovalRequest,
  MobileChatThreadSummary,
  MobileCompanionStatus,
  MobileOverview,
  RepoInfo,
} from '../../src/shared/types';
import { COMPANION_CONNECTIONS_KEY, type CompanionConnection } from './mezair-api';

const SAMPLE_BASE_URL = 'http://danas-macbook-pro.local:47631';
const SAMPLE_CONNECTION_ID = 'sample-host-danas-macbook-pro';
const SAMPLE_TOKEN = 'synthetic-sample-token';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const REPO = {
  id: 'repo-storefront',
  name: 'storefront',
  path: '/Users/demo/code/storefront',
  defaultBranch: 'main',
  languages: [{ language: 'TypeScript', percentage: 100, fileCount: 412 }],
  status: 'indexed',
  indexTier: 'enriched',
  fileCount: 412,
  branchCount: 6,
} as unknown as RepoInfo;

const WORKSPACE_ID = 'ws-acme';

type ThreadSeed = {
  id: string;
  title: string;
  provider: NonNullable<CodexSession['provider']>;
  /** Minutes since the last message. */
  updated: number;
  messageCount: number;
  preview: string;
  session?: CodexSession['status'];
  approval?: { command: string; reason: string; requested: number };
};

const THREADS: ThreadSeed[] = [
  {
    id: 'thread-cdn-signer',
    title: 'Migrate image CDN URLs to the v2 signer',
    provider: 'codex',
    updated: 3,
    messageCount: 6,
    preview:
      'Rewrote 214 image URLs to the v2 signer. I need to run the image tests before I commit.',
    session: 'busy',
    approval: {
      command: 'pnpm test -- src/lib/images',
      reason: 'Run the image URL tests against the v2 signer.',
      requested: 3,
    },
  },
  {
    id: 'thread-coupon-total',
    title: 'Checkout keeps the stale cart total after a coupon is removed',
    provider: 'codex',
    updated: 1,
    messageCount: 4,
    preview: 'The total is memoised on the cart id, so removing a coupon never recalculates it.',
    session: 'busy',
  },
  {
    id: 'thread-apartment-line',
    title: 'Address form drops the apartment line on autofill',
    provider: 'claude',
    updated: 1,
    messageCount: 4,
    preview: 'Autofill writes address-line2 before the field mounts. Adding a test for it now.',
    session: 'busy',
  },
  {
    id: 'thread-search-focus',
    title: 'Search input loses focus after filters update',
    provider: 'cursor',
    updated: 6,
    messageCount: 4,
    preview: 'Removed the key that remounted SearchBar. Search tests: 6 passed.',
  },
  {
    id: 'thread-gift-card',
    title: 'Gift card balance rounds half-cents incorrectly',
    provider: 'codex',
    updated: 18,
    messageCount: 4,
    preview: 'Balances now round half-cents to even in one place. 9 tests passed.',
  },
];

const sessionId = (thread: ThreadSeed) => `sample-session-${thread.id}`;

function sessions(): CodexSession[] {
  return THREADS.filter((thread) => thread.session).map((thread) => ({
    id: sessionId(thread),
    repoId: REPO.id,
    repoIds: [REPO.id],
    workspaceId: WORKSPACE_ID,
    appThreadId: thread.id,
    kind: 'repo',
    personaId: 'coder',
    provider: thread.provider,
    status: thread.session!,
    startedAt: minutesAgo(thread.updated + 6),
  }));
}

/** Approvals the user has already answered on this run of the sample host. */
const resolvedApprovals = new Set<string>();

function approvals(): MobileApprovalRequest[] {
  return THREADS.flatMap((thread) => {
    if (!thread.approval) return [];
    const requestKey = `sample-approval-${thread.id}`;
    if (resolvedApprovals.has(requestKey)) return [];
    const request: MobileApprovalRequest = {
      sessionId: sessionId(thread),
      requestKey,
      requestId: requestKey,
      kind: 'command',
      command: thread.approval.command,
      reason: thread.approval.reason,
      cwd: REPO.path,
      workspaceId: WORKSPACE_ID,
      workspaceName: 'Acme',
      repoId: REPO.id,
      repoName: REPO.name,
      createdAt: minutesAgo(thread.approval.requested),
    };
    // The desktop attaches its policy with this same shared helper.
    return [{ ...request, policy: buildApprovalPolicy(request) }];
  });
}

function threads(pending: MobileApprovalRequest[]): MobileChatThreadSummary[] {
  return THREADS.map((thread) => ({
    id: thread.id,
    personaId: 'coder',
    title: thread.title,
    workspaceId: WORKSPACE_ID,
    repoIds: [REPO.id],
    preview: thread.preview,
    messageCount: thread.messageCount,
    updatedAt: minutesAgo(thread.updated),
    activeSessionId: thread.session ? sessionId(thread) : undefined,
    activeSessionStatus: thread.session,
    pendingApprovalCount: pending.filter((approval) => approval.sessionId === sessionId(thread))
      .length,
  }));
}

function overview(): MobileOverview {
  const pendingApprovals = approvals();
  const activeSessions = sessions();
  const busy = activeSessions.filter((session) => session.status === 'busy').length;
  const companion: MobileCompanionStatus = {
    enabled: true,
    running: true,
    host: '0.0.0.0',
    port: 47631,
    baseUrl: SAMPLE_BASE_URL,
    advertisedAddresses: [{ label: 'Wi-Fi', url: SAMPLE_BASE_URL, kind: 'lan' }],
    pairedDeviceCount: 1,
  };
  const now = minutesAgo(0);
  return {
    generatedAt: now,
    activeWorkspace: {
      id: WORKSPACE_ID,
      name: 'Acme',
      syncSelected: false,
      createdAt: minutesAgo(60 * 24 * 30),
      updatedAt: now,
      repos: [REPO],
    },
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: 'Acme',
        syncSelected: false,
        createdAt: minutesAgo(60 * 24 * 30),
        updatedAt: now,
        repoCount: 1,
      },
    ],
    activeSessions,
    pendingApprovals,
    threads: threads(pendingApprovals),
    recentRuns: [],
    workspaceHealth: {
      reviewFindingCount: 0,
      securityFindingCount: 0,
      lifecycleItemCount: 0,
      workItemCount: 0,
      criticalCount: 0,
      highCount: 0,
      signals: [],
    },
    workItems: [],
    // Derived by the companion from the sessions, approvals and threads above.
    workQueue: [],
    workflow:
      pendingApprovals.length > 0
        ? {
            health: 'needs-approval',
            headline: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? '' : 's'} waiting`,
            detail: 'Remote review is the fastest way to unblock the running session.',
            counts: {
              pendingApprovals: pendingApprovals.length,
              activeSessions: activeSessions.length,
              busySessions: busy,
              readySessions: 0,
              recentThreads: THREADS.length,
              workspaceRepos: 1,
            },
          }
        : {
            health: 'busy',
            headline: `${busy} session${busy === 1 ? '' : 's'} working`,
            detail: 'Keep an eye on progress, interrupt bad turns, or send steering input.',
            counts: {
              pendingApprovals: 0,
              activeSessions: activeSessions.length,
              busySessions: busy,
              readySessions: 0,
              recentThreads: THREADS.length,
              workspaceRepos: 1,
            },
          },
    quickActions: [],
    companion,
    notifications: [],
  };
}

function history(threadId: string): ChatMessage[] {
  const thread = THREADS.find((candidate) => candidate.id === threadId);
  if (!thread) return [];
  const start = thread.updated + 8;
  const messages: ChatMessage[] = [
    {
      id: `${thread.id}-request`,
      role: 'user',
      content: `${thread.title}. Find the cause, fix it in \`storefront\` and add a test.`,
      timestamp: minutesAgo(start),
      threadId: thread.id,
    },
    {
      id: `${thread.id}-latest`,
      role: 'assistant',
      content: thread.preview,
      timestamp: minutesAgo(thread.updated),
      threadId: thread.id,
      sessionId: thread.session ? sessionId(thread) : undefined,
    },
  ];
  return messages;
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handle(url: URL, init: RequestInit | undefined): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = url.pathname;

  if (method === 'GET' && path === '/api/overview') return respond(200, overview());
  if (method === 'GET' && path === '/api/chat/threads') {
    return respond(200, threads(approvals()));
  }
  const historyMatch = path.match(/^\/api\/chat\/threads\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    return respond(200, history(decodeURIComponent(historyMatch[1])));
  }
  const approvalMatch = path.match(/^\/api\/approvals\/[^/]+\/([^/]+)\/resolve$/);
  if (method === 'POST' && approvalMatch) {
    resolvedApprovals.add(decodeURIComponent(approvalMatch[1]));
    return respond(200, { ok: true });
  }
  return respond(404, { error: `The sample host does not provide ${method} ${path}.` });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Pairs the synthetic host and routes its requests to the in-memory fixture. */
export function installSampleHost(): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = requestUrl(input);
    if (!url.startsWith(`${SAMPLE_BASE_URL}/`)) return realFetch(input, init);
    return handle(new URL(url), init);
  };

  // Same record manual pairing stores; any real pairings are kept behind it.
  const now = new Date().toISOString();
  const sample: CompanionConnection = {
    id: SAMPLE_CONNECTION_ID,
    baseUrl: SAMPLE_BASE_URL,
    token: SAMPLE_TOKEN,
    deviceName: "Dana's MacBook Pro",
    pairedAt: now,
    lastUsedAt: now,
    authMode: 'paired',
  };
  let existing: CompanionConnection[] = [];
  try {
    const raw = SecureStore.getItem(COMPANION_CONNECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && 'connections' in parsed) {
      const connections = (parsed as { connections: unknown }).connections;
      if (Array.isArray(connections)) existing = connections as CompanionConnection[];
    }
  } catch {
    existing = [];
  }
  SecureStore.setItem(
    COMPANION_CONNECTIONS_KEY,
    JSON.stringify({
      version: 2,
      activeConnectionId: SAMPLE_CONNECTION_ID,
      connections: [sample, ...existing.filter((candidate) => candidate.id !== sample.id)],
    }),
  );
}
