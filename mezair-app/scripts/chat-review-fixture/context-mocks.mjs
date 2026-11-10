import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Only the standalone regression build uses these injected context values.
// ChatView, its action queue, editor and composer run their production code.
export function reviewContextMocks() {
  const modules = {
    ChatContext: ['useChatContext', 'useChatNavigation', 'useChatActions'],
    ChatChannels: ['useChatModel', 'useChatArtifacts', 'useChatExecution', 'useChatCommands'],
    WorkspaceContext: ['useWorkspace'],
  };
  return {
    name: 'synthetic-chat-contexts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.includes('?review-original')) return;
      const resolved =
        source.startsWith('.') && importer
          ? path.resolve(path.dirname(importer.split('?')[0]), source)
          : source;
      for (const name of Object.keys(modules))
        if (
          resolved.replace(/\.(tsx?|js)$/, '') ===
          fileURLToPath(new URL(`../../src/renderer/contexts/${name}`, import.meta.url))
        )
          return `\0review-context:${name}`;
    },
    load(id) {
      if (!id.startsWith('\0review-context:')) return;
      const name = id.split(':')[1];
      const original =
        fileURLToPath(new URL(`../../src/renderer/contexts/${name}.tsx`, import.meta.url)) +
        '?review-original';
      return (
        `export * from ${JSON.stringify(original)};\nimport * as original from ${JSON.stringify(original)};\n` +
        modules[name]
          .map(
            (hook) =>
              `export function ${hook}(...args) { return window.__chatViewProbe ? window.__chatViewProbe.read(${JSON.stringify(hook)}) : original.${hook}(...args); }`,
          )
          .join('\n')
      );
    },
  };
}
