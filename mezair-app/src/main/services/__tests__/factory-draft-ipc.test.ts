import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { handlers, draftFactory } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  draftFactory: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
  },
}));
vi.mock('../factory.service.js', () => ({
  draftFactory,
  ...Object.fromEntries(
    [
      'activateFactory',
      'controlFactory',
      'controlFactoryRun',
      'getFactory',
      'getFactoryRun',
      'listFactories',
      'listFactoryRuns',
      'listFactoryRunPage',
      'getFactoryRunSummary',
      'listFactoryOrganizations',
      'listFactoryOrganizationMembers',
      'listFactoryDirectory',
      'registerFactoryOrganizationKey',
      'validateFactoryOrganizationTeam',
      'previewFactory',
      'saveFactory',
    ].map((name) => [name, vi.fn()]),
  ),
}));
import { registerFactoryHandlers } from '../../ipc/factory.ipc.js';
function windowOwner(id: number) {
  return Object.assign(new EventEmitter(), { id, send: vi.fn(), isDestroyed: () => false });
}
beforeEach(() => {
  handlers.clear();
  draftFactory.mockReset();
  registerFactoryHandlers();
});
describe('factory draft IPC ownership', () => {
  it('sends progress only to its owner and ignores cancellation from another window', async () => {
    const owner = windowOwner(1);
    const other = windowOwner(2);
    let signal!: AbortSignal;
    draftFactory.mockImplementation((_request, _workspace, options) => {
      signal = options.signal;
      options.onProgress('Generating…');
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
    });
    const result = handlers.get('factories:draft')!({ sender: owner }, 'request', 'ws', 'draft-1');
    expect(owner.send).toHaveBeenCalledWith(
      'factories:draft-progress',
      expect.objectContaining({ requestId: 'draft-1', message: 'Generating…' }),
    );
    handlers.get('factories:cancel-draft')!({ sender: other }, 'draft-1');
    expect(signal.aborted).toBe(false);
    handlers.get('factories:cancel-draft')!({ sender: owner }, 'draft-1');
    await expect(result).rejects.toThrow('Draft cancelled');
    expect(owner.listenerCount('destroyed')).toBe(0);
    expect(other.send).not.toHaveBeenCalled();
  });
  it('cancels on window destruction and prevents duplicate active requests', async () => {
    const owner = windowOwner(1);
    draftFactory.mockImplementation(
      (_request, _workspace, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(options.signal.reason)),
        ),
    );
    const result = handlers.get('factories:draft')!({ sender: owner }, 'request', 'ws', 'draft-1');
    await expect(
      handlers.get('factories:draft')!({ sender: owner }, 'request', 'ws', 'draft-2'),
    ).rejects.toThrow('Cancel the current draft');
    owner.emit('destroyed');
    await expect(result).rejects.toThrow('Draft cancelled');
  });
});
