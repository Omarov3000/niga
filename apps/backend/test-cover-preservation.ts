import { aacToM4b } from './src/audio/converters/aac-to-m4b';
import { promises as fs } from 'fs';
import * as path from 'path';

async function testCoverPreservation() {
  console.log('🧪 Testing Cover Image Preservation in M4B');
  console.log('=' .repeat(50));

  // Load EPUB metadata
  const metadataPath = './output/test-conversion/metadata.json';
  const epubMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

  console.log('📖 Loaded EPUB metadata:');
  console.log(`  Title: ${epubMetadata.title}`);
  console.log(`  Author: ${epubMetadata.creator?.[0]?.contributor}`);
  console.log(`  Publisher: ${epubMetadata.publisher}`);
  console.log(`  Date: ${epubMetadata.date?.publication}`);
  console.log(`  Cover reference: ${epubMetadata.metas?.cover}`);

  // Prepare metadata for M4B
  const m4bMetadata = {
    title: epubMetadata.title,
    artist: epubMetadata.creator?.[0]?.contributor || 'Unknown Author',
    album: epubMetadata.title,
    genre: 'Audiobook',
    date: epubMetadata.date?.publication,
    publisher: epubMetadata.publisher
  };

  // Cover image path
  const coverImagePath = './output/test-conversion/resources/image-1.jpg';

  // Check if cover exists
  try {
    await fs.access(coverImagePath);
    console.log(`🖼️  Cover image found: ${coverImagePath}`);
  } catch {
    console.log('❌ Cover image not found at expected location');
    return;
  }

  console.log('\n🔧 Converting to M4B with cover...');

  try {
    const outputPath = await aacToM4b(
      './test-cover/aac',
      'test-with-cover.m4b',
      m4bMetadata,
      coverImagePath
    );

    console.log('✅ M4B created successfully!');
    console.log(`📁 Output: ${outputPath}`);

    // Check file size to confirm it was created
    const stats = await fs.stat(outputPath);
    console.log(`📊 File size: ${Math.round(stats.size / 1024)} KB`);

    console.log('\n🔍 To verify the cover image was embedded:');
    console.log('1. Open the M4B file in an audio player like VLC or iTunes');
    console.log('2. Check if the cover image appears');
    console.log('3. Use `ffprobe test-with-cover.m4b` to inspect metadata');

  } catch (error) {
    console.error('❌ Conversion failed:', error);
  }
}

testCoverPreservation().catch(console.error);
