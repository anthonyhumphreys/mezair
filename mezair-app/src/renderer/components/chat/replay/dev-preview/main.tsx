import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { MezairAPI } from '../../../../../shared/ipc-api';
import type { ThemeDesignOptions, ThemeDesignRequest } from '../../../../../shared/theme-design';
import type {
  ChatArtifactAnnotation,
  ChatArtifactAnnotationInput,
  ChatArtifactAnnotationPatch,
} from '../../../../../shared/types';
import type { SurfacesApi } from '../../../../../shared/surfaces/ipc';
import type { SurfaceComment } from '../../../../../shared/surfaces/types';
import { ReviewPreview, installReviewPreview } from '../ReviewPreview';
import { ChatReplayPreview } from '../ChatReplayPreview';
import { ThemesPreview, THEMES_PREVIEW_CUSTOM_THEME } from '../../../settings/ThemesPreview';
import { ComposerPreview } from '../ComposerPreview';
import { ChatInteractionPreview } from '../ChatInteractionPreview';
import { PreviewToolbarPreview } from '../PreviewToolbarPreview';
import { ValidationPreview } from '../ValidationPreview';
import {
  SkillsRecommendationsPreview,
  installSkillsRecommendationsPreview,
} from '../SkillsRecommendationsPreview';
import { FactoriesPreview, installFactoriesPreviewBridge } from '../FactoriesPreview';
import { MeshPreview, installMeshPreviewBridge } from '../MeshPreview';
import {
  DeliveryReadinessPreview,
  installDeliveryPreviewBridge,
} from '../DeliveryReadinessPreview';
import {
  REPLAY_SURFACE_ARTIFACTS,
  REPLAY_SURFACE_ARTIFACT_REVISIONS,
  REPLAY_SURFACE_SKETCHES,
} from '../chat-replay-surface-fixtures';
import '../../../../styles/global.css';
import './preview.css';

const noopUnsubscribe = () => undefined;
let localAnnotations: ChatArtifactAnnotation[] = [];
let nextAnnotationId = 0;

// In-memory surface store so artifact, sketch, revision and comment views render offline.
const SHARING_DISABLED = 'Sharing is disabled in the synthetic replay.';
let localArtifacts = [...REPLAY_SURFACE_ARTIFACTS];
let localSketches = [...REPLAY_SURFACE_SKETCHES];
let localSurfaceComments: SurfaceComment[] = [];
let nextSurfaceCommentId = 0;

