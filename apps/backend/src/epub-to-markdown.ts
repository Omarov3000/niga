import * as path from 'path';
import { EpubConverter } from './epub-converter.js';
import type { ConversionOptions } from './epub-converter.js';

export interface CliOptions extends Partial<ConversionOptions> {
  epubPath: string;
  verbose?: boolean;
}

export async function convertEpubToMarkdown(options: CliOptions): Promise<void> {
  const {
    epubPath,
    outputDir = path.join(process.cwd(), 'output'),
    createToc = true,
    extractResources = true,
    chapterNamePattern = '{index:02d}-{title}',
    verbose = false
  } = options;

  if (verbose) {
    console.log('Starting EPUB to Markdown conversion...');
    console.log(`Input: ${epubPath}`);
    console.log(`Output: ${outputDir}`);
    console.log(`Extract resources: ${extractResources}`);
    console.log(`Create TOC: ${createToc}`);
    console.log(`Chapter naming: ${chapterNamePattern}`);
    console.log('---');
  }

  const converter = new EpubConverter({
    outputDir,
    createToc,
    extractResources,
    chapterNamePattern
  });

  try {
    const startTime = Date.now();
    
    const result = await converter.convert(epubPath);
    
    const duration = Date.now() - startTime;
    
    console.log('✅ Conversion completed successfully!');
    console.log(`📖 Book: ${result.metadata.title}`);
    console.log(`📝 Chapters converted: ${result.chapterCount}`);
    console.log(`🖼️  Resources extracted: ${result.resourceCount}`);
    console.log(`📁 Output directory: ${result.outputDir}`);
    console.log(`⏱️  Time taken: ${duration}ms`);
    
    if (result.metadata.creator && result.metadata.creator.length > 0) {
      console.log(`👤 Author: ${result.metadata.creator[0].contributor}`);
    }
    
    if (result.metadata.language) {
      console.log(`🌐 Language: ${result.metadata.language}`);
    }

  } catch (error) {
    console.error('❌ Conversion failed:', error);
    throw error;
  } finally {
    await converter.cleanup();
  }
}

// CLI argument parsing
export function parseCliArgs(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--output':
      case '-o':
        if (nextArg && !nextArg.startsWith('-')) {
          options.outputDir = nextArg;
          i++;
        }
        break;
        
      case '--no-toc':
        options.createToc = false;
        break;
        
      case '--no-resources':
        options.extractResources = false;
        break;
        
      case '--chapter-pattern':
        if (nextArg && !nextArg.startsWith('-')) {
          options.chapterNamePattern = nextArg;
          i++;
        }
        break;
        
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
        
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
        
      default:
        if (!arg.startsWith('-') && !options.epubPath) {
          options.epubPath = arg;
        }
        break;
    }
  }
  
  if (!options.epubPath) {
    console.error('Error: EPUB file path is required');
    printHelp();
    process.exit(1);
  }
  
  return options as CliOptions;
}

function printHelp(): void {
  console.log(`
EPUB to Markdown Converter

Usage: npm run start <epub-file> [options]

Arguments:
  <epub-file>                Path to the EPUB file to convert

Options:
  -o, --output <dir>         Output directory (default: ./output)
  --no-toc                   Don't create table of contents
  --no-resources             Don't extract resources (images, etc.)
  --chapter-pattern <pattern> Chapter filename pattern (default: {index:02d}-{title})
  -v, --verbose              Verbose output
  -h, --help                 Show this help message

Chapter Pattern Variables:
  {index}                    Chapter index (1, 2, 3...)
  {index:02d}               Zero-padded chapter index (01, 02, 03...)
  {title}                   Chapter title (sanitized for filename)

Examples:
  npm run start book.epub
  npm run start book.epub --output my-book
  npm run start book.epub --no-resources --verbose
  npm run start book.epub --chapter-pattern "chapter-{index}-{title}"
`);
}

// Main CLI entry point
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printHelp();
    process.exit(1);
  }
  
  try {
    const options = parseCliArgs(args);
    await convertEpubToMarkdown(options);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Allow running this file directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}