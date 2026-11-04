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
// The reference shares the installed toolchain. Match local CLI dependency names
// after a scope change so packaging can resolve those same installed packages.
const manifestPath = join(target, 'mezair-app/package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const installedDependencies = Object.entries(
  JSON.parse(readFileSync('package.json', 'utf8')).dependencies,
);
for (const [name, specifier] of Object.entries(manifest.dependencies)) {
  if (!specifier.startsWith('file:')) continue;
  const matches = installedDependencies.filter(
    ([, installedSpecifier]) => installedSpecifier === specifier,
  );
  if (matches.length !== 1)
    throw Error(`Expected one installed local dependency for ${specifier}.`);
  const [installedName] = matches[0];
  if (installedName !== name) {
    if (manifest.dependencies[installedName])
      throw Error(`Duplicate local dependency ${installedName}.`);
    delete manifest.dependencies[name];
    manifest.dependencies[installedName] = specifier;
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
cpSync('scripts/performance', join(target, 'mezair-app/scripts/performance'), { recursive: true });
const fixture = join(target, 'mezair-app/scripts/performance/fixture/main.tsx');
writeFileSync(
  fixture,
  readFileSync(fixture, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/  async checkAdvanced\(\) \{[\s\S]*?\n  \},\n/, ''),
);
console.log(JSON.stringify({ revision, root: target }));

if (readFileSync(fixture, 'utf8').includes("import('./advanced-checks')"))
  throw Error('Baseline fixture still imports candidate-only checks.');
