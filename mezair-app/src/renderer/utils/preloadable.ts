/** Share the real lazy import with intent warming; retry imports that failed. */
export function preloadable<T>(loader: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  const load = () => {
    if (!pending)
      pending = loader().catch((error) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
  return {
    load,
    warm() {
      const connection =
        typeof navigator === 'undefined'
          ? undefined
          : (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (typeof document !== 'undefined' && (document.hidden || connection?.saveData)) return;
      void load().catch(() => {});
    },
  };
}
