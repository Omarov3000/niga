import { promises as fs } from 'fs';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import type { ManifestItem } from '@lingo-reader/epub-parser';

export interface ResourceInfo {
  originalPath: string;
  newPath: string;
  relativePath: string;
  type: 'image' | 'css' | 'font' | 'other';
}

export class ResourceHandler {
  private outputDir: string;
  private resourcesDir: string;
  private resourceMap: Map<string, ResourceInfo> = new Map();

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.resourcesDir = path.join(outputDir, 'resources');
  }

  async initialize(): Promise<void> {
    await fsExtra.ensureDir(this.resourcesDir);
    await fsExtra.ensureDir(path.join(this.resourcesDir, 'images'));
    await fsExtra.ensureDir(path.join(this.resourcesDir, 'styles'));
    await fsExtra.ensureDir(path.join(this.resourcesDir, 'fonts'));
  }

  private getResourceType(mediaType: string): ResourceInfo['type'] {
    if (mediaType.startsWith('image/')) return 'image';
    if (mediaType.includes('css') || mediaType.includes('stylesheet')) return 'css';
    if (mediaType.includes('font') || mediaType.includes('woff') || mediaType.includes('ttf')) return 'font';
    return 'other';
  }

  private getResourceSubDir(type: ResourceInfo['type']): string {
    switch (type) {
      case 'image': return 'images';
      case 'css': return 'styles';
      case 'font': return 'fonts';
      default: return 'other';
    }
  }

  async processResource(
    manifestItem: ManifestItem,
    resourceContent: Uint8Array
  ): Promise<ResourceInfo> {
    const type = this.getResourceType(manifestItem.mediaType);
    const subDir = this.getResourceSubDir(type);
    
    // Generate safe filename
    const originalName = path.basename(manifestItem.href);
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    const newPath = path.join(this.resourcesDir, subDir, sanitizedName);
    const relativePath = path.join('resources', subDir, sanitizedName);

    // Write resource to file
    await fs.writeFile(newPath, resourceContent);

    const resourceInfo: ResourceInfo = {
      originalPath: manifestItem.href,
      newPath,
      relativePath,
      type
    };

    this.resourceMap.set(manifestItem.href, resourceInfo);
    return resourceInfo;
  }

  getResourceInfo(originalPath: string): ResourceInfo | undefined {
    return this.resourceMap.get(originalPath);
  }

  updateLinksInContent(content: string): string {
    let updatedContent = content;
    
    // Update image references
    this.resourceMap.forEach((resourceInfo, originalPath) => {
      // Handle various link formats
      const patterns = [
        new RegExp(`src=["']([^"']*${this.escapeRegex(originalPath)}[^"']*)["']`, 'g'),
        new RegExp(`href=["']([^"']*${this.escapeRegex(originalPath)}[^"']*)["']`, 'g'),
        new RegExp(`url\\(["']?([^"')]*${this.escapeRegex(originalPath)}[^"')]*)["']?\\)`, 'g'),
      ];

      patterns.forEach(pattern => {
        updatedContent = updatedContent.replace(pattern, (match, fullPath) => {
          return match.replace(fullPath, resourceInfo.relativePath);
        });
      });
    });

    return updatedContent;
  }

  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  updateMarkdownLinks(markdown: string): string {
    let updatedMarkdown = markdown;
    
    this.resourceMap.forEach((resourceInfo, originalPath) => {
      // Update markdown image syntax ![alt](path)
      const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(([^\\)]*${this.escapeRegex(originalPath)}[^\\)]*)\\)`, 'g');
      updatedMarkdown = updatedMarkdown.replace(imagePattern, (match, alt, fullPath) => {
        return `![${alt}](${resourceInfo.relativePath})`;
      });

      // Update markdown link syntax [text](path)
      const linkPattern = new RegExp(`\\[([^\\]]*)\\]\\(([^\\)]*${this.escapeRegex(originalPath)}[^\\)]*)\\)`, 'g');
      updatedMarkdown = updatedMarkdown.replace(linkPattern, (match, text, fullPath) => {
        return `[${text}](${resourceInfo.relativePath})`;
      });
    });

    return updatedMarkdown;
  }

  getAllResources(): ResourceInfo[] {
    return Array.from(this.resourceMap.values());
  }
}