const localSurfaces: SurfacesApi = {
  listValidations: async () => [],
  runAction: async (request) => ({
    ok: true,
    message: `Synthetic replay: "${request.action}" was not executed.`,
  }),
  listComments: async (surfaceId) =>
    localSurfaceComments.filter((comment) => comment.surfaceId === surfaceId),
  addComment: async (input) => {
    const now = new Date().toISOString();
    const comment: SurfaceComment = {
      id: `fixture-surface-comment-${++nextSurfaceCommentId}`,
      surfaceId: input.surfaceId,
      anchor: input.anchor,
      body: input.body,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    localSurfaceComments = [...localSurfaceComments, comment];
    return comment;
  },
  setCommentStatus: async (commentId, status) => {
    const existing = localSurfaceComments.find((comment) => comment.id === commentId);
    if (!existing) throw new Error('Synthetic comment was not found.');
    const updated = { ...existing, status, updatedAt: new Date().toISOString() };
    localSurfaceComments = localSurfaceComments.map((comment) =>
      comment.id === commentId ? updated : comment,
    );
    return updated;
  },
  getSketch: async (sketchId) => localSketches.find((sketch) => sketch.id === sketchId) ?? null,
  keepSketch: async (sketchId, title) => {
    const sketch = localSketches.find((candidate) => candidate.id === sketchId);
    if (!sketch) throw new Error('Synthetic sketch was not found.');
    const now = new Date().toISOString();
    const artifact = {
      id: `fixture-kept-${sketch.id}`,
      threadId: sketch.threadId,
      title: title ?? sketch.title,
      kind: 'html' as const,
      storage: 'session' as const,
      relativePath: `${sketch.id}.html`,
      content: sketch.html,
      version: 1,
      status: 'draft' as const,
      visibility: 'local' as const,
      source: 'assistant' as const,
      createdAt: now,
      updatedAt: now,
    };
    localArtifacts = [...localArtifacts.filter((item) => item.id !== artifact.id), artifact];
    localSketches = localSketches.map((candidate) =>
      candidate.id === sketchId ? { ...candidate, keptArtifactId: artifact.id } : candidate,
    );
    return artifact;
  },
  getArtifact: async (artifactId) => localArtifacts.find((item) => item.id === artifactId) ?? null,
  listArtifactRevisions: async (artifactId) =>
    REPLAY_SURFACE_ARTIFACT_REVISIONS.filter((revision) => revision.artifactId === artifactId),
  getArtifactRevision: async (artifactId, version) =>
    REPLAY_SURFACE_ARTIFACT_REVISIONS.find(
      (revision) => revision.artifactId === artifactId && revision.version === version,
    ) ?? null,
};

const localShares = {
  pickupPending: async () => false,
  onPickupRequested: () => noopUnsubscribe,
  preparePickup: async () => null,
  confirmPickup: async () => {
    throw new Error(SHARING_DISABLED);
  },
  cancelPickup: async () => undefined,
  accessOptions: async () => ({ available: false, organizationSharing: false, organizations: [] }),
  previewTicket: async () => {
    throw new Error(SHARING_DISABLED);
  },
  attachTicket: async () => {
    throw new Error(SHARING_DISABLED);
  },
  available: async () => false,
  list: async () => [],
  preview: async () => {
    throw new Error(SHARING_DISABLED);
  },
  publish: async () => {
    throw new Error(SHARING_DISABLED);
  },
  update: async () => {
    throw new Error(SHARING_DISABLED);
  },
  revoke: async () => {
    throw new Error(SHARING_DISABLED);
  },
  copyLink: async () => {
    throw new Error(SHARING_DISABLED);
  },
};

const localMezairBridge = {
  chat: {
    listDelegations: async () => [],
    prepareAttachments: async () => [],
    selectAttachments: async () => [],
    searchFileMentions: async () => [],
    listArtifactAnnotations: async (artifactId: string) =>
      localAnnotations.filter((annotation) => annotation.artifactId === artifactId),
    createArtifactAnnotation: async (input: ChatArtifactAnnotationInput) => {
      const now = new Date().toISOString();
      const annotation: ChatArtifactAnnotation = {
        id: `fixture-annotation-${++nextAnnotationId}`,
        artifactId: input.artifactId,
        body: input.body,
        quote: input.quote,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      localAnnotations = [annotation, ...localAnnotations];
      return annotation;
    },
    updateArtifactAnnotation: async (id: string, patch: ChatArtifactAnnotationPatch) => {
      const existing = localAnnotations.find((annotation) => annotation.id === id);
      if (!existing) throw new Error('Synthetic annotation was not found.');
      const { quote, ...fields } = patch;
      const updated: ChatArtifactAnnotation = {
        ...existing,
        ...fields,
        ...(quote === undefined ? {} : { quote: quote ?? undefined }),
        updatedAt: new Date().toISOString(),
      };
      localAnnotations = localAnnotations.map((annotation) =>
        annotation.id === id ? updated : annotation,
      );
      return updated;
    },
    deleteArtifactAnnotation: async (id: string) => {
      localAnnotations = localAnnotations.filter((annotation) => annotation.id !== id);
      return true;
    },
    discardArtifact: async (artifactId: string) => {
      localArtifacts = localArtifacts.filter((item) => item.id !== artifactId);
      return true;
    },
  },
  surfaces: localSurfaces,
  shares: localShares,
  codexRegistry: {
    snapshot: async () => ({ skills: [] }),
  },
  settings: {
    getThemeDesignOptions: async (): Promise<ThemeDesignOptions> => ({
      defaultProvider: 'codex',
      providers: [
        {
          id: 'codex',
          label: 'Synthetic Codex',
          defaultModel: 'gpt-6.1-sol',
          models: [
            { id: 'gpt-6.1-sol', label: 'GPT 6.1 Sol' },
            { id: 'gpt-6-astra', label: 'GPT 6 Astra' },
          ],
        },
        {
          id: 'claude',
          label: 'Synthetic Claude',
          defaultModel: 'synthetic-sonnet',
          models: [{ id: 'synthetic-sonnet', label: 'Synthetic Sonnet' }],
        },
      ],
    }),
    designTheme: async (request: ThemeDesignRequest) => {
      const latestUserMessage = request.messages.findLast((message) => message.role === 'user');
      if (latestUserMessage?.content.toLowerCase().includes('fail')) {
        throw new Error(
          'Synthetic preview failure. Send a new prompt to retry with a different description.',
        );
      }
      const hasQuestion = request.messages.some(
        (message) => message.role === 'assistant' && message.content.includes('garage palette'),
      );
      if (request.mode === 'guided' && !hasQuestion) {
        return {
          message: 'Synthetic preview: one choice will shape the sample palette.',
          question: {
            text: 'Should the garage palette feel warm or technical?',
            options: ['Warm and dramatic', 'Technical and precise'],
          },
        };
      }
      return {
        message: 'Synthetic preview theme is ready. Review it before saving.',
        theme: THEMES_PREVIEW_CUSTOM_THEME,
      };
    },
  },
  voice: {
    requestPermission: async () => ({
      granted: false,
      status: 'denied' as const,
      error: 'Voice input is disabled in the synthetic replay.',
    }),
    startListening: async () => ({
      success: false,
      fallback: false,
      error: 'Voice input is disabled in the synthetic replay.',
    }),
    stopListening: async () => ({ success: true }),
    getStatus: async () => ({ isListening: false }),
    onResult: () => noopUnsubscribe,
    onError: () => noopUnsubscribe,
    onStatus: () => noopUnsubscribe,
  },
  metrics: {
    track: async () => ({ ok: true }),
  },
  git: {
    generateCommitMessage: async () => 'Synthetic replay commit',
    stage: async () => undefined,
    commit: async () => 'synthetic000000000000000000000000000000000000',
    createPullRequest: async () => ({
      pullRequestUrl: null,
      branch: 'synthetic-replay',
      commitHash: 'synthetic000000000000000000000000000000000000',
      repoName: 'mezair-demo (synthetic)',
    }),
  },
} as unknown as MezairAPI;

// This bridge exists only in the standalone Vite preview entry. The production
// Electron renderer has a separate HTML entry and never imports this module.
Object.defineProperty(window, 'mezair', {
  configurable: true,
  enumerable: true,
  writable: true,
  value: localMezairBridge,
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Chat replay root element is missing.');
const toolbarPreview = new URLSearchParams(window.location.search).has('preview');
const interactionsPreview = new URLSearchParams(window.location.search).has('interactions');
const deliveryPreview = new URLSearchParams(window.location.search).has('delivery');
const composerPreview = new URLSearchParams(window.location.search).has('composer');
const validationPreview = new URLSearchParams(window.location.search).has('validation');
const skillsPreview = new URLSearchParams(window.location.search).has('skills');
const factoriesPreview = new URLSearchParams(window.location.search).has('factories');
const meshPreview = new URLSearchParams(window.location.search).has('mesh');
const themesPreview = new URLSearchParams(window.location.search).has('themes');
if (deliveryPreview) installDeliveryPreviewBridge();
if (skillsPreview) installSkillsRecommendationsPreview();
if (factoriesPreview) installFactoriesPreviewBridge();
if (meshPreview) installMeshPreviewBridge();

const reviewPreview = new URLSearchParams(window.location.search).has('review');
if (reviewPreview) installReviewPreview();
createRoot(rootElement).render(
  <StrictMode>
    <MemoryRouter>
      {reviewPreview ? (
        <ReviewPreview />
      ) : themesPreview ? (
        <ThemesPreview />
      ) : meshPreview ? (
        <MeshPreview />
      ) : factoriesPreview ? (
        <FactoriesPreview />
      ) : skillsPreview ? (
        <SkillsRecommendationsPreview />
      ) : toolbarPreview ? (
        <PreviewToolbarPreview />
      ) : interactionsPreview ? (
        <ChatInteractionPreview />
      ) : validationPreview ? (
        <ValidationPreview />
      ) : composerPreview ? (
        <ComposerPreview />
      ) : deliveryPreview ? (
        <DeliveryReadinessPreview />
      ) : (
        <ChatReplayPreview />
      )}
    </MemoryRouter>
  </StrictMode>,
);
