import { promises as fs } from 'fs';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { initEpubFile } from '@lingo-reader/epub-parser';
import type { 
  EpubFile, 
  EpubMetadata, 
  EpubSpine, 
  EpubToc, 
  EpubProcessedChapter,
  ManifestItem 
} from '@lingo-reader/epub-parser';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkStringify from 'remark-stringify';
import { ResourceHandler } from './resource-handler.js';

export interface ConversionOptions {
  outputDir: string;
  createToc?: boolean;
  extractResources?: boolean;
  chapterNamePattern?: string;
}

export interface ConversionResult {
  outputDir: string;
  chapterCount: number;
  resourceCount: number;
  metadata: EpubMetadata;
}

export class EpubConverter {
  private epub: EpubFile | null = null;
  private resourceHandler: ResourceHandler;
  private options: Required<ConversionOptions>;
  private resourceMapping: Map<string, string> = new Map(); // Original path -> normalized name

  constructor(options: ConversionOptions) {
    this.options = {
      createToc: true,
      extractResources: true,
      chapterNamePattern: '{index:02d}-{title}',
      ...options
    };
    this.resourceHandler = new ResourceHandler(this.options.outputDir);
  }

  async convert(epubPath: string): Promise<ConversionResult> {
    console.log('Initializing EPUB parser...');
    // Specify resource directory for epub-parser to extract images, CSS, etc.
    const resourceDir = path.join(this.options.outputDir, 'resources');
    this.epub = await initEpubFile(epubPath, resourceDir);

    const metadata = this.epub.getMetadata();
    const spine = this.epub.getSpine();
    const manifest = this.epub.getManifest();

    console.log(`Processing "${metadata.title}" with ${spine.length} chapters...`);

    // Create output directory structure
    await this.initializeOutputStructure();

    // Process resources if enabled
    let resourceCount = 0;
    if (this.options.extractResources) {
      console.log('Extracting resources...');
      resourceCount = await this.extractResources(manifest);
    }

    // Convert chapters
    console.log('Converting chapters to markdown...');
    await this.convertChapters(spine);

    // Create table of contents
    if (this.options.createToc) {
      console.log('Creating table of contents...');
      await this.createTableOfContents();
    }

    // Save metadata
    await this.saveMetadata(metadata);

    console.log('Conversion completed successfully!');

    return {
      outputDir: this.options.outputDir,
      chapterCount: spine.length,
      resourceCount,
      metadata
    };
  }

  private async initializeOutputStructure(): Promise<void> {
    await fsExtra.ensureDir(this.options.outputDir);
    await fsExtra.ensureDir(path.join(this.options.outputDir, 'chapters'));
    await fsExtra.ensureDir(path.join(this.options.outputDir, 'html'));
    await fsExtra.ensureDir(path.join(this.options.outputDir, 'debug'));
    await fsExtra.ensureDir(path.join(this.options.outputDir, 'resources'));
    
    if (this.options.extractResources) {
      await this.resourceHandler.initialize();
    }
  }

  private async extractResources(manifest: Record<string, ManifestItem>): Promise<number> {
    if (!this.epub) throw new Error('EPUB not initialized');

    console.log('=== RESOURCE EXTRACTION & NORMALIZATION ===');
    
    let count = 0;
    const resourceTypes = ['image/', 'text/css', 'font/', 'application/font'];
    const foundResources: Array<{id: string, href: string, mediaType: string}> = [];

    // First pass: collect all resources
    for (const [id, manifestItem] of Object.entries(manifest)) {
      const isResource = resourceTypes.some(type => 
        manifestItem.mediaType.startsWith(type)
      );

      if (isResource) {
        foundResources.push({
          id,
          href: manifestItem.href,
          mediaType: manifestItem.mediaType
        });
        count++;
      }
    }

    console.log(`Found ${count} resources to process`);

    // Create normalized mappings for each resource type
    await this.createResourceMappings(foundResources);

    // Wait for epub-parser to extract files, then normalize them
    await this.normalizeExtractedResources();

    return count;
  }

