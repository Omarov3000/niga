import { test, expect } from 'vitest'
import { parseEpub } from './parse-epub'
import { archive } from './archive'
import { makeBlackSquare32, makeBlueSquare50 } from '../test-utils/make-test-file'

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
    <dc:publisher>Test Publisher</dc:publisher>
    <dc:date>2024-01-01</dc:date>
    <dc:description>A test book for parsing</dc:description>
  </metadata>
  
  <manifest>
    <item id="chapter1" href="chapter1.html" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.html" media-type="application/xhtml+xml"/>
    <item id="chapter3" href="chapter3.html" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="image1" href="test-image.png" media-type="image/png"/>
  </manifest>
  
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="chapter3"/>
  </spine>
</package>`], { type: 'application/xml' })

  // Chapter 1
  files['OEBPS/chapter1.html'] = new Blob([`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapter One: The Beginning</title>
</head>
<body>
  <h1>Chapter One: The Beginning</h1>
  <p>This is the first chapter of our test book.</p>
  <img src="test-image.png" alt="Test Image"/>
</body>
</html>`], { type: 'application/xhtml+xml' })

  // Chapter 2
  files['OEBPS/chapter2.html'] = new Blob([`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapter Two: The Middle</title>
</head>
<body>
  <h1>Chapter Two: The Middle</h1>
  <p>This is the second chapter with more content.</p>
</body>
</html>`], { type: 'application/xhtml+xml' })

  // Chapter 3
  files['OEBPS/chapter3.html'] = new Blob([`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapter Three: The End</title>
</head>
<body>
  <h1>Chapter Three: The End</h1>
  <p>This is the final chapter of our test book.</p>
</body>
</html>`], { type: 'application/xhtml+xml' })

  // Images using test utilities
  const coverImage = makeBlackSquare32()
  const testImage = makeBlueSquare50()
  
  files['OEBPS/cover.png'] = coverImage.blob()
  files['OEBPS/test-image.png'] = testImage.blob()

  return await archive(files)
}

test('EPUB parser should parse metadata correctly', async () => {
  const testEpub = await createTestEpub()
  const result = await parseEpub(testEpub)
  
  expect(result.metadata).toMatchObject({
    title: 'Test Book Title',
    author: ['Test Author'],
    language: 'en',
    identifier: 'test-book-123',
    publisher: 'Test Publisher',
    date: '2024-01-01',
    description: 'A test book for parsing',
    cover: 'OEBPS/cover.png'
  })
})

test('EPUB parser should parse manifest correctly', async () => {
  const testEpub = await createTestEpub()
  const result = await parseEpub(testEpub)
  
  const expectedManifestIds = ['chapter1', 'chapter2', 'chapter3', 'cover-image', 'image1']
  const actualManifestIds = Object.keys(result.manifest)
  
  expectedManifestIds.forEach(expectedId => {
    expect(actualManifestIds).toContain(expectedId)
  })
  
  expect(result.manifest).toMatchObject({
    chapter1: {
      href: 'OEBPS/chapter1.html',
      mediaType: 'application/xhtml+xml'
    },
    'cover-image': {
      href: 'OEBPS/cover.png',
      mediaType: 'image/png'
    }
  })
})

test('EPUB parser should parse spine correctly', async () => {
  const testEpub = await createTestEpub()
  const result = await parseEpub(testEpub)
  
  expect(result.spine).toHaveLength(3)
  
  const expectedSpineIds = ['chapter1', 'chapter2', 'chapter3']
  expectedSpineIds.forEach((expectedId, i) => {
    expect(result.spine[i].id).toBe(expectedId)
    expect(result.spine[i].linear).toBe(true)
  })
})

test('EPUB parser should generate TOC from spine', async () => {
  const testEpub = await createTestEpub()
  const result = await parseEpub(testEpub)
  
  expect(result.toc).toHaveLength(3)
  
  expect(result.toc).toMatchObject([
    {
      label: 'Chapter One: The Beginning',
      href: 'OEBPS/chapter1.html',
      id: 'chapter1'
    },
    {
      label: 'Chapter Two: The Middle',
      href: 'OEBPS/chapter2.html',
      id: 'chapter2'
    },
    {
      label: 'Chapter Three: The End',
      href: 'OEBPS/chapter3.html',
      id: 'chapter3'
    }
  ])
})

test('EPUB parser should retrieve content correctly', async () => {
  const testEpub = await createTestEpub()
  const result = await parseEpub(testEpub)
  
  const chapter1Content = await result.getContent('OEBPS/chapter1.html')
  expect(chapter1Content).toContain('Chapter One: The Beginning')
  expect(chapter1Content).toContain('This is the first chapter of our test book.')
  
  const chapter2Content = await result.getContent('OEBPS/chapter2.html')
  expect(chapter2Content).toContain('Chapter Two: The Middle')
  
  const nonExistentContent = await result.getContent('OEBPS/missing.html')
  expect(nonExistentContent).toBeUndefined()
})

test('EPUB parser should retrieve files correctly', async () => {
  const testEpub = await createTestEpub()
  const result = await parseEpub(testEpub)
  
  const coverFile = await result.getFile('OEBPS/cover.png')
  expect(coverFile).toMatchObject({
    size: expect.any(Number)
  })
  expect(coverFile!.size).toBeGreaterThan(0)
  
  const testImageFile = await result.getFile('OEBPS/test-image.png')
  expect(testImageFile).toMatchObject({
    size: expect.any(Number)
  })
  expect(testImageFile!.size).toBeGreaterThan(0)
  
  const nonExistentFile = await result.getFile('OEBPS/missing.html')
  expect(nonExistentFile).toBeUndefined()
})