import DOMPurify from 'dompurify';
import { LRUCache } from 'lru-cache';
import { createHighlightQueue } from './highlight-queue';

const cache = new LRUCache<string, string>({
  maxSize: 4_000_000,
  sizeCalculation: (value, key) => 2 * (value.length + key.length),
});
const queue = createHighlightQueue(
  () => new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' }),
);
const aliases: Record<string, string> = {
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  python: 'python',
  py: 'python',
  csharp: 'csharp',
  cs: 'csharp',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  markdown: 'markdown',
  md: 'markdown',
  sql: 'sql',
  diff: 'diff',
};

/** Main thread owns the bounded, sanitised result cache; tokenisation is off-thread. */
export async function highlightCode(
  code: string,
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  const resolved = aliases[language.trim().toLowerCase()];
  if (!resolved || code.length > 60_000 || signal?.aborted || typeof Worker === 'undefined')
    return wrapPlaintext(code);
  const key = `${resolved}:${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await queue.highlight(code, resolved, signal);
  if (signal?.aborted) return wrapPlaintext(code);
  const html = DOMPurify.sanitize(result, {
    ALLOWED_TAGS: ['pre', 'code', 'span'],
    ALLOWED_ATTR: ['class', 'style'],
  });
  if (code.length <= 12_000) cache.set(key, html);
  return html;
}

export function disposeHighlightResources(): void {
  queue.dispose();
  cache.clear();
}

function wrapPlaintext(code: string): string {
  return `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
}

/** Map common file extensions to Shiki language IDs */
export function extToLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    cs: 'csharp',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    json: 'json',
    css: 'css',
    html: 'html',
    htm: 'html',
    sql: 'sql',
  };
  return map[ext] ?? 'text';
}
