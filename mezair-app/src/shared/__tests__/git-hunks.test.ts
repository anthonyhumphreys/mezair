import { describe, expect, it } from 'vitest';
import { buildSingleHunkPatch, parseFileDiff, selectHunk } from '../git-hunks';

const DIFF = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
-one
+ONE
 two
 three
@@ -10,2 +10,3 @@ section
 ten
+ten-and-a-half
 eleven
`;

describe('parseFileDiff', () => {
  it('splits hunks and keeps the file header', () => {
    const parsed = parseFileDiff(DIFF);
    expect(parsed.binary).toBe(false);
    expect(parsed.fileHeader.startsWith('diff --git a/a.txt b/a.txt\n')).toBe(true);
    expect(parsed.fileHeader.endsWith('+++ b/a.txt\n')).toBe(true);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, additions: 1, deletions: 1 });
    expect(parsed.hunks[1]).toMatchObject({ oldStart: 10, additions: 1, deletions: 0 });
  });

  it('rebuilds a patch with exactly one hunk', () => {
    const parsed = parseFileDiff(DIFF);
    const patch = buildSingleHunkPatch(parsed, parsed.hunks[1]);
    expect(patch).toContain('+ten-and-a-half');
    expect(patch).not.toContain('+ONE');
    expect(patch.endsWith(' eleven\n')).toBe(true);
  });

  it('refuses a stale fingerprint', () => {
    const parsed = parseFileDiff(DIFF);
    expect(() => selectHunk(parsed, 0, parsed.hunks[1].fingerprint)).toThrow(/edited since/);
    expect(selectHunk(parsed, 0, parsed.hunks[0].fingerprint)).toBe(parsed.hunks[0]);
  });

  it('flags binary diffs', () => {
    const parsed = parseFileDiff(
      'diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n',
    );
    expect(parsed.binary).toBe(true);
    expect(parsed.hunks).toHaveLength(0);
  });
});
