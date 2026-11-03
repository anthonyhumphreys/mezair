import { highlightInWorker } from './highlight-core';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; code: string; language: string }>) => void;
  postMessage: (message: { id: number; html: string }) => void;
};
scope.onmessage = async ({ data }) => {
  let html: string;
  try {
    html = await highlightInWorker(data.code, data.language);
  } catch {
    html = `<pre><code>${data.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
  }
  scope.postMessage({ id: data.id, html });
};
