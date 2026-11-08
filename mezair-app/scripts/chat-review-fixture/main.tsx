import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MezairAPI } from '../../src/shared/ipc-api';
import {
  ReviewPreview,
  installReviewPreview,
} from '../../src/renderer/components/chat/replay/ReviewPreview';
import '../../src/renderer/styles/global.css';

window.mezair = { git: {} } as unknown as MezairAPI;
installReviewPreview();
const readStatus = window.mezair.git.status;
let releaseRepository: (() => void) | undefined;
window.mezair.git.status = (repoId) =>
  repoId === 'b'
    ? new Promise((resolve) => {
        releaseRepository = async () => resolve(await readStatus('a'));
      })
    : readStatus(repoId);
const root = createRoot(document.getElementById('root')!);
flushSync(() => root.render(<ReviewPreview />));
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === text)!;
const type = (node: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const prototype =
    node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
};
Object.assign(window, {
  async checkReview() {
    await frame();
    await frame();
    check(button('Stage file'), 'Review must load an actionable file');
    button('Stage').click();
    await frame();
    await frame();
    check(
      document.querySelector('[role="alert"]')?.textContent?.includes('file changed'),
      'A hunk failure must survive status refresh',
    );
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Repository"]')!;
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
    check(
      !button('Stage file') && !button('Stage'),
      'Repository switches must invalidate old file and hunk actions immediately',
    );
    check(releaseRepository, 'The second status request must have started');
    releaseRepository!();
    await frame();
    await frame();
    check(
      button('Stage file'),
      'The new repository must become actionable only after its status loads',
    );
    const command = document.querySelector<HTMLInputElement>(
      'input[aria-label="Unsaved integration command"]',
    )!;
    type(command, 'pnpm verify-my-work');
    await frame();
    button('Move delegated run').click();
    await frame();
    check(
      document.querySelector<HTMLInputElement>('input[aria-label="Unsaved integration command"]')
        ?.value === 'pnpm verify-my-work',
      'Moving a delegated run must preserve its unsaved integration command',
    );
    document.querySelector<HTMLButtonElement>('button[title="Edit and resend"]')!.click();
    await frame();
    const editor = document.querySelector<HTMLTextAreaElement>('textarea')!;
    type(editor, 'My edited request must survive failure');
    await frame();
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((node) => node.textContent?.includes('Resend ·'))!
      .click();
    await frame();
    await frame();
    check(
      document.querySelector<HTMLTextAreaElement>('textarea')?.value ===
        'My edited request must survive failure',
      'A failed resend must preserve the edit',
    );
    check(
      [...document.querySelectorAll('[role="alert"]')].some((node) =>
        node.textContent?.includes('edit is kept'),
      ),
      'A failed resend must explain that the edit is retained',
    );
    return { passed: true, assertions: 9 };
  },
});
