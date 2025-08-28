import { convertEpubToM4b } from './src/epub-to-m4b';

async function testConversion() {
  try {
    console.log('Starting test conversion...');
    
    const outputPath = await convertEpubToM4b({
      epubPath: './test.epub', // You'll need to provide a test EPUB file
      metadata: {
        title: 'Test Audiobook',
        artist: 'AI Narrator',
        album: 'Test Collection',
        genre: 'Test'
      }
    });
    
    console.log('✅ Test conversion completed:', outputPath);
  } catch (error) {
    console.error('❌ Test conversion failed:', error);
  }
}

// Run the test
testConversion();