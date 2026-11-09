import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { RepoIndexProvider } from '../../src/renderer/contexts/RepoIndexContext';
import { ChatView } from '../../src/renderer/components/chat/ChatView';
import type { MezairAPI } from '../../src/shared/ipc-api';
import '../../src/renderer/styles/global.css';

// Each viewport uses a fresh synthetic draft state in the disposable browser profile.
localStorage.clear();

const attachment = {
  id: 'original-attachment',
  createdAt: 'now',
  kind: 'file',
  name: 'requirements.txt',
  path: '/synthetic/requirements.txt',
  mimeType: 'text/plain',
  size: 12,
} as const;
const persona = {
  id: 'coder',
  name: 'Coder',
  description: 'Test',
  capabilities: { canWriteFiles: true, canReadFiles: true, canRunCommands: true },
};
const repo = { id: 'a', name: 'Synthetic', path: '/synthetic', status: 'ready' };
let rejectSend: ((error: Error) => void) | undefined;
let payload: unknown;
let forks = 0;
let emptyFork = false;
let checkpointMode = false;
let finishRestore: (() => void) | undefined;
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
let state: Record<string, unknown>;
const noop = () => undefined;
const api = (parts: string[] = []): unknown =>
  new Proxy(noop, {
    get: (_target, key) => api([...parts, String(key)]),
    apply: () => {
      const method = parts.at(-1)!;
      if (method.startsWith('on')) return noop;
      if (checkpointMode && parts.join('.') === 'chat.listCheckpoints')
        return Promise.resolve([
          { messageId: 'message', repoId: 'a', kind: 'turn', createdAt: 'now' },
        ]);
      if (checkpointMode && parts.join('.') === 'chat.previewCheckpoint')
        return Promise.resolve({
          messageId: 'message',
          fingerprint: 'reviewed',
          repos: [
            { repoId: 'a', createdAt: 'now', changes: [{ path: 'file.txt', effect: 'restore' }] },
          ],
        });
      if (checkpointMode && parts.join('.') === 'chat.restoreCheckpoint')
        return new Promise((resolve) => {
          finishRestore = () => resolve({ filesChanged: 1, undoKey: 'synthetic-undo' });
        });
      if (parts.join('.') === 'chat.listThreads')
        return Promise.resolve(['source', 'branch', 'other', 'fresh'].map((id) => ({ id })));
      if (parts.join('.') === 'settings.get')
        return Promise.resolve({
          codexMode: 'workspace-auto',
          chatBusyEnter: 'guide',
          chatLayout: 'standard',
          enabledLlmProviders: ['codex'],
          llmProvider: 'codex',
        });
      if (parts.join('.') === 'syncRuntime.status')
        return Promise.resolve({ backends: [], meshHosts: [], authState: 'signed-out' });
      if (method.startsWith('get')) return Promise.resolve(null);
      return Promise.resolve([]);
    },
  });
window.mezair = api() as MezairAPI;
Object.assign(window, {
  __chatViewProbe: {
    read: (hook: string) =>
      hook === 'useWorkspace'
        ? {
            repos: [repo],
            activeWorkspace: { id: 'ws', name: 'Synthetic workspace', repos: [repo] },
            workspaceAccessDefault: 'workspace-auto',
            setWorkspaceAccessDefault: noop,
            featureAvailability: { chatEnabled: true },
            activeScaffoldSession: null,
          }
        : state,
  },
});

