import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm).freeze();
const GLOBAL_DEFINITION = /^[ \t]*\[[^\]\n]+\]:/m;
export interface MarkdownStreamBlock {
  key: number;
  content: string;
  settled: boolean;
}

/**
 * Keep complete top-level blocks; reparse only the open tail. The final two AST
 * nodes stay mutable (a partially typed list marker can merge with the preceding list;
 * tables, Setext headings and fences can grow).
 * Reference/footnote definitions are document-wide, so use the full parser
 * for those messages instead of changing their meaning across block cuts.
 */
export function createStreamingMarkdown() {
  let previous = '';
  let end = 0;
  let stable: MarkdownStreamBlock[] = [];
  let result: MarkdownStreamBlock[] = [];
  return (content: string): MarkdownStreamBlock[] => {
    if (content === previous) return result;
    if (!content.startsWith(previous) || GLOBAL_DEFINITION.test(content)) {
      end = 0;
      stable = [];
    }
    previous = content;
    if (GLOBAL_DEFINITION.test(content)) {
      result = [{ key: 0, content, settled: false }];
      return result;
    }
    const tail = content.slice(end);
    const nodes = parser.parse(tail).children;
    const appended: MarkdownStreamBlock[] = [];
    for (let index = 0; index + 2 < nodes.length; index += 1) {
      const start = index === 0 ? 0 : nodes[index].position!.start.offset!;
      const next = nodes[index + 1].position!.start.offset!;
      appended.push({ key: end + start, content: tail.slice(start, next), settled: true });
    }
    stable = [...stable, ...appended];
    const mutableStart = nodes.length > 2 ? nodes[nodes.length - 2].position!.start.offset! : 0;
    end += mutableStart;
    result = [...stable, { key: end, content: content.slice(end), settled: false }];
    return result;
  };
}
