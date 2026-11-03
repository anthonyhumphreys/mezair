import { useEffect, useState } from 'react';
import { pollWhileVisible } from '../utils/visible-polling';

/** Relative-time labels do no work while the window is hidden and catch up on return. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => pollWhileVisible(async () => setNow(Date.now()), intervalMs), [intervalMs]);
  return now;
}
