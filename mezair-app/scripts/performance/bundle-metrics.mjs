import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { resolveManifestChunk } from './bundle-manifest.mjs';

const root = resolve(process.argv[2] ?? 'out/renderer');
const manifest = JSON.parse(readFileSync(resolve(root, '.vite/manifest.json'), 'utf8'));
function closure(keys) {
  const files = new Set();
  const visit = (key) => {
    const chunk = resolveManifestChunk(manifest, key);
    if (files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  };
  for (const key of keys) visit(key);
  const bytes = [...files].map((file) => readFileSync(resolve(root, file)));
  return {
    rawBytes: bytes.reduce((total, buffer) => total + buffer.length, 0),
    gzipBytes: bytes.reduce((total, buffer) => total + gzipSync(buffer).length, 0),
    files: [...files].sort(),
  };
}
const journeys = {
  initial: ['index.html'],
  chat: ['index.html', 'components/chat/ChatView.tsx'],
  settings: [
    'index.html',
    'components/settings/SettingsView.tsx',
    'components/settings/categories/ProfileCategory.tsx',
  ],
  factories: ['index.html', 'components/factories/FactoriesView.tsx'],
  dashboards: ['index.html', 'components/overview/OverviewView.tsx'],
};
const result = {
  methodology:
    'Unique JavaScript files in the production Vite manifest static import closure for each first visit. Dynamic imports are excluded until explicitly requested. Settings includes its default appearance category. Gzip is a comparable size indicator, not Electron network traffic or a runtime memory measurement.',
  journeys: Object.fromEntries(
    Object.entries(journeys).map(([name, keys]) => [name, closure(keys)]),
  ),
};
writeFileSync(resolve(process.argv[3]), JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(result.journeys).map(([name, metrics]) => [
        name,
        { rawBytes: metrics.rawBytes, gzipBytes: metrics.gzipBytes },
      ]),
    ),
  ),
);
