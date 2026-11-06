import { ipcMain } from 'electron';
import type {
  FactoryActivateInput,
  FactoryControlInput,
  FactoryDefinitionInput,
  FactoryPreviewOptions,
  FactoryRunControlInput,
  FactorySaveInput,
} from '../../shared/factories.js';
import {
  activateFactory,
  controlFactory,
  controlFactoryRun,
  draftFactory,
  getFactory,
  getFactoryRun,
  listFactories,
  listFactoryRuns,
  listFactoryRunPage,
  getFactoryRunSummary,
  listFactoryOrganizations,
  listFactoryOrganizationMembers,
  listFactoryDirectory,
  registerFactoryOrganizationKey,
  validateFactoryOrganizationTeam,
  previewFactory,
  saveFactory,
} from '../services/factory.service.js';

export function registerFactoryHandlers(): void {
  const drafts = new Map<number, { requestId: string; controller: AbortController }>();
  ipcMain.handle(
    'factories:draft',
    async (event, request: string, workspaceId: string, requestId = 'legacy') => {
      if (typeof requestId !== 'string' || requestId.length > 100)
        throw new Error('Invalid draft request.');
      const owner = event.sender;
      if (drafts.has(owner.id))
        throw new Error('Cancel the current draft before starting another.');
      const controller = new AbortController();
      drafts.set(owner.id, { requestId, controller });
      const started = Date.now();
      const cancel = () => controller.abort(new Error('Draft cancelled.'));
      owner.once('destroyed', cancel);
      const timeout = setTimeout(
        () => controller.abort(new Error('Draft timed out. Try a shorter description.')),
        90_000,
      );
      try {
        return await draftFactory(request, workspaceId, {
          signal: controller.signal,
          onProgress: (message) => {
            if (!owner.isDestroyed() && !controller.signal.aborted)
              owner.send('factories:draft-progress', {
                requestId,
                message,
                elapsedMs: Date.now() - started,
              });
          },
        });
      } finally {
        clearTimeout(timeout);
        owner.removeListener('destroyed', cancel);
        drafts.delete(owner.id);
      }
    },
  );
  ipcMain.handle('factories:cancel-draft', (event, requestId: string) => {
    const draft = drafts.get(event.sender.id);
    if (draft?.requestId === requestId) draft.controller.abort(new Error('Draft cancelled.'));
  });
  ipcMain.handle(
    'factories:preview',
    (
      _event,
      definition: FactoryDefinitionInput,
      factoryId?: string,
      options?: FactoryPreviewOptions,
    ) => previewFactory(definition, factoryId, { repinWorkflow: options?.repinWorkflow === true }),
  );
  ipcMain.handle('factories:save', (_event, input: FactorySaveInput) => saveFactory(input));
  ipcMain.handle('factories:activate', (_event, input: FactoryActivateInput) =>
    activateFactory(input),
  );
  ipcMain.handle('factories:list', (_event, workspaceId?: string) => listFactories(workspaceId));
  ipcMain.handle('factories:get', (_event, factoryId: string) => getFactory(factoryId));
  ipcMain.handle('factories:list-runs', (_event, factoryId: string) => listFactoryRuns(factoryId));
  ipcMain.handle(
    'factories:list-run-page',
    (_event, request: import('../../shared/factories.js').FactoryRunPageRequest) =>
      listFactoryRunPage(request),
  );
  ipcMain.handle('factories:run-summary', (_event, factoryId: string) =>
    getFactoryRunSummary(factoryId),
  );
  ipcMain.handle('factories:get-run', (_event, runId: string) => getFactoryRun(runId));
  ipcMain.handle('factories:control', (_event, input: FactoryControlInput) =>
    controlFactory(input),
  );
  ipcMain.handle('factories:control-run', (_event, input: FactoryRunControlInput) =>
    controlFactoryRun(input),
  );
  ipcMain.handle('factories:organizations', () => listFactoryOrganizations());
  ipcMain.handle('factories:organization-members', (_event, organizationId: string) =>
    listFactoryOrganizationMembers(organizationId),
  );
  ipcMain.handle(
    'factories:organization-team',
    (
      _event,
      organizationId: string,
      source: { host: 'github.com'; owner: string; repo: string },
      teamId: string,
    ) => validateFactoryOrganizationTeam(organizationId, source, teamId),
  );
  ipcMain.handle('factories:organization-key-register', (_event, organizationId: string) =>
    registerFactoryOrganizationKey(organizationId),
  );
  ipcMain.handle('factories:directory', (_event, organizationId?: string) =>
    listFactoryDirectory(organizationId),
  );
}
