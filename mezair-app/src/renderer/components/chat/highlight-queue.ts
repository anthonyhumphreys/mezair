interface HighlightWorker {
  postMessage: (message: { id: number; code: string; language: string }) => void;
  onmessage: ((event: MessageEvent<{ id: number; html: string }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate: () => void;
}

interface Consumer {
  finish: (html: string) => void;
  signal?: AbortSignal;
  abort: () => void;
}
interface Job {
  id: number;
  key: string;
  code: string;
  language: string;
  consumers: Set<Consumer>;
}

/** One worker, one running request, bounded pending work and cancellable subscribers. */
export function createHighlightQueue(createWorker: () => HighlightWorker, idleMs = 60_000) {
  let worker: HighlightWorker | null = null;
  let current: Job | null = null;
  let sequence = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const queued: Job[] = [];
  const jobs = new Map<string, Job>();
  const plaintext = (code: string) =>
    `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
  const finish = (job: Job, html: string) => {
    jobs.delete(job.key);
    for (const consumer of job.consumers) {
      consumer.signal?.removeEventListener('abort', consumer.abort);
      consumer.finish(html);
    }
    job.consumers.clear();
  };
  const dispose = () => {
    clearTimeout(idle);
    clearTimeout(deadline);
    worker?.terminate();
    worker = null;
    for (const job of jobs.values()) finish(job, plaintext(job.code));
    current = null;
    queued.length = 0;
  };
  const pump = () => {
    clearTimeout(idle);
    if (current) return;
    const next = queued.shift();
    if (!next) {
      if (worker) idle = setTimeout(dispose, idleMs);
      return;
    }
    current = next;
    try {
      if (!worker) {
        worker = createWorker();
        worker.onmessage = ({ data }) => {
          if (!current || data.id !== current.id) return;
          clearTimeout(deadline);
          finish(current, data.html);
          current = null;
          pump();
        };
        worker.onerror = () => dispose();
      }
      deadline = setTimeout(dispose, 15_000);
      worker.postMessage({ id: next.id, code: next.code, language: next.language });
    } catch {
      dispose();
    }
  };
  return {
    highlight(code: string, language: string, signal?: AbortSignal): Promise<string> {
      if (signal?.aborted) return Promise.resolve(plaintext(code));
      const key = `${language}:${code}`;
      let job = jobs.get(key);
      if (!job) {
        if (jobs.size >= 32) return Promise.resolve(plaintext(code));
        job = { id: ++sequence, key, code, language, consumers: new Set() };
        jobs.set(key, job);
        queued.push(job);
      }
      const target = job;
      return new Promise((resolve) => {
        const consumer: Consumer = {
          finish: resolve,
          signal,
          abort: () => {
            target.consumers.delete(consumer);
            signal?.removeEventListener('abort', consumer.abort);
            resolve(plaintext(code));
            if (target === current && target.consumers.size === 0) {
              clearTimeout(deadline);
              worker?.terminate();
              worker = null;
              jobs.delete(key);
              current = null;
              pump();
            } else if (target.consumers.size === 0) {
              const index = queued.indexOf(target);
              if (index >= 0) queued.splice(index, 1);
              jobs.delete(key);
            }
          },
        };
        target.consumers.add(consumer);
        signal?.addEventListener('abort', consumer.abort, { once: true });
        pump();
      });
    },
    dispose,
  };
}
