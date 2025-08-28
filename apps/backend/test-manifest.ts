import { initEpubFile } from '@lingo-reader/epub-parser';
import { promises as fs } from 'fs';
import * as path from 'path';

async function testManifest() {
  console.log('=== TESTING @lingo-reader/epub-parser MANIFEST ===\n');
  
  const epubPath = '5_langs_singles.epub';
  
  // Test different resource directory configurations
  const testConfigs = [
    { dir: './test-resources-1', description: 'Default relative path' },
    { dir: '/Users/ali/Documents/niga/test-resources-2', description: 'Absolute path' },
    { dir: undefined, description: 'No resource directory (default)' }
  ];
  
  for (const config of testConfigs) {
    console.log(`\n--- Testing with ${config.description} ---`);
    console.log(`Resource directory: ${config.dir || 'default (./images)'}`);
    
    try {
      // Initialize EPUB with different resource directory settings
      const epub = config.dir 
        ? await initEpubFile(epubPath, config.dir)
        : await initEpubFile(epubPath);
      
      // Get manifest
      const manifest = epub.getManifest();
      console.log(`Manifest contains ${Object.keys(manifest).length} items`);
      
      // Analyze manifest content
      const resourcesByType: Record<string, number> = {};
      const sampleResources: Array<{id: string, href: string, mediaType: string}> = [];
      
      for (const [id, item] of Object.entries(manifest)) {
        const type = item.mediaType.split('/')[0];
        resourcesByType[type] = (resourcesByType[type] || 0) + 1;
        
        // Collect sample resources
        if (item.mediaType.startsWith('image/') && sampleResources.length < 3) {
          sampleResources.push({ id, href: item.href, mediaType: item.mediaType });
        }
      }
      
      console.log('Resource types found:');
      Object.entries(resourcesByType).forEach(([type, count]) => {
        console.log(`  ${type}: ${count} items`);
      });
      
      console.log('\nSample image resources:');
      sampleResources.forEach(resource => {
        console.log(`  ${resource.id}: ${resource.href} (${resource.mediaType})`);
      });
      
      // Check if resource directory was created and populated
      const resourceDir = config.dir || './images';
      const absoluteResourceDir = path.resolve(resourceDir);
      console.log(`Checking resource directory: ${absoluteResourceDir}`);
      
      try {
        const files = await fs.readdir(absoluteResourceDir);
        console.log(`Resource directory contains ${files.length} files`);
        if (files.length > 0) {
          console.log('Sample files:', files.slice(0, 3));
          
          // Check file size of first image
          const firstImage = files.find(f => f.endsWith('.jpg'));
          if (firstImage) {
            const filePath = path.join(absoluteResourceDir, firstImage);
            const stats = await fs.stat(filePath);
            console.log(`Sample file ${firstImage} size: ${stats.size} bytes`);
          }
        }
      } catch (error) {
        console.log(`Resource directory error: ${error}`);
      }
      
      // Test loadChapter to see how images are handled
      const spine = epub.getSpine();
      if (spine.length > 0) {
        console.log(`\nTesting loadChapter with first spine item: ${spine[0].id}`);
        const chapter = await epub.loadChapter(spine[0].id);
        console.log(`Chapter HTML length: ${chapter?.html?.length || 0} characters`);
        console.log(`Chapter CSS files: ${chapter?.css?.length || 0}`);
        
        // Look for image references in the HTML
        if (chapter?.html) {
          const imgMatches = chapter.html.match(/<img[^>]+src="([^"]+)"/g) || [];
          console.log(`Found ${imgMatches.length} image references in chapter HTML`);
          if (imgMatches.length > 0) {
            console.log('Sample image src:', imgMatches[0]);
          }
        }
      }
      
      // Final check before destroying the epub object
      console.log('\n--- BEFORE DESTROY ---');
      try {
        const files = await fs.readdir(absoluteResourceDir);
        console.log(`Files before destroy: ${files.length}`);
      } catch (error) {
        console.log(`Error reading directory before destroy: ${error}`);
      }
      
      await epub.destroy();
      
      // Check after destroy
      console.log('--- AFTER DESTROY ---');
      try {
        const files = await fs.readdir(absoluteResourceDir);
        console.log(`Files after destroy: ${files.length}`);
      } catch (error) {
        console.log(`Error reading directory after destroy: ${error}`);
      }
      
    } catch (error) {
      console.error(`Error with ${config.description}:`, error);
    }
  }
}

testManifest().catch(console.error);