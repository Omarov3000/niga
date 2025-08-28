import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { convertEpubToMarkdown } from './epub-to-markdown';
import { extractChapters } from './extract-chapters';
import { narrate } from './audio/narrate';
import { wavToAac } from './audio/converters/wav-to-aac';
import { aacToM4b } from './audio/converters/aac-to-m4b';

interface Progress {
  epubPath: string;
  startedAt: string;
  lastUpdated: string;
  totalChapters: number;
  completedChapters: number;
  chapters: {
    [chapterIndex: number]: {
      chapterTitle: string;
      totalParagraphs: number;
      completedParagraphs: number;
      aacFiles: string[];
    }
  };
  status: 'in_progress' | 'completed' | 'failed';
}

interface ConversionOptions {
  epubPath: string;
  outputPath?: string;
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveFileToFS(file: File, filePath: string): Promise<void> {
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

export async function convertEpubToM4b(options: ConversionOptions): Promise<string> {
  const { epubPath, metadata = {} } = options;
  const epubBasename = path.basename(epubPath, '.epub');
  const workDir = path.join('temp', epubBasename);

  const dirs = {
    base: workDir,
    markdown: path.join(workDir, 'markdown'),
    wav: path.join(workDir, 'wav'),
    aac: path.join(workDir, 'aac'),
    progress: path.join(workDir, 'progress'),
    logs: path.join(workDir, 'logs')
  };

  // Create directories if they don't exist
  await fs.mkdir(dirs.base, { recursive: true });
  await fs.mkdir(dirs.markdown, { recursive: true });
  await fs.mkdir(dirs.wav, { recursive: true });
  await fs.mkdir(dirs.aac, { recursive: true });
  await fs.mkdir(dirs.progress, { recursive: true });
  await fs.mkdir(dirs.logs, { recursive: true });

  const progressPath = path.join(dirs.progress, 'progress.json');
  const narrationLogPath = path.join(dirs.logs, 'narration.log');

  // Initialize or append to narration log
  async function logNarration(chapterIndex: number, paragraphIndex: number, text: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] Chapter ${chapterIndex + 1}, Paragraph ${paragraphIndex + 1}: "${text}"\n`;
    await fs.appendFile(narrationLogPath, logEntry);
  }

  async function loadProgress(): Promise<Progress | null> {
    try {
      const data = await fs.readFile(progressPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async function saveProgress(progress: Progress): Promise<void> {
    progress.lastUpdated = new Date().toISOString();
    await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
  }

  // Log conversion start
  if (!await fileExists(narrationLogPath)) {
    await fs.writeFile(narrationLogPath, `=== EPUB to M4B Conversion Log ===\nEPUB: ${epubPath}\nStarted: ${new Date().toISOString()}\n\n`);
  } else {
    await fs.appendFile(narrationLogPath, `\n=== Resumed Conversion ===\nResumed: ${new Date().toISOString()}\n\n`);
  }

  // Step 1: Convert EPUB to Markdown (if needed)
  const markdownPath = path.join(dirs.markdown, 'book.md');

  if (!await fileExists(markdownPath)) {
    console.log('Converting EPUB to Markdown...');

    // Create a temporary output directory for the converter
    const tempOutputDir = path.join(dirs.markdown, 'temp-output');

    // Use the existing converter with its expected interface
    await convertEpubToMarkdown({
      epubPath,
      outputDir: tempOutputDir,
      createToc: false,
      extractResources: false
    });

    // Combine all chapter files into a single markdown file
    const chapterFiles = await fs.readdir(path.join(tempOutputDir, 'chapters'));
    const sortedChapterFiles = chapterFiles.filter(f => f.endsWith('.md')).sort();

    let combinedMarkdown = '';
    for (const chapterFile of sortedChapterFiles) {
      const chapterContent = await fs.readFile(path.join(tempOutputDir, 'chapters', chapterFile), 'utf-8');
      combinedMarkdown += chapterContent + '\n\n';
    }

    await fs.writeFile(markdownPath, combinedMarkdown);

    // Clean up temp directory
    await fs.rm(tempOutputDir, { recursive: true, force: true });
  } else {
    console.log('Markdown already exists, skipping EPUB conversion');
  }

  const markdownContent = await fs.readFile(markdownPath, 'utf-8');

  // Step 2: Extract chapters and setup progress
  const chapters = extractChapters(markdownContent);
  let progress = await loadProgress();

  // Initialize progress if new conversion
  if (!progress) {
    progress = {
      epubPath,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      totalChapters: chapters.length,
      completedChapters: 0,
      chapters: {},
      status: 'in_progress'
    };

    // Initialize chapter progress
    chapters.forEach((chapter, index) => {
      progress.chapters[index] = {
        chapterTitle: chapter.chapter,
        totalParagraphs: chapter.content.length,
        completedParagraphs: 0,
        aacFiles: []
      };
    });

    await saveProgress(progress);
  }

  // Step 3: Process each chapter
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const chapterProgress = progress.chapters[chapterIndex];

    // Skip completed chapters
    if (chapterProgress.completedParagraphs === chapterProgress.totalParagraphs) {
      console.log(`Chapter ${chapterIndex + 1} already completed, skipping`);
      continue;
    }

    console.log(`Processing chapter ${chapterIndex + 1}/${chapters.length}: ${chapter.chapter}`);

    // Process each paragraph
    for (const [paragraphIndex, paragraph] of chapter.content.entries()) {
      const chapterNum = String(chapterIndex + 1).padStart(3, '0');
      const paragraphNum = String(paragraphIndex + 1).padStart(3, '0');
      const fileBasename = `ch${chapterNum}-p${paragraphNum}`;

      const wavPath = path.join(dirs.wav, `${fileBasename}.wav`);
      const aacPath = path.join(dirs.aac, `${fileBasename}.aac`);

      // Skip if AAC already exists
      if (await fileExists(aacPath)) {
        console.log(`  Paragraph ${paragraphIndex + 1} already processed`);
        continue;
      }

      console.log(`  Processing paragraph ${paragraphIndex + 1}/${chapter.content.length}`);

      // Log narration content to file
      await logNarration(chapterIndex, paragraphIndex, paragraph);

      try {
        // Generate audio
        const audioFile = await narrate(paragraph);
        await saveFileToFS(audioFile, wavPath);

        // Convert to AAC
        await wavToAac(wavPath, aacPath);

        // Clean up WAV file
        await fs.unlink(wavPath);

        // Update progress
        chapterProgress.completedParagraphs++;
        chapterProgress.aacFiles.push(aacPath);
        await saveProgress(progress);

      } catch (error) {
        console.error(`Failed to process paragraph ${paragraphIndex + 1}:`, error);
        progress.status = 'failed';
        await saveProgress(progress);
        throw error;
      }
    }

    progress.completedChapters++;
    await saveProgress(progress);
  }

  // Step 4: Combine AAC files to M4B
  const outputPath = options.outputPath || `${epubBasename}.m4b`;

  if (progress.completedChapters === progress.totalChapters) {
    console.log('All chapters processed, creating M4B file');

    // Read EPUB metadata from the conversion output
    let epubMetadata = null;
    try {
      // Try to find metadata.json in the temporary output directory first
      let metadataPath = path.join(dirs.markdown, 'temp-output', 'metadata.json');

      // If not found, check if it exists in the output directory from a previous run
      if (!await fileExists(metadataPath)) {
        const outputDir = path.join('output', path.basename(epubPath, '.epub'));
        metadataPath = path.join(outputDir, 'metadata.json');
      }

      if (await fileExists(metadataPath)) {
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        epubMetadata = JSON.parse(metadataContent);
        console.log('Loaded EPUB metadata for M4B creation');
      } else {
        console.log('No EPUB metadata found, using defaults');
      }
    } catch (error) {
      console.warn('Could not load EPUB metadata:', error);
    }

    // Build final metadata combining EPUB data with user overrides
    const finalMetadata = {
      title: metadata.title || (epubMetadata?.title) || epubBasename,
      album: metadata.album || (epubMetadata?.title) || epubBasename,
      artist: metadata.artist || (epubMetadata?.creator?.[0]?.contributor) || 'AI Narrator',
      genre: metadata.genre || 'Audiobook',
      date: epubMetadata?.date?.publication,
      publisher: epubMetadata?.publisher,
      ...metadata // User-provided metadata takes precedence
    };

    // Find cover image
    let coverImagePath: string | undefined = undefined;
    if (epubMetadata?.metas?.cover) {
      // Look for cover image in various possible locations and formats
      const possibleCoverPaths = [
        // Based on the normalized naming pattern (image-1.jpg is typically the cover)
        path.join(dirs.markdown, 'temp-output', 'resources', 'image-1.jpg'),
        path.join(dirs.markdown, 'temp-output', 'resources', 'image-1.jpeg'),
        path.join(dirs.markdown, 'temp-output', 'resources', 'image-1.png'),
        // Also check output directory from previous runs
        path.join('output', path.basename(epubPath, '.epub'), 'resources', 'image-1.jpg'),
        path.join('output', path.basename(epubPath, '.epub'), 'resources', 'image-1.jpeg'),
        path.join('output', path.basename(epubPath, '.epub'), 'resources', 'image-1.png')
      ];

      for (const candidatePath of possibleCoverPaths) {
        if (await fileExists(candidatePath)) {
          coverImagePath = candidatePath;
          console.log(`Found cover image: ${coverImagePath}`);
          break;
        }
      }

      if (!coverImagePath) {
        console.log('Cover image reference found in metadata but file not located');
      }
    }

    await aacToM4b(dirs.aac, outputPath, finalMetadata, coverImagePath);

    progress.status = 'completed';
    await saveProgress(progress);

    // Log completion
    await fs.appendFile(narrationLogPath, `\n=== Conversion Completed ===\nCompleted: ${new Date().toISOString()}\nOutput: ${outputPath}\n`);

    console.log(`Successfully created: ${outputPath}`);
    return outputPath;
  } else {
    throw new Error('Not all chapters were processed successfully');
  }
}

export async function cleanup(epubBasename: string, force: boolean = false): Promise<void> {
  const workDir = path.join('temp', epubBasename);
  const progressPath = path.join(workDir, 'progress', 'progress.json');

  let progress: Progress | null = null;
  try {
    const data = await fs.readFile(progressPath, 'utf-8');
    progress = JSON.parse(data);
  } catch {
    // Progress file doesn't exist
  }

  if (!force && progress?.status !== 'completed') {
    console.log('Conversion not completed. Use --force to clean anyway.');
    return;
  }

  await fs.rm(workDir, { recursive: true, force: true });
  console.log(`Cleaned up: ${workDir}`);
}
