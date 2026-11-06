import { describe, expect, it } from 'vitest';
import { runUtilityCli, EmptyLlmResponseError } from '../utility-cli.js';

describe('utility CLI lifecycle', () => {
  it('collects the response and tolerates a closed stdin', async () => {
    expect(
      await runUtilityCli(process.execPath, ['-e', 'process.stdout.write("answer")'], {
        env: process.env,
        prompt: 'data',
      }),
    ).toBe('answer');
  });
  it('rejects excessive output and stops the process', async () => {
    await expect(
      runUtilityCli(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(10000)); setInterval(()=>{},1000)'],
        {
          env: process.env,
          outputLimit: 100,
        },
      ),
    ).rejects.toThrow('output limit');
  });
  it('cancels a running provider instead of leaving it alive until its native timeout', async () => {
    const controller = new AbortController();
    const result = runUtilityCli(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      env: process.env,
      signal: controller.signal,
    });
    controller.abort(new Error('User cancelled'));
    await expect(result).rejects.toThrow('User cancelled');
  });
  it('does not spawn an already cancelled call and identifies empty output for retries', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Already cancelled'));
    await expect(
      runUtilityCli('missing-provider', [], { env: {}, signal: controller.signal }),
    ).rejects.toThrow('Already cancelled');
    await expect(
      runUtilityCli(process.execPath, ['-e', ''], { env: process.env }),
    ).rejects.toBeInstanceOf(EmptyLlmResponseError);
  });
});
