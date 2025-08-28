import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Heading, Paragraph, Text, Node, List, ListItem, Image, Table } from 'mdast';

/**
 * Extracts chapters from markdown.
 *
 * This function uses the remark and unified pipeline to parse markdown and identify
 * headers as chapters. When multiple headers appear consecutively without any content
 * between them, they are joined into a single chapter.
 *
**/
export function extractChapters(markdown: string): { chapter: string, content: string[] }[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  const chapters: { chapter: string, content: string[] }[] = [];
  let currentChapter: { chapter: string, content: string[] } | null = null;
  let consecutiveHeaders: string[] = [];
  let lastNodeWasHeading = false;

  // Use a shared counter object to maintain state across recursive calls
  const counters = { imageCounter: 1, tableCounter: 1 };

  // First pass: process all direct children of root
  const rootNode = tree as Root;
  rootNode.children.forEach((node: Node) => {
    if (node.type === 'heading') {
      const heading = node as Heading;
      const headerText = extractTextFromNode(heading, counters);

      // Check if this is a consecutive header (no content between headers)
      if (lastNodeWasHeading) {
        // Join consecutive headers
        consecutiveHeaders.push(headerText);
        if (currentChapter) {
          currentChapter.chapter = consecutiveHeaders.join(' ');
        }
      } else {
        // Start a new chapter
        if (currentChapter) {
          chapters.push(currentChapter);
        }
        currentChapter = {
          chapter: headerText,
          content: []
        };
        consecutiveHeaders = [headerText];
      }
      lastNodeWasHeading = true;
    } else if (node.type === 'paragraph' || node.type === 'list' || node.type === 'table' || node.type === 'code') {
      // Reset consecutive headers when we encounter content
      lastNodeWasHeading = false;
      consecutiveHeaders = [];

      if (currentChapter) {
        if (node.type === 'paragraph') {
          const para = node as Paragraph;
          // Check if paragraph contains only an image
          if (para.children.length === 1 && para.children[0].type === 'image') {
            currentChapter.content.push(`image-${counters.imageCounter}`);
            counters.imageCounter++;
          } else {
            const content = extractTextFromNode(node, counters);
            if (content.trim()) {
              currentChapter.content.push(content);
            }
          }
        } else if (node.type === 'table') {
          currentChapter.content.push(`table-${counters.tableCounter}`);
          counters.tableCounter++;
        } else if (node.type === 'code') {
          const codeBlock = node as any;
          if (codeBlock.value) {
            currentChapter.content.push(codeBlock.value);
          }
        } else {
          const content = extractTextFromNode(node, counters);
          if (content.trim()) {
            currentChapter.content.push(content);
          }
        }
      }
    }
  });

  // Add the last chapter if it exists
  if (currentChapter) {
    chapters.push(currentChapter);
  }

  return chapters;
}

// Helper function to extract text from various node types
function extractTextFromNode(node: Node, counters?: { imageCounter: number, tableCounter: number }): string {
  if (node.type === 'text') {
    return (node as Text).value;
  } else if (node.type === 'paragraph') {
    const paragraph = node as Paragraph;
    return paragraph.children?.map((child: Node) => extractTextFromNode(child, counters)).join('') || '';
  } else if (node.type === 'heading') {
    const heading = node as Heading;
    return heading.children?.map((child: Node) => extractTextFromNode(child, counters)).join('') || '';
  } else if (node.type === 'list') {
    const list = node as List;
    const isOrdered = list.ordered;
    return list.children?.map((item: Node, index: number) => {
      const listItem = item as ListItem;
      const itemText = listItem.children?.map((child: Node) => extractTextFromNode(child, counters)).join('') || '';
      const marker = isOrdered ? `${index + 1}.` : `${index + 1}.`;
      return `${marker} ${itemText}`;
    }).join('\n') || '';
  } else if (node.type === 'listItem') {
    const listItem = node as ListItem;
    return listItem.children?.map((child: Node) => extractTextFromNode(child, counters)).join('') || '';
  } else if (node.type === 'image') {
    // Return empty string for images embedded in paragraphs - they're handled at the paragraph level
    return '';
  } else if (node.type === 'table') {
    // Tables should be handled at the root level, not here
    return '';
  } else if (node.type === 'strong' || node.type === 'emphasis') {
    const parent = node as any;
    return parent.children?.map((child: Node) => extractTextFromNode(child, counters)).join('') || '';
  } else if (node.type === 'link') {
    const link = node as any;
    return link.children?.map((child: Node) => extractTextFromNode(child, counters)).join('') || '';
  } else if (node.type === 'code') {
    const code = node as any;
    return code.value || '';
  } else if (node.type === 'inlineCode') {
    const inlineCode = node as any;
    return inlineCode.value || '';
  }
  return '';
}
