# EPUB to M4B Converter

Convert EPUB files to M4B audiobooks using AI text-to-speech.

## Features

- ✅ Automatic resume - conversions continue where they left off
- ✅ Progress tracking - know exactly where you are in the conversion
- ✅ Chapter preservation - maintains book structure
- ✅ Metadata support - add title, author, and more
- ✅ Efficient processing - skips already converted content

## Usage

### Convert an EPUB file
```bash
# Basic conversion (automatically resumes if interrupted)
pnpm run dev convert book.epub

# Start fresh conversion (delete existing progress)
pnpm run dev convert book.epub --no-resume
```

### Clean up temporary files
```bash
# Clean completed conversion
pnpm run dev cleanup book

# Force cleanup (even if incomplete)
pnpm run dev cleanup book --force
```

## How it works

1. **EPUB → Markdown**: Extracts text content from EPUB
2. **Chapter extraction**: Identifies chapters and paragraphs
3. **Text-to-Speech**: Converts each paragraph to audio using Kokoro TTS
4. **Audio conversion**: Converts WAV to AAC for efficient storage
5. **M4B creation**: Combines all AAC files into a single M4B audiobook

## File Structure

The converter creates a working directory structure:
```
temp/
└── book-name/
    ├── markdown/
    │   └── book.md
    ├── wav/              # Temporary WAV files (deleted after conversion)
    ├── aac/              # AAC files for each paragraph
    │   ├── ch001-p001.aac
    │   ├── ch001-p002.aac
    │   └── ...
    └── progress/
        └── progress.json # Tracks conversion progress
```

## Progress Tracking

The converter maintains a `progress.json` file that tracks:
- Total chapters and completion status
- Paragraphs processed per chapter
- AAC files created
- Overall conversion status

This allows you to:
- Interrupt conversion at any time (Ctrl+C)
- Resume exactly where you left off
- See detailed progress information
