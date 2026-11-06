/** Read-only context benchmark. No provider calls or application database writes.
 * pnpm exec esbuild scripts/benchmark-enrichment-inputs.ts --bundle --platform=node --format=cjs --outfile=/tmp/mezair-index-inputs.cjs
 * node /tmp/mezair-index-inputs.cjs /path/to/repo [/path/to/another/repo]
 */
import fs from 'node:fs';
import { analyseRepo } from '../src/main/services/indexer.service';
import { readFileContent } from '../src/main/utils/file-walker';
async function main() {
  for (const repoPath of process.argv.slice(2)) {
    const analysis = await analyseRepo(repoPath);
    let oldChars = 0,
      newChars = 0,
      oldReadBytes = 0,
      newReadBytes = 0;
    for (const mod of analysis.modules) {
      const oldInputs = mod.keyFiles
        .slice(0, 5)
        .map((file) => {
          const full = fs.readFileSync(`${repoPath}/${file}`, 'utf8');
          oldReadBytes += Buffer.byteLength(full);
          return full.slice(0, 30_000) + (full.length > 30_000 ? '\n... [truncated]' : '');
        })
        .join('\n');
      oldChars += mod.directoryTree.length + oldInputs.length;
      const newInputs = mod.keyFiles
        .slice(0, 3)
        .map((file) => {
          newReadBytes += Math.min(fs.statSync(`${repoPath}/${file}`).size, 1501);
          return `### ${file}\n${readFileContent(repoPath, file, 1500)}`;
        })
        .join('\n')
        .slice(0, 5000);
      newChars += mod.directoryTree.slice(0, 1500).length + newInputs.length;
    }
    console.log(
      JSON.stringify({
        repo: repoPath.split('/').pop(),
        files: analysis.files.length,
        modules: analysis.modules.length,
        oldModuleContextChars: oldChars,
        newModuleContextChars: newChars,
        contextReductionPercent: +(100 * (1 - newChars / oldChars)).toFixed(1),
        oldKeyFileReadBytes: oldReadBytes,
        newKeyFileReadBytes: newReadBytes,
        readReductionPercent: +(100 * (1 - newReadBytes / oldReadBytes)).toFixed(1),
        oldCallsIncludingOverview: analysis.modules.length + 1,
        newCallsIncludingOverview: Math.ceil(analysis.modules.length / 4) + 1,
      }),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
