import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../map-concurrent';

describe('bounded presentation reads', () => {
  it('caps pending work while preserving source order across out-of-order completions', async () => {
    const releases = new Map<number, () => void>();
    let active = 0;
    let maximum = 0;
    const pending = mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => releases.set(item, resolve));
      active--;
      return item * 10;
    });
    expect([...releases.keys()]).toEqual([0, 1]);
    releases.get(1)!();
    await Promise.resolve();
    await Promise.resolve();
    expect([...releases.keys()]).toEqual([0, 1, 2]);
    for (const index of [0, 2, 3, 4, 5]) {
      releases.get(index)!();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await pending).toEqual([0, 10, 20, 30, 40, 50]);
    expect(maximum).toBe(2);
  });

  it('handles empty input and surfaces read failures', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    await expect(
      mapWithConcurrency([1], 1, async () => {
        throw new Error('revoked');
      }),
    ).rejects.toThrow('revoked');
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(RangeError);
  });
});
