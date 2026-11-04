/** Share a resource limit across callers instead of creating one pool per request. */
export function createAsyncLimit(concurrency: number) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error('Concurrency must be a positive integer.');
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(action: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await action();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
