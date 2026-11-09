import { EventEmitter } from 'node:events';
import { afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => mocks);
import { runReviewedGit } from '../git-reviewed-command.js';
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: 123123,
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    kill: vi.fn(),
  });
  mocks.spawn.mockReturnValue(child);
  return child;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe.skipIf(process.platform === 'win32')('reviewed Git writer termination', () => {
  it('does not reject and release caller ownership until child close and descendant exit', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    let live = true;
    mocks.execFile.mockImplementation((_cmd, _args, _options, callback) => {
      callback(null, { stdout: live ? '123123 S\n' : '123123 Z\n', stderr: '' });
    });
    let finished = false;
    const result = runReviewedGit('/repo', ['diff'], 100).catch((error) => {
      finished = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    child.emit('close', null);
    await vi.advanceTimersByTimeAsync(30);
    expect(finished).toBe(false);
    live = false;
    await vi.advanceTimersByTimeAsync(30);
    expect((await result).message).toContain('timed out');
    expect(process.kill).toHaveBeenCalledWith(-123123, 'SIGKILL');
  });
  it('accepts progressing long operations and applies a separate idle limit', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const result = runReviewedGit('/repo', ['pull', '--progress'], {
      timeoutMs: 1000,
      idleTimeoutMs: 100,
      label: 'Git pull',
    });
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(80);
      child.stderr.emit('data', 'progress\n');
    }
    child.emit('close', 0);
    expect((await result).code).toBe(0);
    expect((await result).stderr).toContain('progress');
  });
});
