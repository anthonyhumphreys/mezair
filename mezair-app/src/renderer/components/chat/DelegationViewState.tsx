import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';

/** Owned by the transcript, so a run moving between virtualised turns keeps its draft. */
const Context = createContext<Map<string, unknown> | null>(null);
export function DelegationViewState({ children }: { children: ReactNode }) {
  const store = useRef(new Map<string, unknown>());
  return <Context.Provider value={store.current}>{children}</Context.Provider>;
}
export function useDelegationState<T>(
  identity: string,
  name: string,
  initial: T,
): [T, (next: SetStateAction<T>) => void] {
  const store = useContext(Context);
  const key = `${identity}:${name}`;
  const [value, setValue] = useState<T>(() => (store?.has(key) ? (store.get(key) as T) : initial));
  const current = useRef(value);
  current.current = value;
  const set = useCallback(
    (next: SetStateAction<T>) => {
      const previous = store?.has(key) ? (store.get(key) as T) : current.current;
      const updated = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      current.current = updated;
      store?.set(key, updated);
      setValue(updated);
    },
    [key, store],
  );
  return [value, set];
}
