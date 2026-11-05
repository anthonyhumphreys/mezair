import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveManifestChunk } from './bundle-manifest.mjs';

test('manifest source resolution prefers an exact key', () => {
  const exact = { file: 'exact.js', name: 'ProfileCategory' };
  const manifest = {
    'components/settings/categories/ProfileCategory.tsx': exact,
    '_ProfileCategory-abc.js': { file: 'hashed.js', name: 'ProfileCategory' },
  };

  assert.equal(
    resolveManifestChunk(manifest, 'components/settings/categories/ProfileCategory.tsx'),
    exact,
  );
});

test('manifest source resolution falls back to a unique chunk name', () => {
  const expected = { file: 'assets/ProfileCategory-abc.js', name: 'ProfileCategory' };
  const manifest = { '_ProfileCategory-abc.js': expected };

  assert.equal(
    resolveManifestChunk(manifest, 'components/settings/categories/ProfileCategory.tsx'),
    expected,
  );
});

test('manifest source resolution rejects missing and ambiguous fallbacks', () => {
  assert.throws(
    () => resolveManifestChunk({}, 'components/settings/categories/ProfileCategory.tsx'),
    /Missing manifest entry/,
  );
  assert.throws(
    () =>
      resolveManifestChunk(
        {
          '_ProfileCategory-a.js': { file: 'a.js', name: 'ProfileCategory' },
          '_ProfileCategory-b.js': { file: 'b.js', name: 'ProfileCategory' },
        },
        'components/settings/categories/ProfileCategory.tsx',
      ),
    /Ambiguous manifest entry/,
  );
});
