import { afterEach, expect, it, vi } from 'vitest';
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));
import { disposeHighlightResources, highlightCode } from '../shiki';

afterEach(() => {
  disposeHighlightResources();
  vi.unstubAllGlobals();
});

it('retries identical code after a transient worker error instead of caching plaintext', async () => {
  let posts = 0;
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: { id: number; html: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate() {}
      postMessage({ id }: { id: number }) {
        posts++;
        if (posts === 1) this.onerror?.();
        else
          this.onmessage?.({
            data: { id, html: '<pre><code><span>const value = 1</span></code></pre>' },
          });
      }
    },
  );
  expect(await highlightCode('const value = 1', 'ts')).not.toContain('<span>');
  expect(await highlightCode('const value = 1', 'ts')).toContain('<span>');
  expect(posts).toBe(2);
});
