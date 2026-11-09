import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ChatInput } from '../../src/renderer/components/chat/ChatInput';
import {
  composerRecoveryScope,
  useScopedComposerRecovery,
} from '../../src/renderer/components/chat/useScopedComposerRecovery';
import type { MezairAPI } from '../../src/shared/ipc-api';
import '../../src/renderer/styles/global.css';
localStorage.clear();
const attachment = {
  id: 'file',
  kind: 'file',
  name: 'recover.txt',
  path: '/synthetic/recover.txt',
  mimeType: 'text/plain',
  size: 1,
  createdAt: 'now',
} as const;
let resolveLookup: ((available: boolean) => void) | undefined;
let pauseLookup = false;
let available = true;
let sends = 0;
const noop = () => undefined;
const api = (parts: string[] = []): unknown =>
  new Proxy(noop, {
    get: (_target, key) => api([...parts, String(key)]),
    apply: () => {
      if (parts.join('.') === 'chat.threadExists')
        return pauseLookup
          ? new Promise<boolean>((resolve) => {
              resolveLookup = resolve;
            })
          : Promise.resolve(available);
      if (parts.at(-1)!.startsWith('on')) return noop;
      if (parts.join('.') === 'settings.get')
        return Promise.resolve({
          llmProvider: 'codex',
          enabledLlmProviders: ['codex'],
          codexMode: 'on-request',
        });
      return Promise.resolve([]);
    },
  });
window.mezair = api() as MezairAPI;
let recover: ReturnType<typeof useScopedComposerRecovery>['recover'];
let pendingId: string | undefined;
function Composer({ workspace, optional }: { workspace: string; optional: boolean }) {
  const scope = composerRecoveryScope(workspace, 'work-item', 'workitem-layout');
  const recovery = useScopedComposerRecovery(scope);
  recover = recovery.recover;
  pendingId = recovery.prefill?.id;
  return (
    <ChatInput
      disabled={false}
      personaColour="var(--color-accent)"
      allowAttachments
      draftKey={`mezair:chat-draft:${composerRecoveryScope(workspace, null, 'coder')}`}
      prefill={
        optional
          ? { id: 'optional', text: 'Optional request', attachments: [attachment] }
          : recovery.prefill
      }
      onPrefillApplied={optional ? undefined : recovery.acknowledge}
      onPrefillTextApplied={optional ? undefined : recovery.markTextApplied}
      onSend={() => {
        sends++;
        return true;
      }}
    />
  );
}
function Probe() {
  const [mounted, setMounted] = useState(true);
  const [workspace, setWorkspace] = useState('a');
  const [optional, setOptional] = useState(false);
  return (
    <MemoryRouter>
      <main>
        <button onClick={() => setMounted(!mounted)}>Toggle composer</button>
        <button onClick={() => setWorkspace(workspace === 'a' ? 'b' : 'a')}>
          Switch workspace
        </button>
        <button onClick={() => setOptional(true)}>Optional callback</button>
        {mounted && <Composer workspace={workspace} optional={optional} />}
      </main>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')!).render(<Probe />);
Object.assign(window, {
  async checkRecovery() {
    let assertions = 0;
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const check = (ok: unknown, message: string) => {
      assertions++;
      if (!ok) throw new Error(message);
    };
    const until = async (fn: () => unknown) => {
      const end = Date.now() + 5000;
      while (!fn()) {
        if (Date.now() > end) throw new Error('Recovery fixture timed out');
        await frame();
      }
    };
    const button = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (n) => n.textContent?.trim() === text,
      )!;
    const input = () =>
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!;
    const type = (text: string) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input(),
        text,
      );
      input().dispatchEvent(new Event('input', { bubbles: true }));
    };
    await until(() => input());
    pauseLookup = true;
    recover(composerRecoveryScope('a', 'work-item', 'workitem-layout'), {
      id: 'delayed',
      text: 'Recovered work item',
      attachments: [attachment],
    });
    await until(() => resolveLookup);
    button('Toggle composer').click();
    await frame();
    resolveLookup!(true);
    await frame();
    pauseLookup = false;
    button('Toggle composer').click();
    await frame();
    await frame();
    check(
      input().value === 'Recovered work item',
      'Work-item recovery must survive unmount during its existence lookup',
    );
    check(
      document.querySelector('button[aria-label="Remove recover.txt"]'),
      'Work-item recovery retains attachments',
    );
    button('Switch workspace').click();
    await frame();
    await frame();
    check(
      input().value === '' && !document.querySelector('button[aria-label="Remove recover.txt"]'),
      'A new-chat draft must not cross workspaces',
    );
    type('Workspace B draft');
    await frame();
    button('Switch workspace').click();
    await frame();
    await frame();
    check(
      input().value === 'Recovered work item' &&
        document.querySelector('button[aria-label="Remove recover.txt"]'),
      'Returning workspace restores its own text and attachment draft',
    );
    available = false;
    recover(composerRecoveryScope('a', 'work-item', 'workitem-layout'), {
      id: 'deleted',
      text: 'Do not retain deleted destination',
    });
    await frame();
    await frame();
    check(pendingId === undefined, 'Only a confirmed deleted destination releases recovery');
    available = true;
    button('Optional callback').click();
    await frame();
    await frame();
    document.querySelector<HTMLButtonElement>('button[aria-label="Remove recover.txt"]')!.click();
    await frame();
    await frame();
    check(
      !document.querySelector('button[aria-label="Remove recover.txt"]'),
      'An optional callback must not reinsert a completed attachment prefill',
    );
    type('Send after removal');
    await frame();
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await frame();
    await frame();
    check(
      sends === 1 &&
        input().value === '' &&
        !document.querySelector('button[aria-label="Remove recover.txt"]'),
      'A completed optional prefill must not block sending or restore after sending',
    );
    return { passed: true, assertions };
  },
});
