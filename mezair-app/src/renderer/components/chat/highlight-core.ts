import { createHighlighterCore, createCssVariablesTheme } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Create CSS variables theme — emits var(--shiki-*) references defined in global.css
const cssVarsTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  variableDefaults: {},
  fontStyle: true,
});

const LANGUAGE_REGISTRY: Record<
  string,
  {
    id: string;
    grammar: () => Promise<{
      default: Parameters<Awaited<ReturnType<typeof createHighlighterCore>>['loadLanguage']>[0];
    }>;
  }
> = {
  typescript: { id: 'typescript', grammar: () => import('@shikijs/langs/typescript') },
  ts: { id: 'typescript', grammar: () => import('@shikijs/langs/typescript') },
  tsx: { id: 'typescript', grammar: () => import('@shikijs/langs/typescript') },
  javascript: { id: 'javascript', grammar: () => import('@shikijs/langs/javascript') },
  js: { id: 'javascript', grammar: () => import('@shikijs/langs/javascript') },
  jsx: { id: 'javascript', grammar: () => import('@shikijs/langs/javascript') },
  json: { id: 'json', grammar: () => import('@shikijs/langs/json') },
  css: { id: 'css', grammar: () => import('@shikijs/langs/css') },
  html: { id: 'html', grammar: () => import('@shikijs/langs/html') },
  htm: { id: 'html', grammar: () => import('@shikijs/langs/html') },
  python: { id: 'python', grammar: () => import('@shikijs/langs/python') },
  py: { id: 'python', grammar: () => import('@shikijs/langs/python') },
  csharp: { id: 'csharp', grammar: () => import('@shikijs/langs/csharp') },
  cs: { id: 'csharp', grammar: () => import('@shikijs/langs/csharp') },
  bash: { id: 'bash', grammar: () => import('@shikijs/langs/bash') },
  sh: { id: 'bash', grammar: () => import('@shikijs/langs/bash') },
  shell: { id: 'bash', grammar: () => import('@shikijs/langs/bash') },
  zsh: { id: 'bash', grammar: () => import('@shikijs/langs/bash') },
  yaml: { id: 'yaml', grammar: () => import('@shikijs/langs/yaml') },
  yml: { id: 'yaml', grammar: () => import('@shikijs/langs/yaml') },
  markdown: { id: 'markdown', grammar: () => import('@shikijs/langs/markdown') },
  md: { id: 'markdown', grammar: () => import('@shikijs/langs/markdown') },
  sql: { id: 'sql', grammar: () => import('@shikijs/langs/sql') },
  diff: { id: 'diff', grammar: () => import('@shikijs/langs/diff') },
};

let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [cssVarsTheme],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const languages = new Map<string, Promise<void>>();

/** Runs only inside the worker; grammar requests share their in-flight load. */
export async function highlightInWorker(code: string, language: string): Promise<string> {
  const entry = LANGUAGE_REGISTRY[language];
  if (!entry) return wrapPlaintext(code);
  const highlighter = await getHighlighter();
  let loading = languages.get(entry.id);
  if (!loading) {
    loading = entry.grammar().then((grammar) => highlighter.loadLanguage(grammar.default));
    languages.set(entry.id, loading);
    loading.catch(() => languages.delete(entry.id));
  }
  await loading;
  return highlighter.codeToHtml(code, { lang: entry.id, theme: 'css-variables' });
}

function wrapPlaintext(code: string): string {
  return `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
}
