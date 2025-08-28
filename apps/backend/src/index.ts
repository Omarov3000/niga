import { readFile } from 'fs/promises'
import { parseEpub } from './parse-epub/parse-epub'
import { parseLocalEpub } from './parse-epub/utils'
import { epubToMdByPath } from './fs-utils/epub-to-md-by-path'

async function testParseEpub() {
  try {
    // Method 1: Parse and get data in memory
    console.log('=== Parsing test-book.epub ===\n')

    const fileData = await readFile('5_langs_singles.epub')
    const epubBlob = new Blob([fileData])
    const { metadata, toc, manifest, spine, getContent } = await parseEpub(epubBlob)

    console.log('Metadata:', JSON.stringify(metadata, null, 2))
    console.log('\nTOC (first 3 items):', JSON.stringify(toc.slice(0, 3), null, 2))
    console.log('\nManifest items count:', Object.keys(manifest).length)
    console.log('\nSpine items count:', spine.length)

    // Test getting content
    if (spine.length > 0) {
      const firstChapter = manifest[spine[0].id]
      if (firstChapter) {
        console.log('\nFirst chapter path:', firstChapter.href)
        const content = await getContent(firstChapter.href)
        if (content) {
          console.log('First chapter preview (first 200 chars):', content.substring(0, 200) + '...')
        }
      }
    }

    // Method 2: Extract to filesystem
    console.log('\n=== Extracting to filesystem ===\n')
    await parseLocalEpub('test-book.epub')

    // Method 3: Convert to markdown with new epub-to-md functionality
    console.log('\n=== Converting to markdown ===\n')
    await epubToMdByPath('test-book.epub')

  } catch (error) {
    console.error('Error parsing EPUB:', error)
  }
}

// Run the test
testParseEpub()
