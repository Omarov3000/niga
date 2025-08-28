import { EpubConverter } from './src/epub-converter.js';

const epubPath = '5_langs_singles.epub';
const outputDir = 'output/test-conversion';

const converter = new EpubConverter({
  outputDir,
  createToc: true,
  extractResources: true
});

try {
  console.log('Starting EPUB to Markdown conversion...');
  const result = await converter.convert(epubPath);
  
  console.log('Conversion completed!');
  console.log(`Chapters: ${result.chapterCount}`);
  console.log(`Resources: ${result.resourceCount}`);
  console.log(`Output directory: ${result.outputDir}`);
} catch (error) {
  console.error('Conversion failed:', error);
} finally {
  await converter.cleanup();
}