  private async createResourceMappings(resources: Array<{id: string, href: string, mediaType: string}>): Promise<void> {
    let imageCounter = 1;
    let cssCounter = 1;
    let fontCounter = 1;

    for (const resource of resources) {
      const originalPath = resource.href;
      const extension = path.extname(originalPath);
      let normalizedName: string;

      if (resource.mediaType.startsWith('image/')) {
        normalizedName = `image-${imageCounter}${extension}`;
        imageCounter++;
      } else if (resource.mediaType.startsWith('text/css')) {
        normalizedName = `style-${cssCounter}${extension}`;
        cssCounter++;
      } else if (resource.mediaType.startsWith('font/') || resource.mediaType.startsWith('application/font')) {
        normalizedName = `font-${fontCounter}${extension}`;
        fontCounter++;
      } else {
        // Fallback
        normalizedName = path.basename(originalPath);
      }

      this.resourceMapping.set(originalPath, normalizedName);
      console.log(`Mapped: ${originalPath} -> ${normalizedName}`);
    }
  }

  private async normalizeExtractedResources(): Promise<void> {
    const resourceDir = path.join(this.options.outputDir, 'resources');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for extraction to complete
      
      // First, flatten the directory structure by moving files from subfolders
      await this.flattenResourceDirectory(resourceDir);
      
      const files = await fs.readdir(resourceDir);
      console.log(`Normalizing ${files.length} extracted files...`);

      // Keep track of CSS files that need to remain accessible with original names
      const cssFiles: string[] = [];

      for (const file of files) {
        // Skip directories
        const filePath = path.join(resourceDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) continue;

        // Find the original mapping for this file
        const originalHref = this.findOriginalHrefForFile(file);
        if (originalHref) {
          const normalizedName = this.resourceMapping.get(originalHref);
          if (normalizedName && normalizedName !== file) {
            const oldPath = path.join(resourceDir, file);
            const newPath = path.join(resourceDir, normalizedName);
            
            try {
              // For CSS files, create a copy with the normalized name but keep the original
              if (file.endsWith('.css')) {
                await fs.copyFile(oldPath, newPath);
                cssFiles.push(file);
                console.log(`Copied CSS: ${file} -> ${normalizedName} (keeping original)`);
              } else {
                await fs.rename(oldPath, newPath);
                console.log(`Renamed: ${file} -> ${normalizedName}`);
              }
            } catch (error) {
              console.warn(`Failed to rename ${file}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.log('Resource normalization skipped:', error);
    }
  }

  private async flattenResourceDirectory(resourceDir: string): Promise<void> {
    try {
      const items = await fs.readdir(resourceDir);
      
      for (const item of items) {
        const itemPath = path.join(resourceDir, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          console.log(`Flattening subdirectory: ${item}`);
          const subItems = await fs.readdir(itemPath);
          
          // Move all files from subdirectory to main resources folder
          for (const subItem of subItems) {
            const srcPath = path.join(itemPath, subItem);
            const destPath = path.join(resourceDir, subItem);
            
            try {
              await fs.rename(srcPath, destPath);
              console.log(`Moved: ${item}/${subItem} -> ${subItem}`);
            } catch (error) {
              // If file already exists in root, skip it
              if ((error as any).code !== 'EEXIST') {
                console.warn(`Failed to move ${subItem}:`, error);
              }
            }
          }
          
          // Remove empty subdirectory
          try {
            await fs.rmdir(itemPath);
            console.log(`Removed empty directory: ${item}`);
          } catch (error) {
            console.warn(`Failed to remove directory ${item}:`, error);
          }
        }
      }
    } catch (error) {
      console.log('Directory flattening skipped:', error);
    }
  }

  private findOriginalHrefForFile(filename: string): string | undefined {
    // The epub-parser converts OEBPS/image123.jpg to OEBPS_image123.jpg
    // We need to reverse this to find the original href
    for (const [originalHref] of this.resourceMapping) {
      const expectedFilename = originalHref.replace(/\//g, '_');
      if (expectedFilename === filename) {
        return originalHref;
      }
    }
    return undefined;
  }

  private async convertChapters(spine: EpubSpine): Promise<void> {
    if (!this.epub) throw new Error('EPUB not initialized');

    const processor = unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeRemark)
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '_',
        strong: '*',
        listItemIndent: 'one'
      });

    for (let i = 0; i < spine.length; i++) {
      const spineItem = spine[i];
      console.log(`Processing chapter ${i + 1}/${spine.length}: ${spineItem.id}`);

      try {
        const chapter: EpubProcessedChapter = await this.epub.loadChapter(spineItem.id);
        
        if (!chapter || !chapter.html) {
          console.warn(`Chapter ${spineItem.id} has no content, skipping...`);
          continue;
        }

        // Check if this is an image-only chapter and skip it
        if (this.isImageOnlyChapter(chapter.html)) {
          console.log(`Skipping image-only chapter: ${spineItem.id}`);
          continue;
        }

        // Save original HTML for debugging
        const baseFilename = this.generateChapterFilename(i + 1, spineItem, spine).replace('.md', '');
        const htmlPath = path.join(this.options.outputDir, 'html', `${baseFilename}.html`);
        await fs.writeFile(htmlPath, chapter.html, 'utf-8');

        // Extract meaningful title from HTML content
        const extractedTitle = this.extractChapterTitle(chapter.html, spineItem, i + 1);

        // Convert HTML to Markdown
        const result = await processor.process(chapter.html);
        let markdown = String(result);

        // Update resource links to use normalized names
        markdown = this.normalizeMarkdownImagePaths(markdown);

        // Create debug info before cleaning up links
        const debugInfo = {
          chapterIndex: i + 1,
          spineItemId: spineItem.id,
          extractedTitle: extractedTitle,
          pageIds: this.extractPageIds(chapter.html),
          navigationLinks: this.extractNavigationLinks(chapter.html),
          duplicateLinksToRemove: this.identifyDuplicateLinks(markdown, extractedTitle),
          markdownBeforeCleanup: markdown.substring(0, 500) + '...',
          markdownAfterCleanup: '' // Will be filled after cleanup
        };

        // Clean up duplicate navigation links
        markdown = this.removeDuplicateNavigationLinks(markdown, extractedTitle);

        // Add to debug info
        debugInfo.markdownAfterCleanup = markdown.substring(0, 500) + '...';

        // Save debug info
        const debugPath = path.join(this.options.outputDir, 'debug', `${baseFilename}.json`);
        await fs.writeFile(debugPath, JSON.stringify(debugInfo, null, 2), 'utf-8');

        // Generate chapter filename
        const filename = `${baseFilename}.md`;
        const filepath = path.join(this.options.outputDir, 'chapters', filename);

        // Add chapter header
        let chapterContent = this.formatChapterContent(spineItem, markdown, i + 1, extractedTitle);
        
        // Remove images that appear right after chapter header (now that header exists)
        chapterContent = this.removeHeaderImages(chapterContent);

        await fs.writeFile(filepath, chapterContent, 'utf-8');
        console.log(`✓ Chapter saved: ${filename}`);

      } catch (error) {
        console.error(`Failed to process chapter ${spineItem.id}:`, error);
      }
    }
  }

  private generateChapterFilename(index: number, spineItem: any, spine: EpubSpine): string {
    // Extract title from spine item or use generic name
    let title = spineItem.id || `chapter-${index}`;
    
    // Clean title for filename
    title = title
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    return this.options.chapterNamePattern
      .replace('{index:02d}', index.toString().padStart(2, '0'))
      .replace('{index}', index.toString())
      .replace('{title}', title) + '.md';
  }

  private extractChapterTitle(html: string, spineItem: any, index: number): string {
    // First, look for text content in navigation links that might be split across multiple divs
    // This handles cases like:
    // <div><a href="...">SINGLE ADULTS:</a></div>
    // <div><a href="...">Significant and Growing</a></div>
    const navLinkPattern = /<a[^>]*>([^<]+)<\/a>\s*<\/div>\s*<div[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i;
    const navMatch = html.match(navLinkPattern);
    if (navMatch) {
      const combinedTitle = `${navMatch[1].trim()} ${navMatch[2].trim()}`;
      if (!combinedTitle.includes('id_')) {
        // Clean and combine the titles, removing trailing colons from first part
        const cleanTitle = combinedTitle.replace(/[^\w\s-:]/g, '').replace(/:\s*/, ' ').trim();
        return cleanTitle;
      }
    }
    
    // Try to extract title from HTML headings and other elements
    const titleMatches = [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<h2[^>]*>([^<]+)<\/h2>/i,
      /<h3[^>]*>([^<]+)<\/h3>/i,
      /<title[^>]*>([^<]+)<\/title>/i,
      // Single navigation link that might contain the title
      /<a[^>]*>([^<]+)<\/a>/i
    ];
    
    for (const regex of titleMatches) {
      const match = html.match(regex);
      if (match && match[1].trim() && !match[1].includes('id_')) {
        const title = match[1].trim().replace(/[^\w\s-:]/g, '').trim();
        // Skip generic titles
        if (title && title.toLowerCase() !== 'contents') {
          return title;
        }
      }
    }
    
    // Check if this is an empty chapter (only contains images)
    const textContent = html.replace(/<[^>]+>/g, '').trim();
    if (!textContent || textContent.length < 10) {
      return `Chapter ${index} (Image Only)`;
    }
    
    // Fallback to spine item processing
    if (spineItem.id && !spineItem.id.startsWith('id_')) {
      return spineItem.id.replace(/[_-]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
    
    return `Chapter ${index}`;
  }

  private extractPageIds(html: string): string[] {
    const pageIds: string[] = [];
    const pagePattern = /<[^>]+id="(page_\d+)"[^>]*>/g;
    let match;
    while ((match = pagePattern.exec(html)) !== null) {
      pageIds.push(match[1]);
    }
    return pageIds;
  }

  private extractNavigationLinks(html: string): Array<{text: string, href: string}> {
    const links: Array<{text: string, href: string}> = [];
    const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      links.push({ href: match[1], text: match[2] });
    }
    return links;
  }

  private identifyDuplicateLinks(markdown: string, chapterTitle: string): string[] {
    const duplicates: string[] = [];
    
    // Check for exact title match
    const exactMatch = new RegExp(`\\[${chapterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(epub:[^\\)]+\\)`, 'gi');
    if (exactMatch.test(markdown)) {
      duplicates.push(`Exact match: [${chapterTitle}](epub:...)`);
    }
    
    // Check for split title parts
    const titleWords = chapterTitle.split(/\s+/);
    if (titleWords.length >= 4) {
      // Check various split patterns
      for (let splitAt = 2; splitAt <= 3; splitAt++) {
        const firstPart = titleWords.slice(0, splitAt).join(' ');
        const secondPart = titleWords.slice(splitAt).join(' ');
        
        const splitPattern = new RegExp(
          `\\[${firstPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\]\\(epub:[^\\)]+\\)\\s*\\n*\\s*\\[${secondPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(epub:[^\\)]+\\)`,
          'i'
        );
        
        if (splitPattern.test(markdown)) {
          duplicates.push(`Split pattern: [${firstPart}:] + [${secondPart}]`);
        }
      }
    }
    
    return duplicates;
  }

  private isImageOnlyChapter(html: string): boolean {
    // Remove all HTML tags to get text content
    const textContent = html.replace(/<[^>]+>/g, '').trim();
    
    // Check if there's minimal text content (less than 50 characters of meaningful text)
    const meaningfulText = textContent.replace(/\s+/g, ' ').trim();
    
    // If the chapter has very little text and contains images, it's likely image-only
    const hasImages = /<img[^>]+>/i.test(html);
    const isMinimalText = meaningfulText.length < 50;
    
    return hasImages && isMinimalText;
  }

  private normalizeMarkdownImagePaths(markdown: string): string {
    // Replace image paths in markdown with normalized names
    let normalizedMarkdown = markdown;
    
    for (const [originalHref, normalizedName] of this.resourceMapping) {
      // Handle both regular images ![...](path) and linked images [![...](path)](...)
      const originalImagePath = path.join(this.options.outputDir, 'resources', originalHref.replace(/\//g, '_'));
      const normalizedImagePath = path.join(this.options.outputDir, 'resources', normalizedName);
      
      // Replace all occurrences of the original path with normalized path
      normalizedMarkdown = normalizedMarkdown.replace(
        new RegExp(originalImagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        normalizedImagePath
      );
    }
    
    return normalizedMarkdown;
  }

  private removeHeaderImages(markdown: string): string {
    // Remove images and separators that appear right after the chapter header
    // Rule: if an image goes after header remove it. if --- goes after header remove it too
    
    let result = markdown;
    
    // Remove any separators and images that appear after headers
    // Match: # Title\n followed by any combination of:
    // - empty lines
    // - --- separators with empty lines
    // - regular images ![...](...) with empty lines
    // - linked images [![...](...)](...) with empty lines
    result = result.replace(
      /(^# [^\n]+\n)(?:\n|---\n|\[\!\[[^\]]*\]\([^)]+\)\]\([^)]+\)\n|\!\[[^\]]*\]\([^)]+\)\n)*/m,
      '$1\n'
    );
    
    return result;
  }

  private removeDuplicateNavigationLinks(markdown: string, chapterTitle: string): string {
    let cleanedMarkdown = markdown;
    
    // Strategy 1: Direct pattern matching for known cases
    // For "LOVE LANGUAGE 1 Words of Affirmation", the links might be:
    // [LOVE LANGUAGE #1] and [Words of Affirmation]
    
    // Normalize the title for comparison (replace numbers with #numbers)
    const normalizedTitle = chapterTitle.replace(/\b(\d+)\b/g, '#$1');
    
    // Find all navigation links in the markdown
    const linkPattern = /\[([^\]]+)\]\(epub:[^\)]+\)/g;
    const links: string[] = [];
    let match;
    while ((match = linkPattern.exec(markdown)) !== null) {
      links.push(match[1]);
    }
    
    // Check if consecutive links together form the title
    for (let i = 0; i < links.length - 1; i++) {
      const combinedText = links[i] + ' ' + links[i + 1];
      const combinedTextNoColon = links[i].replace(/:$/, '') + ' ' + links[i + 1];
      
      // Check various combinations
      if (combinedText === chapterTitle || 
          combinedTextNoColon === chapterTitle ||
          combinedText === normalizedTitle ||
          combinedTextNoColon === normalizedTitle) {
        
        // Remove these two consecutive links
        const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(
          `\\[${escapeRegex(links[i])}\\]\\(epub:[^\\)]+\\)\\s*\\n*\\s*\\[${escapeRegex(links[i + 1])}\\]\\(epub:[^\\)]+\\)`,
          'g'
        );
        cleanedMarkdown = cleanedMarkdown.replace(pattern, '');
      }
    }
    
    // Strategy 2: Handle split titles with variations
    const titleWords = chapterTitle.split(/\s+/);
    
    // Try different split points
    for (let splitAt = 2; splitAt <= Math.min(4, titleWords.length - 1); splitAt++) {
      const firstPart = titleWords.slice(0, splitAt).join(' ');
      const secondPart = titleWords.slice(splitAt).join(' ');
      
      // Create variations of first part (with #, with :, etc.)
      const firstPartVariations = [
        firstPart,
        firstPart + ':',
        firstPart.replace(/\b(\d+)\b/g, '#$1'),
        firstPart.replace(/\b(\d+)\b/g, '#$1') + ':'
      ];
      
      // Try each variation
      for (const firstVar of firstPartVariations) {
        const pattern = new RegExp(
          `\\[${firstVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(epub:[^\\)]+\\)\\s*\\n*\\s*\\[${secondPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(epub:[^\\)]+\\)`,
          'gi'
        );
        
        if (pattern.test(cleanedMarkdown)) {
          cleanedMarkdown = cleanedMarkdown.replace(pattern, '');
          break;
        }
      }
    }
    
    // Strategy 3: Remove exact matches of the full title
    const fullTitlePattern = new RegExp(`\\[${chapterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\(epub:[^\\)]+\\)`, 'gi');
    cleanedMarkdown = cleanedMarkdown.replace(fullTitlePattern, '');
    
    // Clean up excessive newlines
    return cleanedMarkdown.replace(/\n\s*\n\s*\n/g, '\n\n');
  }

  private formatChapterContent(spineItem: any, markdown: string, index: number, extractedTitle: string): string {
    return [
      `# ${extractedTitle}`,
      '',
      markdown,
      ''
    ].join('\n');
  }

  private async createTableOfContents(): Promise<void> {
    if (!this.epub) throw new Error('EPUB not initialized');

    const toc = this.epub.getToc();
    const spine = this.epub.getSpine();
    
    let tocContent = '# Table of Contents\n\n';
    
    // Add chapters from spine
    spine.forEach((spineItem, index) => {
      const filename = this.generateChapterFilename(index + 1, spineItem, spine);
      const title = spineItem.id || `Chapter ${index + 1}`;
      tocContent += `${index + 1}. [${title}](chapters/${filename})\n`;
    });

    // Add original TOC structure if available
    if (toc && toc.length > 0) {
      tocContent += '\n## Original Table of Contents\n\n';
      tocContent += this.formatTocItems(toc, 0);
    }

    const tocPath = path.join(this.options.outputDir, 'toc.md');
    await fs.writeFile(tocPath, tocContent, 'utf-8');
  }

  private formatTocItems(tocItems: EpubToc, level: number): string {
    let content = '';
    const indent = '  '.repeat(level);
    
    tocItems.forEach(item => {
      content += `${indent}- [${item.label}](#)\n`;
      if (item.children && item.children.length > 0) {
        content += this.formatTocItems(item.children, level + 1);
      }
    });
    
    return content;
  }

  private async saveMetadata(metadata: EpubMetadata): Promise<void> {
    const metadataPath = path.join(this.options.outputDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  async cleanup(): Promise<void> {
    // Note: We don't call this.epub.destroy() here because it would delete
    // the extracted resources. The resources are needed for the final output.
    // The epub object will be garbage collected naturally.
    if (this.epub) {
      this.epub = null;
    }
  }
}