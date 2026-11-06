import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileContent } from '../../utils/file-walker.js';
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe('bounded repository file reads', () => {
  it('reads a prefix of a large file without corrupting UTF-8', () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'mezair-prefix-'));
    directories.push(dir);
    fs.writeFileSync(join(dir, 'large.txt'), '漢'.repeat(1_000_000));
    const content = readFileContent(dir, 'large.txt', 10);
    expect(content).toBe('漢漢漢\n... [truncated]');
    expect(readFileContent(dir, 'missing.txt')).toBe('');
  });
  it('returns complete small files without a truncation marker', () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'mezair-prefix-'));
    directories.push(dir);
    fs.writeFileSync(join(dir, 'small.txt'), 'hello 漢');
    expect(readFileContent(dir, 'small.txt', 9)).toBe('hello 漢');
  });
});
