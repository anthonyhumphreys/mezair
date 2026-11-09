import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  registerManagedWorkerPaths,
  assertNoManagedWorkerWrites,
  retainManagedWorkerProcess,
} from '../managed-worker-paths.js';
import { acquireCheckpointPaths } from '../chat-checkpoint-locks.js';

describe('managed worker checkout ownership', () => {
  it('retains native ownership after turn completion until process close', () => {
    const proc = Object.assign(new EventEmitter(), { pid: 123123 });
    const finish = registerManagedWorkerPaths(['/synthetic/worker']);
    retainManagedWorkerProcess(proc as ChildProcess, ['/synthetic/worker']);
    finish();
    expect(() => assertNoManagedWorkerWrites(['/synthetic/worker'])).toThrow('delegated workers');
    proc.emit('close', 0);
    expect(() => assertNoManagedWorkerWrites(['/synthetic/worker'])).not.toThrow();
  });
  it('protects aliases and nested writers until every delegated worker finishes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mezair-worker-'));
    mkdirSync(path.join(root, 'repo'));
    symlinkSync(
      path.join(root, 'repo'),
      path.join(root, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const first = registerManagedWorkerPaths([path.join(root, 'repo')]);
    const second = registerManagedWorkerPaths([path.join(root, 'repo', 'child')]);
    try {
      expect(() => assertNoManagedWorkerWrites([path.join(root, 'alias')])).toThrow(
        'delegated workers',
      );
      first();
      expect(() => assertNoManagedWorkerWrites([root])).toThrow('delegated workers');
      second();
      expect(() => assertNoManagedWorkerWrites([root])).not.toThrow();
      const release = acquireCheckpointPaths([root]);
      try {
        expect(() => registerManagedWorkerPaths([path.join(root, 'repo')])).toThrow(
          'Wait for file rewind',
        );
      } finally {
        release();
      }
      const finish = registerManagedWorkerPaths([root]);
      finish();
    } finally {
      first();
      second();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
