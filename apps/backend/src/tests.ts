import { wavToAac } from './audio/converters/wav-to-aac';
import { convertEpubToMarkdown } from './epub-to-markdown';
import * as path from 'path';

const epubPath = path.join(process.cwd(), 'test-book.epub');
const outputDir = path.join(process.cwd(), 'output');

await convertEpubToMarkdown({
    epubPath,
    outputDir,
    verbose: true,
    createToc: true,
    extractResources: true
  });

const inputFile = 'generated-audio.wav';
  const outputFile = 'generated-audio.aac';
  await wavToAac(inputFile, outputFile);
