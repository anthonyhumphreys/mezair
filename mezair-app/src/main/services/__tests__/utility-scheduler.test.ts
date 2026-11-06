import { describe, expect, it, vi } from 'vitest';
import { UtilityScheduler } from '../utility-scheduler.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('utility scheduling', () => {
  it('starts a draft while indexing is busy, with at most one call per lane', async () => {
    const scheduler = new UtilityScheduler();
    const indexing = deferred();
    const draft = deferred();
    const nextIndex = vi.fn(async () => 'next index');
    const nextDraft = vi.fn(async () => 'next draft');
    const indexRun = scheduler.run(() => indexing.promise, { priority: 'background' });
    const queuedIndex = scheduler.run(nextIndex, { priority: 'background' });
    const draftRun = scheduler.run(() => draft.promise);
    const queuedDraft = scheduler.run(nextDraft);
    await Promise.resolve();
    expect(nextIndex).not.toHaveBeenCalled();
    expect(nextDraft).not.toHaveBeenCalled();
    draft.resolve();
    await draftRun;
    expect(await queuedDraft).toBe('next draft');
    expect(nextIndex).not.toHaveBeenCalled();
    indexing.resolve();
    await indexRun;
    expect(await queuedIndex).toBe('next index');
  });

  it('removes a cancelled queued draft without ever invoking its provider', async () => {
    const scheduler = new UtilityScheduler();
    const running = deferred();
    const first = scheduler.run(() => running.promise);
    const controller = new AbortController();
    const provider = vi.fn();
    const queued = scheduler.run(provider, { signal: controller.signal });
    controller.abort(new Error('Cancelled by user'));
    await expect(queued).rejects.toThrow('Cancelled by user');
    running.resolve();
    await first;
    await scheduler.run(async () => undefined);
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps a cancelled provider slot occupied until process cleanup finishes', async () => {
    const scheduler = new UtilityScheduler();
    const cleanup = deferred();
    const controller = new AbortController();
    const first = scheduler.run(() => cleanup.promise, { signal: controller.signal });
    await Promise.resolve();
    controller.abort(new Error('Cancelled'));
    await expect(first).rejects.toThrow('Cancelled');
    const provider = vi.fn(async () => 'done');
    const next = scheduler.run(provider);
    await Promise.resolve();
    expect(provider).not.toHaveBeenCalled();
    cleanup.resolve();
    expect(await next).toBe('done');
  });

  it('recovers from provider failure and bounds pending requests', async () => {
    const scheduler = new UtilityScheduler();
    const running = deferred();
    const first = scheduler.run(() => running.promise);
    const queued = Array.from({ length: 32 }, () => scheduler.run(async () => undefined));
    await expect(scheduler.run(async () => undefined)).rejects.toThrow('Too many');
    running.resolve();
    await Promise.all([first, ...queued]);
    await expect(
      scheduler.run(async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await scheduler.run(async () => 'recovered')).toBe('recovered');
  });
});
