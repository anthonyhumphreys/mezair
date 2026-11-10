import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from 'react';

/** Owned by the transcript, so a run moving between virtualised turns keeps its draft. */
interface ViewStore {
  values: Map<string, unknown>;
  listeners: Map<string, Set<() => void>>;
}
const newStore = (): ViewStore => ({ values: new Map(), listeners: new Map() });
const Context = createContext<ViewStore | null>(null);
export function DelegationViewState({ children }: { children: ReactNode }) {
  const store = useRef<ViewStore | null>(null);
  store.current ??= newStore();
  return <Context.Provider value={store.current}>{children}</Context.Provider>;
}
export function useDelegationState<T>(
  identity: string,
  name: string,
  initial: T,
): [T, (next: SetStateAction<T>) => void] {
  const shared = useContext(Context);
  const local = useRef<ViewStore | null>(null);
  const store = shared ?? (local.current ??= newStore());
  const key = `${identity}:${name}`;
  if (!store.values.has(key)) store.values.set(key, initial);
  const subscribe = useCallback(
    (listener: () => void) => {
      const listeners = store.listeners.get(key) ?? new Set();
      store.listeners.set(key, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) store.listeners.delete(key);
      };
    },
    [key, store],
  );
  const snapshot = useCallback(() => store.values.get(key) as T, [key, store]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const set = useCallback(
    (next: SetStateAction<T>) => {
      const previous = store.values.get(key) as T;
      const updated = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      store.values.set(key, updated);
      store.listeners.get(key)?.forEach((listener) => listener());
    },
    [key, store],
  );
  return [value, set];
}
