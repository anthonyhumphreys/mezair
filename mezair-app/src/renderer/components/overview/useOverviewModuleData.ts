import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  OverviewModuleInstance,
  OverviewModuleResult,
  OverviewScope,
  OverviewTimeRange,
} from '../../../shared/overview';
import { cleanIpcError } from './overview-format';
import { pollWhileVisible } from '../../utils/visible-polling';
export { useNow } from '../../hooks/useNow';

const AUTO_REFRESH_MS = 2 * 60_000;

export interface OverviewModuleData {
  result: OverviewModuleResult | null;
  /** True only while no result is available yet. */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads one module instance. Previous rows stay visible while refreshing so
 * the board never flashes empty; the main process caches network sources.
 */
export function useOverviewModuleData(
  scope: OverviewScope,
  module: OverviewModuleInstance,
  timeRange: OverviewTimeRange,
  refreshToken: number,
): OverviewModuleData {
  const [result, setResult] = useState<OverviewModuleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const inFlight = useRef<{
    key: string;
    refresh: boolean;
    promise: Promise<OverviewModuleResult>;
  } | null>(null);
  const requestKey = JSON.stringify({
    scope,
    type: module.type,
    rows: module.rows,
    config: module.config,
    timeRange,
  });
  const inputRef = useRef({ scope, module, timeRange });
  inputRef.current = { scope, module, timeRange };

  const load = useCallback(
    async (refresh: boolean) => {
      const id = ++requestId.current;
      setRefreshing(true);
      try {
        let request = inFlight.current;
        if (!request || request.key !== requestKey || (refresh && !request.refresh)) {
          const current = {
            key: requestKey,
            refresh,
            promise: window.mezair.overview.loadModule({ ...inputRef.current, refresh }),
          };
          current.promise = current.promise.finally(() => {
            if (inFlight.current === current) inFlight.current = null;
          });
          inFlight.current = current;
          request = current;
        }
        const next = await request.promise;
        if (id !== requestId.current) return;
        setResult(next);
        setError(null);
      } catch (err) {
        if (id === requestId.current) setError(cleanIpcError(err));
      } finally {
        if (id === requestId.current) setRefreshing(false);
      }
    },
    // `module` identity changes with edits; requestKey captures what matters.
    [requestKey],
  );

  useEffect(() => {
    setResult(null);
    setError(null);
    void load(false);
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const previousToken = useRef(refreshToken);
  useEffect(() => {
    if (previousToken.current === refreshToken) return;
    previousToken.current = refreshToken;
    void load(true);
  }, [load, refreshToken]);

  useEffect(
    () => pollWhileVisible(() => load(false), AUTO_REFRESH_MS, { immediate: false }),
    [load],
  );

  return {
    result,
    loading: result === null && error === null,
    refreshing,
    error,
    refresh: () => void load(true),
  };
}
