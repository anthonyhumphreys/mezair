import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { createStreamingMarkdown } from '../streaming-markdown';
const parser = unified().use(remarkParse).use(remarkGfm);
const clean = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, entry) => (key === 'position' ? undefined : entry)));
const cases = [
  '# Title\n\nParagraph **bold**\n\n- a\n- b\n\nTail',
  'Heading\n---\n\n> quote\n> continued\n\nTail',
  'before\n\n```ts\nconst a = 1;\n\ncode\n```\n\nTail',
  'before\n\n```ts\nunfinished\n\ncode',
  'a | b\n--|--\n1 | 2\n3 | 4\n\nTail',
  '1. a\n\n   continued\n\n   - nested\n\n2. b\n\nTail',
  'see [later][ref]\n\nOther paragraph\n\n[ref]: https://example.com\n\nTail',
  'note[^a]\n\nOther paragraph\n\n[^a]: a footnote\n\nTail',
  '<div>\nraw\n\nhtml\n</div>\n\nTail',
];
describe('streaming markdown', () => {
  for (const content of cases)
    it(`preserves parser semantics at every character: ${content.slice(0, 20)}`, () => {
      const split = createStreamingMarkdown();
      for (let end = 1; end <= content.length; end++) {
        const prefix = content.slice(0, end);
        const blocks = split(prefix);
        expect(blocks.map((block) => block.content).join('')).toBe(prefix);
        expect(clean(blocks.flatMap((block) => parser.parse(block.content).children))).toEqual(
          clean(parser.parse(prefix).children),
        );
      }
    });
  it('retains completed block identities and resets on replacement', () => {
    const split = createStreamingMarkdown();
    const first = split('Done\n\nMiddle\n\nTail');
    expect(split('Done\n\nMiddle\n\nTail grows')[0]).toBe(first[0]);
    expect(
      split('Replacement')
        .map((b) => b.content)
        .join(''),
    ).toBe('Replacement');
  });
});
