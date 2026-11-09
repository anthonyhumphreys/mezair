import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { guardLocalChatStream } from '../local-chat-stream.js';

describe('local streaming scope boundary', () => {
  it('rejects the awaited send instead of throwing from a native stdout callback', async () => {
    let granted = true;
    const visible: string[] = [];
    const stream = guardLocalChatStream(
      () => {
        if (!granted) throw new Error('membership removed');
      },
      (delta) => visible.push(delta),
    );
    const stdout = new EventEmitter();
    stdout.on('data', stream.onPartial);
    stdout.emit('data', 'allowed');
    granted = false;
    expect(() => stdout.emit('data', 'must remain hidden')).not.toThrow();
    stdout.emit('data', 'also hidden');
    await expect(Promise.resolve().then(() => stream.finish())).rejects.toThrow(
      'membership removed',
    );
    expect(visible).toEqual(['allowed']);
  });
  it('preserves legitimate streaming and rechecks a non-streamed reply before completion', () => {
    let granted = true;
    const visible: string[] = [];
    const stream = guardLocalChatStream(
      () => {
        if (!granted) throw new Error('membership removed');
      },
      (delta) => visible.push(delta),
    );
    stream.onPartial('a');
    stream.onPartial('b');
    expect(() => stream.finish()).not.toThrow();
    expect(visible).toEqual(['a', 'b']);
    granted = false;
    expect(() => stream.finish()).toThrow('membership removed');
  });
});
