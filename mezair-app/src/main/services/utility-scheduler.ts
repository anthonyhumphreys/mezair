/** One interactive and one background utility call at a time, including retries. */
export class UtilityScheduler {
  private lanes = {
    foreground: { active: false, pending: [] as Array<() => void> },
    background: { active: false, pending: [] as Array<() => void> },
  };

  run<T>(
    task: () => Promise<T>,
    options: {
      priority?: 'foreground' | 'background';
      signal?: AbortSignal;
      onProgress?: (message: string) => void;
    } = {},
  ): Promise<T> {
    const lane = this.lanes[options.priority ?? 'foreground'];
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      if (lane.pending.length >= 32) {
        reject(new Error('Too many pending AI requests. Try again shortly.'));
        return;
      }
      let started = false;
      const abort = () => {
        if (!started) {
          const index = lane.pending.indexOf(start);
          if (index >= 0) lane.pending.splice(index, 1);
        }
        reject(options.signal?.reason ?? new Error('Request cancelled.'));
        if (!started) options.signal?.removeEventListener('abort', abort);
      };
      const start = () => {
        started = true;
        lane.active = true;
        // Keep the slot until provider cleanup finishes, even if the caller cancels.
        Promise.resolve()
          .then(() => {
            options.signal?.throwIfAborted();
            return task();
          })
          .then(resolve, reject)
          .finally(() => {
            options.signal?.removeEventListener('abort', abort);
            lane.active = false;
            lane.pending.shift()?.();
          });
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (lane.active) {
        lane.pending.push(start);
        options.onProgress?.('Waiting for an earlier AI request…');
      } else start();
    });
  }
}
