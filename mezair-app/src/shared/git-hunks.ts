/**
 * Pure helpers for splitting a single-file unified diff into hunks and
 * rebuilding a one-hunk patch that `git apply` accepts. Shared by the main
 * process (which applies hunks) and the renderer (which labels them), so both
 * sides agree on hunk identity.
 */

export type GitHunkAction = 'stage' | 'unstage' | 'discard';

export interface GitDiffHunk {
  /** Zero-based position in the file's diff. */
  index: number;
  /** The `@@ -a,b +c,d @@ context` line. */
  header: string;
  /** Header plus body lines, newline-terminated. */
  text: string;
  /** Stable fingerprint of `text`; used to refuse stale hunk actions. */
  fingerprint: string;
  oldStart: number;
  newStart: number;
  additions: number;
  deletions: number;
}

export interface ParsedFileDiff {
  /** Everything before the first hunk (`diff --git`, `index`, `---`, `+++`). */
  fileHeader: string;
  hunks: GitDiffHunk[];
  /** Binary or mode-only diffs have no hunks and cannot be applied per hunk. */
  binary: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** FNV-1a over UTF-16 code units, hex. Deterministic in Node and the browser. */
export function fingerprintHunk(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`;
}

/** Splits a single-file unified diff (as `git diff -- <file>` prints it). */
export function parseFileDiff(diff: string): ParsedFileDiff {
  const lines = diff.split('\n');
  // A trailing newline produces one empty final element; drop it so the
  // rebuilt patch does not gain a blank context line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const headerLines: string[] = [];
  const hunks: GitDiffHunk[] = [];
  let current: { header: string; lines: string[]; oldStart: number; newStart: number } | null =
    null;
  let binary = false;

  const flush = () => {
    if (!current) return;
    const text = `${[current.header, ...current.lines].join('\n')}\n`;
    let additions = 0;
    let deletions = 0;
    for (const line of current.lines) {
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
    hunks.push({
      index: hunks.length,
      header: current.header,
      text,
      fingerprint: fingerprintHunk(text),
      oldStart: current.oldStart,
      newStart: current.newStart,
      additions,
      deletions,
    });
    current = null;
  };

  for (const line of lines) {
    const match = HUNK_HEADER.exec(line);
    if (match) {
      flush();
      current = {
        header: line,
        lines: [],
        oldStart: Number(match[1]),
        newStart: Number(match[3]),
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true;
      headerLines.push(line);
    }
  }
  flush();

  return {
    fileHeader: headerLines.length > 0 ? `${headerLines.join('\n')}\n` : '',
    hunks,
    binary,
  };
}

/** Rebuilds a patch containing only `hunk`, ready for `git apply`. */
export function buildSingleHunkPatch(parsed: ParsedFileDiff, hunk: GitDiffHunk): string {
  if (!parsed.fileHeader) throw new Error('The diff has no file header.');
  return `${parsed.fileHeader}${hunk.text}`;
}

/** Finds the hunk the renderer asked for and verifies it has not changed since. */
export function selectHunk(
  parsed: ParsedFileDiff,
  index: number,
  fingerprint: string,
): GitDiffHunk {
  const hunk = parsed.hunks[index];
  if (!hunk || hunk.fingerprint !== fingerprint) {
    throw new Error('This change was edited since it was shown. Refresh the diff and try again.');
  }
  return hunk;
}
