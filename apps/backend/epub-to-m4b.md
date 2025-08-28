issue: small images (separators) after headings or above them should be removed before narrating.
issue: cover and other metadata is not transferred to the m4b file.


# Fix EPUB to Markdown at the Source

## Root Cause Analysis

The problem occurs in `src/epub-converter.ts:194` in `formatChapterContent()`:

```ts
const title = spineItem.id || `Chapter ${index}`;  // Uses spine ID instead of extracting actual titles
```

This generates `# id_6` instead of extracting the actual title from the HTML content.

---

## Solution: Extract Real Titles During HTML Processing

### 1. Modify `convertChapters()` Method in `src/epub-converter.ts`

Before line 153 (where HTML is converted to markdown), add title extraction:

```ts
// Extract meaningful title from HTML content
const extractedTitle = this.extractChapterTitle(chapter.html, spineItem, i + 1);
```

---

### 2. Create `extractChapterTitle()` Method in `EpubConverter` Class

```ts
private extractChapterTitle(html: string, spineItem: any, index: number): string {
  // Try to extract title from HTML content
  const titleMatches = [
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<h2[^>]*>([^<]+)<\/h2>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    // Look for navigation links that might contain the title
    /<a[^>]*>([^<]+)<\/a>/i
  ];

  for (const regex of titleMatches) {
    const match = html.match(regex);
    if (match && match[1].trim() && !match[1].includes('id_')) {
      return match[1].trim().replace(/[^\w\s-]/g, '').trim();
    }
  }

  // Fallback to spine item processing
  if (spineItem.id && !spineItem.id.startsWith('id_')) {
    return spineItem.id.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  return `Chapter ${index}`;
}
```

---

### 3. Update `formatChapterContent()` Method

Replace the current title logic:

```ts
private formatChapterContent(
  spineItem: any,
  markdown: string,
  index: number,
  extractedTitle: string
): string {
  return [
    `# ${extractedTitle}`,  // Use extracted title instead of spineItem.id
    '',
    '---',
    '',
    markdown,
    ''
  ].join('\n');
}
```

---

### 4. Remove Duplicate Navigation Links

Add a markdown cleaning step in `convertChapters()` after unified processing:

```ts
// Clean up duplicate navigation links
markdown = this.removeDuplicateNavigationLinks(markdown, extractedTitle);
```

```ts
private removeDuplicateNavigationLinks(markdown: string, chapterTitle: string): string {
  // Remove links that match the chapter title (case-insensitive)
  const linkPattern = new RegExp(`\\[${chapterTitle}\\]\\(epub:[^\\)]+\\)`, 'gi');
  return markdown.replace(linkPattern, '').replace(/\n\s*\n\s*\n/g, '\n\n');
}
```

---

### 5. Update Method Signature

Modify the call in `convertChapters()`:

```ts
const chapterContent = this.formatChapterContent(
  spineItem,
  markdown,
  i + 1,
  extractedTitle
);
```

---

**This approach fixes the issue at the source by extracting meaningful titles during the initial HTML-to-markdown conversion, eliminating both the `id_X` problem and duplicate navigation links.**

Goal: convert epub to m4b (with restartable processing)

## High-Level Steps:
1. convertEpubToMarkdown()
2. extractChapters()
3. for each chapter convertWavToAac(saveFileToFS(narrate()))
4. for the resulting aac files convertAacToM4b()

## Detailed Implementation Plan:

### 1. Setup Working Directory Structure
```typescript
const epubBasename = path.basename(epubPath, '.epub');
const workDir = path.join('temp', epubBasename);
const dirs = {
  base: workDir,
  markdown: path.join(workDir, 'markdown'),
  wav: path.join(workDir, 'wav'),
  aac: path.join(workDir, 'aac'),
  progress: path.join(workDir, 'progress')
};

// Create directories if they don't exist
await fs.mkdir(dirs.base, { recursive: true });
await fs.mkdir(dirs.markdown, { recursive: true });
await fs.mkdir(dirs.wav, { recursive: true });
await fs.mkdir(dirs.aac, { recursive: true });
await fs.mkdir(dirs.progress, { recursive: true });
```

### 2. Progress Tracking System
```typescript
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

const progressPath = path.join(dirs.progress, 'progress.json');

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
```

### 3. EPUB to Markdown Conversion (Skip if exists)
```typescript
const markdownPath = path.join(dirs.markdown, 'book.md');

if (!await fileExists(markdownPath)) {
  const markdown = await convertEpubToMarkdown(epubPath);
  await fs.writeFile(markdownPath, markdown);
} else {
  console.log('Markdown already exists, skipping EPUB conversion');
}

const markdownContent = await fs.readFile(markdownPath, 'utf-8');
```

### 4. Process Chapters with Resume Support
```typescript
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

// Process each chapter
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

    try {
      // Generate audio
      const audioFile = await narrate(paragraph);
      await saveFileToFS(audioFile, wavPath);

      // Convert to AAC
      await convertWavToAac(wavPath, aacPath);

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
```

### 5. Combine AAC Files to M4B
```typescript
// Only proceed if all chapters are complete
if (progress.completedChapters === progress.totalChapters) {
  console.log('All chapters processed, creating M4B file');

  const outputPath = `${epubBasename}.m4b`;
  const metadata = {
    title: epubBasename,
    album: epubBasename,
    artist: 'AI Narrator',
    genre: 'Audiobook'
  };

  await convertAacToM4b(dirs.aac, outputPath, metadata);

  progress.status = 'completed';
  await saveProgress(progress);

  console.log(`Successfully created: ${outputPath}`);
}
```

### 6. Utility Functions
```typescript
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
```

### 7. Cleanup Function
```typescript
async function cleanup(epubBasename: string, force: boolean = false): Promise<void> {
  const workDir = path.join('temp', epubBasename);
  const progress = await loadProgress();

  if (!force && progress?.status !== 'completed') {
    console.log('Conversion not completed. Use --force to clean anyway.');
    return;
  }

  await fs.rm(workDir, { recursive: true, force: true });
  console.log(`Cleaned up: ${workDir}`);
}
```
