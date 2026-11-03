import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ChatStateChannels,
  useChatModel,
  useChatArtifacts,
  useChatExecution,
  useChatCommands,
  type ChatChannelsValue,
} from '../../../src/renderer/contexts/ChatChannels';
import { DEFAULT_MODEL_PICKER_PREFERENCES } from '../../../src/shared/model-picker';
import { terminalImport, paletteImport } from '../../../src/renderer/utils/tool-preloads';
import { DiffViewer } from '../../../src/renderer/components/chat/DiffViewer';
import { MarkdownRenderer } from '../../../src/renderer/components/chat/MarkdownRenderer';
import { StreamedMermaidPreview } from '../../../src/renderer/components/chat/StreamedMermaidPreview';
import { SurfaceWindow } from '../../../src/renderer/components/surfaces/SurfaceWindow';
import { syntheticArtifactSurfaceId } from '../../../src/renderer/components/surfaces/surface-utils';
import type { AgentUISurfaceIntent } from '../../../src/shared/agent-ui-intents';
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const check = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
const noop = () => undefined;
export async function checkExtra() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:10000;overflow:auto;background:#0b1020';
  document.body.append(host);
  const root = createRoot(host);
  const passed: string[] = [];
  const render = (element: React.ReactNode) => flushSync(() => root.render(element));
  const counts = { model: 0, artifacts: 0, execution: 0, commands: 0, settings: 0 };
  const channels: ChatChannelsValue = {
    model: 'fixture',
    modelProvider: 'codex',
    modelOptions: [],
    modelPickerPreferences: DEFAULT_MODEL_PICKER_PREFERENCES,
    reasoningLevel: 'medium',
    reasoningOptions: ['medium'],
    collaborationMode: 'default',
    setModel: noop,
    setReasoningLevel: noop,
    setCollaborationMode: noop,
    activeArtifacts: [],
    discardArtifact: async () => {},
    shareArtifact: async () => {
      throw Error('unused');
    },
    unshareArtifact: async () => {
      throw Error('unused');
    },
    session: null,
    busy: true,
    liveThreadStatuses: {},
    activePlan: null,
    agentUIIntents: [],
    activeGoal: null,
    send: async () => true,
    steer: async () => null,
    followUp: async () => {
      throw Error('unused');
    },
    startSideQuestion: async () => true,
    returnFromSideQuestion: async () => {},
    switchPersona: async () => {},
    interrupt: async () => {},
    stopSession: async () => {},
    startNewSession: async () => {},
    ensureChatThread: async () => '',
  };
  function Model() {
    useChatModel();
    counts.model++;
    return null;
  }
  function Artifacts() {
    useChatArtifacts();
    counts.artifacts++;
    return null;
  }
  function Execution() {
    useChatExecution();
    counts.execution++;
    return null;
  }
  function Commands() {
    useChatCommands();
    counts.commands++;
    return null;
  }
  function Settings() {
    counts.settings++;
    const [value, setValue] = useState('Editing settings');
    return (
      <input
        aria-label="Settings edit probe"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  }
  const children = (
    <>
      <Settings />
      <Model />
      <Artifacts />
      <Execution />
      <Commands />
    </>
  );
  try {
    render(<ChatStateChannels value={channels}>{children}</ChatStateChannels>);
    await frame();
    const start = { ...counts };
    for (let n = 0; n < 60; n++)
      render(<ChatStateChannels value={{ ...channels }}>{children}</ChatStateChannels>);
    check(
      Object.keys(counts).every(
        (key) => counts[key as keyof typeof counts] === start[key as keyof typeof counts],
      ),
      'Background text must not render settings or command/model/artifact/execution subscribers',
    );
    render(<ChatStateChannels value={{ ...channels, busy: false }}>{children}</ChatStateChannels>);
    check(
      counts.execution === start.execution + 1 &&
        counts.model === start.model &&
        counts.settings === start.settings,
      'Execution status must update its own subscribers',
    );
    passed.push('60 background updates leave settings and four state channels idle');
    const toolImports: Record<string, { coldLoadMs: number; warmReadMs: number }> = {};
    for (const [name, loader] of Object.entries({
      terminal: terminalImport,
      palette: paletteImport,
    })) {
      const start = performance.now();
      loader.warm();
      await loader.load();
      const coldLoadMs = performance.now() - start;
      const warmStart = performance.now();
      await loader.load();
      toolImports[name] = { coldLoadMs, warmReadMs: performance.now() - warmStart };
    }
    passed.push('real terminal and palette imports reuse intent-warmed modules');
    const diff =
      '--- a/probe.ts\n+++ b/probe.ts\n@@ -1,1500 +1,1500 @@\n' +
      Array.from({ length: 1500 }, (_, n) => `-old ${n}\n+new ${n}`).join('\n');
    for (let n = 0; n < 12; n++) {
      render(
        <>
          <DiffViewer filePath="probe.ts" diff={diff} />
          <MarkdownRenderer content="![Lifecycle image](./lifecycle-pixel.svg)" />
          <StreamedMermaidPreview
            identity={`probe-${n}`}
            source="flowchart LR\n A[Start] --> B[Finish]"
          />
        </>,
      );
      const deadline = performance.now() + 5000;
      while (
        !host.querySelector('[aria-label="Mermaid diagram"] svg') &&
        performance.now() < deadline
      )
        await delay(25);
      check(
        host.querySelector('[aria-label="Mermaid diagram"] svg'),
        'A real diagram must finish rendering',
      );
      const image = host.querySelector<HTMLImageElement>('img[alt="Lifecycle image"]');
      check(image?.complete && image.naturalWidth > 0, 'A real image must load');
      render(null);
      await frame();
      check(
        host.childElementCount === 0 && !document.querySelector('[id^="mezair-mermaid-"]'),
        'Closing rich output releases diff/image/diagram DOM and temporary render containers',
      );
    }
    passed.push('12 large-diff, image and Mermaid mount/close cycles release DOM');
    const intent: AgentUISurfaceIntent = {
      protocolVersion: 1,
      id: syntheticArtifactSurfaceId('popup-probe'),
      kind: 'surface',
      revision: 1,
      scope: { threadId: 'fixture' },
      lifecycle: 'presented',
      presentation: { collapsed: false, hidden: false },
      payload: {
        surfaceKind: 'unknown-fixture',
        title: 'Popup probe',
        streaming: false,
        digest: 'Synthetic',
        data: {},
      },
      createdAt: '',
      updatedAt: '',
    };
    for (let n = 0; n < 5; n++) {
      let popup: Window | undefined;
      render(
        <SurfaceWindow
          intent={intent}
          workspaceName="Fixture"
          onReady={(value) => {
            popup = value;
          }}
          onClose={noop}
        />,
      );
      await delay(80);
      check(popup && !popup.closed, 'Surface pop-out must open');
      render(null);
      await frame();
      check(popup!.closed, 'Closing the owner must close its pop-out');
    }
    passed.push('five actual surface pop-outs close with their owners');
    let webgl: { cycles: number; released: number } | undefined;
    if (Reflect.get(window, '__PERF_RICH__')) {
      const { RepositoryGarden } =
        await import('../../../src/renderer/components/repos/RepositoryGarden');
      const graph = {
        schemaVersion: 1 as const,
        repoId: 'fixture',
        repositoryName: 'Fixture',
        generatedAt: '',
        nodes: [{ id: 'root', kind: 'repository' as const, name: 'Fixture', path: '.' }],
        edges: [],
        supportedSymbolLanguages: [],
        warnings: [],
      };
      const get = HTMLCanvasElement.prototype.getContext;
      const contexts = new Set<WebGL2RenderingContext>();
      HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof get>) {
        const context = get.apply(this, args);
        if (args[0] === 'webgl2' && context) contexts.add(context as WebGL2RenderingContext);
        return context;
      } as typeof get;
      try {
        for (let n = 0; n < 3; n++) {
          render(<RepositoryGarden graph={graph} onSelectNode={noop} />);
          await delay(250);
          check(host.querySelector('canvas'), 'Garden must mount a real canvas');
          render(null);
          await delay(900);
          check(
            [...contexts].every((gl) => gl.isContextLost()),
            'Closing a garden must release its WebGL context',
          );
        }
        check(contexts.size === 3, 'Three real software WebGL contexts must have been created');
        webgl = { cycles: 3, released: contexts.size };
        passed.push('three real WebGL contexts released after garden close');
      } finally {
        HTMLCanvasElement.prototype.getContext = get;
      }
    }
    return { passed, toolImports, channelRendersDuring60Updates: 0, webgl };
  } finally {
    root.unmount();
    host.remove();
  }
}
