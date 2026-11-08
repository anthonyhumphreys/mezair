import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
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
let delayRepository = true;
window.mezair.git.status = (repoId) =>
  repoId === 'b' && delayRepository
    ? new Promise((resolve) => {
        releaseRepository = async () => {
          delayRepository = false;
          resolve(await readStatus('a'));
        };
      })
    : readStatus('a');
const root = createRoot(document.getElementById('root')!);
flushSync(() =>
  root.render(
    <MemoryRouter>
      <ReviewPreview />
    </MemoryRouter>,
  ),
);
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
let assertions = 0;
const check = (value: unknown, message: string) => {
  assertions++;
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
    button('Stage file').click();
    await frame();
    document.querySelector<HTMLButtonElement>('button[aria-label="Refresh changes"]')!.click();
    await frame();
    await frame();
    const statusReads = (
      window as unknown as { reviewStatusReads: () => number }
    ).reviewStatusReads();
    (window as unknown as { finishStageProbe: () => void }).finishStageProbe();
    await frame();
    await frame();
    check(
      (window as unknown as { reviewStatusReads: () => number }).reviewStatusReads() > statusReads,
      'A successful mutation must refresh its repository even if Refresh raced its completion',
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
    button('Preview file rewind').click();
    await frame();
    await frame();
    check(button('Rewind 1 file'), 'Rewind must show the original preview before confirmation');
    const modal = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const bounds = modal.getBoundingClientRect();
    check(
      modal.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight,
      'The confirmation must be visible and fit inside the viewport',
    );
    button('Rewind 1 file').click();
    await frame();
    await frame();
    check(
      document.querySelector('[role="dialog"]'),
      'A stale preview must leave confirmation open',
    );
    check(
      button('Rewind 2 files') && document.body.textContent?.includes('new-unreviewed.txt'),
      'A stale preview must refresh the exact file list without restoring it',
    );
    button('Rewind 2 files').click();
    await frame();
    await frame();
    check(
      !document.querySelector('[role="dialog"]') &&
        document.body.textContent?.includes('Confirmed updated rewind'),
      'Only a fresh confirmation may finish the rewind',
    );
    button('Review or edit checks').click();
    await frame();
    await frame();
    button('Run selected checks').click();
    await frame();
    button('Move verification panel').click();
    await frame();
    check(
      button('Running checks…')?.disabled,
      'A remounted verification panel must retain its in-flight submission',
    );
    button('Running checks…').click();
    check(
      (window as unknown as { integrationProbeCalls: () => number }).integrationProbeCalls() === 1,
      'A remount must not submit verification commands twice',
    );
    (window as unknown as { finishIntegrationProbe: () => void }).finishIntegrationProbe();
    await frame();
    await frame();
    check(
      button('Review or edit checks') && !button('Running checks…'),
      'Completion must reconcile the remounted verification panel',
    );
    return { passed: true, assertions };
  },
});
