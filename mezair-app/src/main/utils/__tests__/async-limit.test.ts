import { expect, it } from 'vitest';
import { createAsyncLimit } from '../async-limit';
it('shares four permits across batches, transfers reservations and releases rejected jobs', async () => {
  const limit = createAsyncLimit(4);
  let active = 0,
    peak = 0;
  const work = async (n: number) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (n % 7 === 0) throw Error('expected');
    return n;
  };
  const result = await Promise.allSettled(
    Array.from({ length: 80 }, (_, n) => limit(() => work(n))),
  );
  expect(peak).toBe(4);
  expect(active).toBe(0);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(68);
  await expect(limit(async () => 123)).resolves.toBe(123);
});
