import { describe, it, expect } from 'vitest'
import { epubToMd } from './epub-to-md'
import { archive } from '../parse-epub/archive'
import { makeBlackSquare32, makeBlueSquare50 } from '../test-utils/make-test-file'
import { unified } from 'unified'
import remarkStringify from 'remark-stringify'

async function createTestEpub(): Promise<Blob> {
  const files: Record<string, Blob> = {}

  // Container XML
  files['META-INF/container.xml'] = new Blob([`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`], { type: 'application/xml' })

  // OPF file
  files['OEBPS/content.opf'] = new Blob([`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book Title</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">test-book-123</dc:identifier>
  </metadata>

  <manifest>
    <item id="chapter1" href="chapter1.html" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.html" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="image1" href="test-image.png" media-type="image/png"/>
  </manifest>

  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>`], { type: 'application/xml' })

  // Chapter 1
  files['OEBPS/chapter1.html'] = new Blob([`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapter One: The Beginning</title>
</head>
<body>
  <h1>Chapter One</h1>
  <p>This is the first chapter with some <strong>bold text</strong> and a <a href="#link">link</a>.</p>
  <img src="test-image.png" alt="Test Image" />
</body>
</html>`], { type: 'application/xhtml+xml' })

  // Chapter 2
  files['OEBPS/chapter2.html'] = new Blob([`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapter Two: The Journey</title>
</head>
<body>
  <h1>Chapter Two</h1>
  <p>This is the second chapter with <em>italic text</em> and more content.</p>
  <ul>
    <li>Item one</li>
    <li>Item two</li>
  </ul>
</body>
</html>`], { type: 'application/xhtml+xml' })

  // Images
  const coverImage = makeBlackSquare32('cover.png')
  const testImage = makeBlueSquare50('test-image.png')
  files['OEBPS/cover.png'] = coverImage.blob()
  files['OEBPS/test-image.png'] = testImage.blob()

  return await archive(files)
}

// Expected markdown output for test EPUB (cleaned, no XML processing instructions)
const EXPECTED_MARKDOWN = `# Chapter One

This is the first chapter with some **bold text** and a [link](#link).

![Test Image](test-image.png)

# Chapter Two

This is the second chapter with _italic text_ and more content.

- Item one
- Item two
`

describe('epub-to-md', () => {

  it('should convert EPUB content to markdown and extract resources with proper file sizes', async () => {
    const testEpubBlob = await createTestEpub()
    const result = await epubToMd(testEpubBlob)

    // Convert mdast to markdown for testing
    const markdownProcessor = unified()
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '_',
        strong: '*',
        listItemIndent: 'one'
      })

    const markdownContent = markdownProcessor.stringify(result.mdast)

    // Validate full markdown content structure
    expect(markdownContent).toBe(EXPECTED_MARKDOWN)

    // Check that resources contain images with proper sizes
    const imageResources = Array.from(result.resources.entries()).filter(([path]) =>
      path.includes('.png')
    )
    expect(imageResources.length).toBe(2) // cover.png and test-image.png

    // Validate resource file sizes and types
    for (const [resourcePath, blob] of imageResources) {
      expect(resourcePath).toMatch(/\.(png)$/)
      expect(blob.size).toBeGreaterThan(100) // PNG files should be substantial size
      expect(blob.size).toBeLessThan(50000) // But not unreasonably large for test images
      expect(blob.type).toBe('image/png') // MIME type should be preserved
    }

    // Test consistency - multiple conversions should produce same markdown length
    const result2 = await epubToMd(testEpubBlob)
    const markdownContent2 = markdownProcessor.stringify(result2.mdast)
    expect(markdownContent2.length).toBe(markdownContent.length)
    expect(result2.resources.size).toBe(result.resources.size)
  })

  it('should produce quality markdown with proper formatting and structure', async () => {
    const testEpubBlob = await createTestEpub()
    const result = await epubToMd(testEpubBlob)

    // Convert to markdown for validation
    const markdownProcessor = unified()
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '_',
        strong: '*',
        listItemIndent: 'one'
      })

    const markdown = markdownProcessor.stringify(result.mdast)

    // Validate full markdown content with exact structure
    expect(markdown).toBe(EXPECTED_MARKDOWN)

    // Validate resource extraction with exact count
    expect(result.resources.size).toBe(2) // Exactly 2 PNG images

    // Validate total content metrics
    expect(markdown.length).toBe(EXPECTED_MARKDOWN.length) // Exact length match
    expect(markdown.split('\n').length).toBe(EXPECTED_MARKDOWN.split('\n').length) // Exact line count
  })

  it('should handle error conditions and edge cases comprehensively', async () => {
    // Test invalid EPUB blob
    const invalidBlob = new Blob(['not an epub'], { type: 'text/plain' })
    await expect(epubToMd(invalidBlob)).rejects.toThrow()

    // Test malformed EPUB data
    const malformedBlob = new Blob([Buffer.from('PK' + 'x'.repeat(100))], { type: 'application/epub+zip' })
    await expect(epubToMd(malformedBlob)).rejects.toThrow()

    // Test valid EPUB with comprehensive markdown output validation
    const testEpubBlob = await createTestEpub()
    const result = await epubToMd(testEpubBlob)

    // Convert to markdown for validation
    const markdownProcessor = unified()
      .use(remarkStringify, {
        bullet: '-',
        emphasis: '_',
        strong: '*',
        listItemIndent: 'one'
      })

    const markdown = markdownProcessor.stringify(result.mdast)

    // Validate full markdown content matches expected output exactly
    expect(markdown).toBe(EXPECTED_MARKDOWN)
    expect(markdown).not.toContain('undefined') // Should not have undefined values

    // Validate exact structure metrics
    expect(markdown.length).toBe(EXPECTED_MARKDOWN.length)
    expect(markdown.split('\n').length).toBe(EXPECTED_MARKDOWN.split('\n').length)
    expect(markdown.split('# ').length).toBe(3) // Should have exactly 2 headings + initial split
    expect(markdown.split('- ').length).toBe(3) // Should have exactly 2 list items + initial split
    expect(markdown).not.toContain('<!--') // Should not contain HTML comments
    expect(markdown).not.toContain('<?xml') // Should not contain XML processing instructions

    // Verify resources are properly typed
    for (const [path, blob] of result.resources) {
      expect(typeof path).toBe('string')
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.size).toBeGreaterThan(0)
    }
  })
})
