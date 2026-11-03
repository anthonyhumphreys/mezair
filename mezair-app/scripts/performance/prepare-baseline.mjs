// Rebuild an immutable baseline with the same synthetic fixture and installed toolchain.
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [revision, destination] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(revision ?? '') || !destination)
  throw Error('Pass an immutable commit SHA and an empty output directory.');
const root = resolve('..'),
  target = resolve(destination);
mkdirSync(target, { recursive: true });
execFileSync('tar', ['-x'], {
  cwd: target,
  input: execFileSync('git', ['archive', revision], { cwd: root, maxBuffer: 128 * 1024 * 1024 }),
});
symlinkSync(
  resolve('node_modules'),
  join(target, 'mezair-app/node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
cpSync('scripts/performance', join(target, 'mezair-app/scripts/performance'), { recursive: true });
const fixture = join(target, 'mezair-app/scripts/performance/fixture/main.tsx');
writeFileSync(
  fixture,
  readFileSync(fixture, 'utf8').replace(/  async checkAdvanced\(\) \{[\s\S]*?\n  \},\n/, ''),
);
console.log(JSON.stringify({ revision, root: target }));
