import type { ChildProcess } from 'node:child_process';

/** A CLI or an SDK-backed transport with the same stream/lifecycle boundary. */
export type AgentProcess = Pick<
  ChildProcess,
  'stdin' | 'stdout' | 'stderr' | 'pid' | 'exitCode' | 'signalCode' | 'kill'
> & {
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
};
