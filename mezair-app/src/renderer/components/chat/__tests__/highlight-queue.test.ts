import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHighlightQueue } from '../highlight-queue';
afterEach(() => vi.useRealTimers());
function setup() {
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as null | ((e: MessageEvent<{ id: number; html: string }>) => void),
    onerror: null as null | ((e: ErrorEvent) => void),
  };
  const factory = vi.fn(() => worker);
  const queue = createHighlightQueue(factory, 100);
  const reply = () => {
    const job = worker.postMessage.mock.calls.at(-1)![0];
    worker.onmessage?.({ data: { id: job.id, html: '<pre>result</pre>' } } as MessageEvent);
  };
  return { worker, factory, queue, reply };
}
describe('highlight queue ownership', () => {
  it('deduplicates work, runs sequentially and releases an idle worker', async () => {
    vi.useFakeTimers();
    const { queue, worker, factory, reply } = setup();
    const a = queue.highlight('one', 'ts'),
      duplicate = queue.highlight('one', 'ts'),
      b = queue.highlight('two', 'ts');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    reply();
    await expect(a).resolves.toContain('result');
    await expect(duplicate).resolves.toContain('result');
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    reply();
    await b;
    vi.advanceTimersByTime(101);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('cancels queued work, ignores obsolete running output and recovers after failure', async () => {
    const { queue, worker, reply } = setup();
    const a = new AbortController(),
      b = new AbortController();
    const first = queue.highlight('<old>', 'ts', a.signal),
      second = queue.highlight('queued', 'ts', b.signal);
    b.abort();
    a.abort();
    await expect(first).resolves.toContain('&lt;old&gt;');
    await second;
    reply();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const failed = queue.highlight('next', 'ts');
    worker.onerror?.({} as ErrorEvent);
    await expect(failed).resolves.toContain('next');
    const recovered = queue.highlight('recovered', 'ts');
    reply();
    await recovered;
    queue.dispose();
  });
  it('bounds pending requests and settles every consumer on disposal', async () => {
    const { queue, worker } = setup();
    const pending = Array.from({ length: 100 }, (_, n) => queue.highlight(String(n), 'ts'));
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    queue.dispose();
    expect(await Promise.all(pending)).toHaveLength(100);
  });
});
