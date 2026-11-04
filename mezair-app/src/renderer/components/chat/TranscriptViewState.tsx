import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export function createTranscriptViewState() {
  const values = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key: string, fallback: boolean) => values.get(key) ?? fallback,
    set(key: string, value: boolean, fallback: boolean) {
      if (value === fallback) values.delete(key);
      else values.set(key, value);
      listeners.get(key)?.forEach((notify) => notify());
    },
    subscribe(key: string, notify: () => void) {
      let group = listeners.get(key);
      if (!group) listeners.set(key, (group = new Set()));
      group.add(notify);
      return () => {
        group.delete(notify);
        if (!group.size) listeners.delete(key);
      };
    },
  };
}
const StateContext = createContext<{
  store: ReturnType<typeof createTranscriptViewState>;
  path: string;
} | null>(null);
const noSubscribe = () => () => {};

export function TranscriptViewState({
  store,
  path,
  children,
}: {
  store: ReturnType<typeof createTranscriptViewState>;
  path: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ store, path }), [store, path]);
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}
export function TranscriptViewScope({ name, children }: { name: string; children: ReactNode }) {
  const parent = useContext(StateContext);
  const value = useMemo(
    () => (parent ? { store: parent.store, path: `${parent.path}/${name}` } : null),
    [parent, name],
  );
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}

/** Only explicit disclosure choices survive windowing; the transcript owns and releases the map. */
export function useTranscriptDisclosure(
  name: string,
  initial = false,
): [boolean, (value: boolean | ((previous: boolean) => boolean)) => void] {
  const context = useContext(StateContext);
  const key = `${context?.path ?? ''}/${name}`;
  const [local, setLocal] = useState(initial);
  const subscribe = useCallback(
    (notify: () => void) => context?.store.subscribe(key, notify) ?? noSubscribe(),
    [context, key],
  );
  const snapshot = useCallback(
    () => (context ? context.store.get(key, initial) : local),
    [context, key, initial, local],
  );
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const set = useCallback(
    (next: boolean | ((previous: boolean) => boolean)) => {
      if (!context) {
        setLocal(next);
        return;
      }
      const previous = context.store.get(key, initial);
      context.store.set(key, typeof next === 'function' ? next(previous) : next, initial);
    },
    [context, key, initial],
  );
  return [value, set];
}
