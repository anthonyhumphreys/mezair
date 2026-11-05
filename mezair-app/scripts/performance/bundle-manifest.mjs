import { basename, extname } from 'node:path';

/** Resolve a source entry despite Rollup/Vite version differences in manifest keys. */
export function resolveManifestChunk(manifest, sourcePath) {
  const exact = manifest[sourcePath];
  if (exact) return exact;

  const sourceName = basename(sourcePath, extname(sourcePath));
  const matches = Object.values(manifest).filter((chunk) => chunk.name === sourceName);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous manifest entry for ${sourcePath}: ${matches.length} chunks are named ${sourceName}.`,
    );
  }
  throw new Error(`Missing manifest entry: ${sourcePath}`);
}
