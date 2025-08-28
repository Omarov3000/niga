import { describe, it, expect } from 'vitest';
import { extractChapters } from './extract-chapters';

describe('extractChapters', () => {
  it('should extract a simple chapter with paragraphs', () => {
    const markdown = `# Chapter 1

This is the first paragraph.

This is the second paragraph.`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(1);
    expect(result[0].chapter).toBe('Chapter 1');
    expect(result[0].content).toEqual([
      'This is the first paragraph.',
      'This is the second paragraph.'
    ]);
  });

  it('should join consecutive headers into a single chapter', () => {
    const markdown = `# Part 1
## Chapter 1

This is the content.`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(1);
    expect(result[0].chapter).toBe('Part 1 Chapter 1');
    expect(result[0].content).toEqual(['This is the content.']);
  });

  it('should handle multiple chapters', () => {
    const markdown = `# Chapter 1

First chapter content.

# Chapter 2

Second chapter content.

# Chapter 3

Third chapter content.`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(3);
    expect(result[0].chapter).toBe('Chapter 1');
    expect(result[0].content).toEqual(['First chapter content.']);
    expect(result[1].chapter).toBe('Chapter 2');
    expect(result[1].content).toEqual(['Second chapter content.']);
    expect(result[2].chapter).toBe('Chapter 3');
    expect(result[2].content).toEqual(['Third chapter content.']);
  });

  it('should correctly number images globally across chapters', () => {
    const markdown = `# Chapter 1

![First image](image1.png)

Some text.

![Second image](image2.png)

# Chapter 2

![Third image](image3.png)

More text.

![Fourth image](image4.png)`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(2);
    expect(result[0].content).toEqual([
      'image-1',
      'Some text.',
      'image-2'
    ]);
    expect(result[1].content).toEqual([
      'image-3',
      'More text.',
      'image-4'
    ]);
  });

  it('should handle tables with correct numbering', () => {
    const markdown = `# Chapter 1

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

Some text.

| Another | Table |
|---------|-------|
| Data    | Here  |`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([
      'table-1',
      'Some text.',
      'table-2'
    ]);
  });

  it('should handle lists correctly', () => {
    const markdown = `# Chapter 1

- First item
- Second item
- Third item

1. Numbered first
2. Numbered second`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([
      '1. First item\n2. Second item\n3. Third item',
      '1. Numbered first\n2. Numbered second'
    ]);
  });

  it('should extract text from formatted content', () => {
    const markdown = `# Chapter 1

This has **bold text** and _italic text_.

This has [a link](https://example.com) and \`inline code\`.`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([
      'This has bold text and italic text.',
      'This has a link and inline code.'
    ]);
  });

  it('should handle code blocks', () => {
    const markdown = `# Chapter 1

Here is some code:

\`\`\`javascript
console.log('Hello');
\`\`\`

More text.`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual([
      'Here is some code:',
      "console.log('Hello');",
      'More text.'
    ]);
  });

  it('should handle empty chapters by joining with next chapter', () => {
    const markdown = `# Empty Chapter

# Chapter with Content

Some content here.`;

    const result = extractChapters(markdown);
    
    // Empty chapters are joined with the next chapter
    expect(result).toHaveLength(1);
    expect(result[0].chapter).toBe('Empty Chapter Chapter with Content');
    expect(result[0].content).toEqual(['Some content here.']);
  });

  it('should handle truly empty chapters at the end', () => {
    const markdown = `# Chapter with Content

Some content here.

# Empty Chapter at End`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(2);
    expect(result[0].chapter).toBe('Chapter with Content');
    expect(result[0].content).toEqual(['Some content here.']);
    expect(result[1].chapter).toBe('Empty Chapter at End');
    expect(result[1].content).toEqual([]);
  });

  it('should handle nested headers correctly', () => {
    const markdown = `# Main Chapter

Content under main.

## Subsection

Content under subsection.

### Sub-subsection

Content under sub-subsection.`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(3);
    expect(result[0].chapter).toBe('Main Chapter');
    expect(result[0].content).toEqual(['Content under main.']);
    expect(result[1].chapter).toBe('Subsection');
    expect(result[1].content).toEqual(['Content under subsection.']);
    expect(result[2].chapter).toBe('Sub-subsection');
    expect(result[2].content).toEqual(['Content under sub-subsection.']);
  });

  it('should handle mixed image and table content', () => {
    const markdown = `# Chapter 1

![Image 1](img1.png)

| Table 1 |
|---------|
| Data    |

![Image 2](img2.png)

| Table 2 |
|---------|
| More    |

# Chapter 2

| Table 3 |
|---------|
| Content |

![Image 3](img3.png)`;

    const result = extractChapters(markdown);
    
    expect(result).toHaveLength(2);
    expect(result[0].content).toEqual([
      'image-1',
      'table-1',
      'image-2',
      'table-2'
    ]);
    expect(result[1].content).toEqual([
      'table-3',
      'image-3'
    ]);
  });

  it('should handle empty markdown', () => {
    const result = extractChapters('');
    expect(result).toEqual([]);
  });

  it('should handle markdown with no headers', () => {
    const markdown = `Just some text without headers.

Another paragraph.`;

    const result = extractChapters(markdown);
    expect(result).toEqual([]);
  });
});