function Probe() {
  const [thread, setThread] = useState('source');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [workItemMode, setWorkItemMode] = useState(false);
  const threadRecord = (id: string) => ({
    id,
    title: id,
    workspaceId: 'ws',
    repoIds: ['a'],
    personaId: 'coder',
    ...(workItemMode
      ? { workItemId: 'w1', workItemProvider: 'github', workItemTitle: 'Synthetic work item' }
      : {}),
    createdAt: 'now',
    updatedAt: 'now',
  });
  state = {
    personas: [persona],
    activePersona: persona,
    entries:
      thread === 'other'
        ? []
        : [{ kind: 'user', content: 'Original request', id: 'message', attachments: [attachment] }],
    repos: [repo],
    activeRepos: [repo],
    activeArtifacts: [],
    selectedGovernanceDocs: [],
    scaffoldModeActive: false,
    scaffoldStatus: null,
    error: null,
    threads: ['source', 'branch', 'other', 'fresh'].map(threadRecord),
    activeThread: threadRecord(thread),
    activeThreadId: thread,
    isTemporaryChat: false,
    chatLayout: workItemMode ? 'workitems' : 'standard',
    sideQuestion: null,
    historyReady: true,
    historyHasEarlier: false,
    historyLoadingEarlier: false,
    model: 'gpt-6.1-sol',
    modelProvider: 'codex',
    modelOptions: [
      {
        id: 'gpt-6.1-sol',
        label: 'Sol',
        description: 'Synthetic model',
        provider: 'codex',
        serviceTiers: [],
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
      },
    ],
    modelPickerPreferences: { style: 'dropdown', presets: [] },
    reasoningLevel: 'medium',
    reasoningOptions: ['medium'],
    collaborationMode: 'default',
    session: {
      id: 'synthetic-session',
      repoId: 'a',
      appThreadId: thread,
      personaId: 'coder',
      provider: 'codex',
      status: busy ? 'busy' : 'ready',
      capabilities: { followUp: { queue: true, guide: true } },
    },
    busy,
    liveThreadStatuses: {},
    activePlan: null,
    agentUIIntents: [],
    activeGoal: null,
    forkThread: async () => {
      forks++;
      if (emptyFork) return null;
      setThread('branch');
      return 'branch';
    },
    startNewSession: async () => {
      if (workItemMode) return undefined;
      setThread('fresh');
      return 'fresh';
    },
    selectThread: async (id: string) => setThread(id),
    send: async (text: string, attachments: unknown[]) => {
      payload = { text, attachments, thread };
      return new Promise<boolean>((_resolve, reject) => {
        rejectSend = reject;
      });
    },
    setSelectedGovernanceDocs: noop,
    setActiveRepos: noop,
    setModel: noop,
    setReasoningLevel: noop,
    setCollaborationMode: noop,
    stopSession: noop,
    interrupt: noop,
    invalidateThreadAccess: async () => undefined,
  };
  return (
    <MemoryRouter>
      <RepoIndexProvider>
        <main className="h-screen bg-bg-primary text-text-primary">
          <button onClick={() => setThread('source')}>Open original conversation</button>
          <button onClick={() => setThread('other')}>Switch to other conversation</button>
          <button onClick={() => setThread('branch')}>Open recovered branch</button>
          <button onClick={() => setBusy(!busy)}>Toggle thread busy</button>
          <button onClick={() => setWorkItemMode(true)}>Use work-item layout</button>
          <button onClick={() => setGeneration((value) => value + 1)}>Remount chat view</button>
          <ChatView key={generation} userRole="developer" />
        </main>
      </RepoIndexProvider>
    </MemoryRouter>
  );
}
Object.assign(window, {
  chatViewState: () => ({ payload, forks, sendPending: Boolean(rejectSend) }),
  rejectChatViewSend: () => rejectSend?.(new Error('Synthetic provider rejection')),
  async checkChatView() {
    let assertions = 0;
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const until = async (condition: () => unknown) => {
      const end = Date.now() + 8000;
      while (!condition()) {
        if (Date.now() > end)
          throw new Error(`ChatView state did not settle: ${errors.join('; ')}`);
        await frame();
      }
    };
    const check = (condition: unknown, message: string) => {
      assertions++;
      if (!condition) throw new Error(message);
    };
    const button = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent?.trim() === text,
      )!;
    const type = (node: HTMLTextAreaElement, text: string) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        node,
        text,
      );
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    localStorage.setItem(
      'mezair:chat-draft:branch:coder:attachments',
      JSON.stringify(
        Array.from({ length: 10 }, (_, i) => ({
          ...attachment,
          id: `slot-${i}`,
          name: `slot-${i}.txt`,
          path: `/synthetic/slot-${i}.txt`,
        })),
      ),
    );
    await until(() => document.querySelector('button[title="Edit and resend"]'));
    document.querySelector<HTMLButtonElement>('button[title="Edit and resend"]')!.click();
    await frame();
    type(
      document.querySelector<HTMLTextAreaElement>('textarea:not([aria-label="Chat message"])')!,
      'Edited request with attachment',
    );
    await frame();
    button('Toggle thread busy').click();
    await frame();
    check(
      document.querySelector<HTMLTextAreaElement>('textarea:not([aria-label="Chat message"])')
        ?.value === 'Edited request with attachment' &&
        [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
          node.textContent?.includes('Resend ·'),
        )?.disabled,
      'A thread becoming busy must retain the inline edit and disable its submission',
    );
    button('Toggle thread busy').click();
    await frame();
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((node) => node.textContent?.includes('Resend ·'))!
      .click();
    await until(() => payload);
    check(forks === 1, 'Edit/resend must fork the original conversation');
    const sent = payload as { text: string; attachments: Array<{ name: string }> };
    check(
      sent.text === 'Edited request with attachment' &&
        sent.attachments[0]?.name === attachment.name,
      'The real ChatView send must retain edited text and original attachments',
    );
    window.dispatchEvent(
      new CustomEvent('mezair:chat-send', {
        detail: { text: 'Second failed action for this branch' },
      }),
    );
    await frame();
    button('Switch to other conversation').click();
    await frame();
    type(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!,
      'Other conversation draft',
    );
    await frame();
    rejectSend!(new Error('Synthetic provider rejection'));
    await frame();
    await frame();
    check(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')?.value ===
        'Other conversation draft',
      'A failed send must not inject its prompt into a different composer',
    );
    check(
      !document.querySelector('button[aria-label="Remove requirements.txt"]'),
      'A failed send must not inject its attachments into a different composer',
    );
    button('Open recovered branch').click();
    await until(() =>
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')
        ?.value.includes('Edited request with attachment'),
    );
    check(
      document.body.textContent?.includes('recovered files are waiting'),
      'Overflow recovery must retain skipped files and explain how to free space',
    );
    const partialRecovery = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Chat message"]',
    )!.value;
    button('Switch to other conversation').click();
    await frame();
    button('Open recovered branch').click();
    await frame();
    await frame();
    check(
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!.value ===
        partialRecovery,
      'Partially restored requests must not append their text again after navigation',
    );
    document.querySelector<HTMLButtonElement>('button[aria-label="Remove slot-0.txt"]')!.click();
    await frame();
    await until(() =>
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')
        ?.value.includes('Second failed action'),
    );
    check(
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')
        ?.value.includes('Edited request with attachment'),
      'Every failed action for an inactive conversation must be recovered in order',
    );
    check(
      document.querySelector('button[aria-label="Remove requirements.txt"]'),
      'Returning to the branch must recover its original attachments',
    );
    check(
      localStorage.getItem('mezair:chat-draft:other:coder') === 'Other conversation draft',
      'The other conversation must retain its own persisted draft',
    );
    const recoveredValue = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Chat message"]',
    )!.value;
    check(
      recoveredValue.indexOf('Edited request') < recoveredValue.indexOf('Second failed action') &&
        recoveredValue.split('Edited request').length === 2,
      'Recovery must preserve request order without repeating text after freeing attachment slots',
    );
    button('Remount chat view').click();
    await frame();
    await frame();
    check(
      document.querySelector('button[aria-label="Remove requirements.txt"]'),
      'Recovered attachments must survive a composer remount',
    );
    document.querySelector<HTMLButtonElement>('button[title="Edit and resend"]')!.click();
    await frame();
    type(
      document.querySelector<HTMLTextAreaElement>('textarea:not([aria-label="Chat message"])')!,
      '',
    );
    await frame();
    const resend = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
      node.textContent?.includes('Resend ·'),
    )!;
    check(!resend.disabled, 'An attachment-only edited message must remain sendable');
    emptyFork = true;
    resend.click();
    await until(() => (payload as { text: string })?.text === '');
    check(
      (payload as { attachments: unknown[] }).attachments.length === 1,
      'Attachment-only resend must carry the retained attachment through ChatView',
    );
    check(
      (payload as { thread: string }).thread === 'fresh',
      'Editing the first message must send to the explicitly created new thread',
    );
    rejectSend!(new Error('Finish attachment-only probe'));
    await frame();
    await frame();
    checkpointMode = true;
    button('Open original conversation').click();
    await frame();
    await frame();
    button('Remount chat view').click();
    await frame();
    await frame();
    document.querySelector<HTMLButtonElement>('button[title="Edit and resend"]')!.click();
    await frame();
    type(
      document.querySelector<HTMLTextAreaElement>('textarea:not([aria-label="Chat message"])')!,
      'Source-bound edit',
    );
    await frame();
    const sourceForks = forks;
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((node) => node.textContent?.includes('Resend ·'))!
      .click();
    await until(() => button('Rewind 1 file'));
    button('Rewind 1 file').click();
    await until(() => finishRestore);
    button('Switch to other conversation').click();
    await frame();
    finishRestore!();
    await frame();
    await frame();
    check(
      forks === sourceForks,
      'Navigation during rewind must never fork the destination conversation',
    );
    button('Open original conversation').click();
    await until(() =>
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')
        ?.value.includes('Source-bound edit'),
    );
    check(
      document.querySelector('button[aria-label="Remove requirements.txt"]'),
      'Interrupted resend must retain its source-scoped text and attachment',
    );
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Remove requirements.txt"]')!
      .click();
    button('Use work-item layout').click();
    await frame();
    const composer = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Chat message"]',
    )!;
    type(composer, '/new');
    await frame();
    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await frame();
    await frame();
    check(
      composer.value === '/new' && state.activeThreadId === 'source',
      'A blocked /new must retain its draft in the work-item conversation',
    );
    return { passed: true, assertions };
  },
});
createRoot(document.getElementById('root')!).render(<Probe />);
