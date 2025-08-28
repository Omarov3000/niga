#!/usr/bin/env node

import { program } from 'commander';
import { convertEpubToM4b, cleanup } from './epub-to-m4b';
import * as path from 'node:path';

program
  .name('epub-to-m4b')
  .description('Convert EPUB files to M4B audiobooks')
  .version('1.0.0');

program
  .command('convert <epubPath>')
  .description('Convert an EPUB file to M4B audiobook (resumes by default)')
  .option('--no-resume', 'Start fresh conversion (delete existing progress)')
  .action(async (epubPath: string, options) => {
    try {
      const epubBasename = path.basename(epubPath, '.epub');
      
      // If --no-resume flag is set, clean up existing progress
      if (options.resume === false) {
        console.log('Starting fresh conversion (--no-resume flag set)');
        await cleanup(epubBasename, true);
      }

      const outputPath = await convertEpubToM4b({
        epubPath: path.resolve(epubPath)
      });

      console.log(`✅ Conversion complete: ${outputPath}`);
    } catch (error) {
      console.error('❌ Conversion failed:', error);
      process.exit(1);
    }
  });

program
  .command('cleanup <epubName>')
  .description('Clean up temporary files for a conversion')
  .option('-f, --force', 'Force cleanup even if conversion is incomplete')
  .action(async (epubName: string, options) => {
    try {
      await cleanup(epubName, options.force);
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      process.exit(1);
    }
  });

program.parse();
