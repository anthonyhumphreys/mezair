import type { ChatMessage, CodexEvent } from '../../../../shared/types';
import type { ReviewSurfaceData } from '../../../../shared/surfaces/kinds/review';
import type { ChatReplayScenario } from './chat-replay-fixtures';
import { buildReplaySurface, REPLAY_SURFACE_REPO_ID } from './chat-replay-surface-fixtures';

export const SHOWCASE_TASK =
  'Checkout retries give up too early on flaky mobile networks. Raise the limit to 5, keep the backoff, and add a test that proves the fifth attempt runs.';

/** A complete, realistic turn for screenshots: reproduce, fix, verify. */
export const SHOWCASE_EVENTS: CodexEvent[] = [
  {
    type: 'tool_call',
    itemId: 'show-read',
    toolName: 'read_file',
    toolStatus: 'completed',
    toolInput: { path: 'src/lib/retry.ts' },
    toolOutput: "import { sleep } from './time';\n\nexport const MAX_ATTEMPTS = 3;",
  },
  {
    type: 'tool_call',
    itemId: 'show-search',
    toolName: 'search',
    toolStatus: 'completed',
    toolInput: { query: 'withRetry(' },
    toolOutput: 'src/checkout/submit.ts:14\nsrc/search/client.ts:9',
  },
  {
    type: 'file_edit',
    itemId: 'show-test-edit',
    filePath: 'test/retry.test.ts',
    diff: "@@ -8,3 +8,12 @@\n   });\n+\n+  it('retries five times before giving up', async () => {\n+    let calls = 0;\n+    const flaky = async () => {\n+      calls += 1;\n+      if (calls < 5) throw new Error('ECONNRESET');\n+      return 'ok';\n+    };\n+    await expect(withRetry(flaky)).resolves.toBe('ok');\n+  });",
  },
  {
    type: 'command_exec',
    itemId: 'show-red',
    command: 'pnpm test -- retry',
    output:
      ' FAIL  test/retry.test.ts > withRetry > retries five times before giving up\nError: ECONNRESET\n Tests  1 failed | 1 passed (2)',
    exitCode: 1,
    toolStatus: 'failed',
  },
  {
    type: 'file_edit',
    itemId: 'show-fix',
    filePath: 'src/lib/retry.ts',
    diff: "@@ -1,4 +1,4 @@\n import { sleep } from './time';\n \n-export const MAX_ATTEMPTS = 3;\n+export const MAX_ATTEMPTS = 5;",
  },
  {
    type: 'command_exec',
    itemId: 'show-green',
    command: 'pnpm test',
    output:
      ' ✓ test/retry.test.ts (2)\n ✓ test/cart.test.ts (7)\n ✓ test/address.test.ts (5)\n Tests  14 passed (14)',
    exitCode: 0,
    toolStatus: 'completed',
  },
];

const threadId = 'fixture-retry-workflow';
const startedAt = Date.parse('2026-11-01T10:00:00.000Z');
const files: ReviewSurfaceData['files'] = [
  { path: 'src/lib/retry.ts', status: 'modified', additions: 1, deletions: 1 },
  { path: 'test/retry.test.ts', status: 'modified', additions: 10, deletions: 0 },
];
const review: ReviewSurfaceData = {
  scope: { type: 'turn', repoId: REPLAY_SURFACE_REPO_ID, title: 'Retry limit' },
  verdict: {
    decision: 'ship',
    source: 'agent',
    summary: 'The fifth attempt is covered. Backoff and the public API are unchanged.',
  },
  stats: { files: 2, additions: 11, deletions: 1 },
  findings: [],
  risks: [],
  files,
  chapters: [
    {
      id: 'retry',
      index: 1,
      title: 'Raise the retry limit and cover the fifth attempt',
      summary:
        'The limit increases from three to five; a regression test fails before the change and passes after it.',
      files,
    },
  ],
  hunks: Object.fromEntries(
    SHOWCASE_EVENTS.filter((event) => event.type === 'file_edit').map((event) => {
      const [header, ...lines] = (event.diff ?? '').split('\n');
      return [event.filePath!, [{ header, lines }]];
    }),
  ),
};
const surface = buildReplaySurface(
  'fixture-retry-review',
  threadId,
  'review',
  'Review · retry limit',
  review,
  {
    createdAt: new Date(startedAt + 40_000).toISOString(),
  },
);
const messages: ChatMessage[] = [
  {
    id: 'retry-user',
    threadId,
    personaId: 'coder',
    role: 'user',
    content:
      'Raise the checkout retry limit to five, keep the backoff, add a regression test and review the change.',
    timestamp: new Date(startedAt).toISOString(),
  },
  ...SHOWCASE_EVENTS.map((event, index): ChatMessage => ({
    id: `retry-step-${index}`,
    threadId,
    personaId: 'coder',
    role: 'system',
    content: '',
    event,
    timestamp: new Date(startedAt + (index + 1) * 5_000).toISOString(),
  })),
  {
    id: 'retry-result',
    threadId,
    personaId: 'coder',
    role: 'assistant',
    content:
      'Raised `MAX_ATTEMPTS` from 3 to 5 in `src/lib/retry.ts`.\n\nThe new regression test fails before the fix and passes after it. **14 tests pass.**',
    timestamp: new Date(startedAt + 35_000).toISOString(),
  },
  {
    id: 'retry-review',
    threadId,
    personaId: 'coder',
    role: 'system',
    content: '',
    event: { type: 'agent_ui_intent', agentUIIntent: surface },
    timestamp: surface.updatedAt,
  },
  {
    id: 'retry-completed',
    threadId,
    personaId: 'coder',
    role: 'system',
    content: '',
    event: { type: 'turn_outcome', turnOutcome: 'completed' },
    timestamp: new Date(startedAt + 41_000).toISOString(),
  },
];

/** One deterministic request → result → review, rendered only by development previews. */
export const RETRY_WORKFLOW_SCENARIO: ChatReplayScenario = {
  id: 'retry-workflow',
  title: 'Workflow · fix and review',
  description:
    'A synthetic retry fix: reproduce the failure, edit two files, pass the suite and review the diff.',
  initialThreadId: threadId,
  threads: [{ id: threadId, title: 'Raise the retry limit' }],
  steps: messages.map((message) => ({ kind: 'message', threadId, message })),
};
