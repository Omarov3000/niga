import { unarchive } from './archive'
import { parseXml } from './xml-parser'
import path from 'path'

export interface EpubMetadata {
  title: string
  author?: string[]
  language: string
  identifier: string
  publisher?: string
  date?: string
  description?: string
  cover?: string
}

export interface TocItem {
  id: string
  label: string
  href: string
  children?: TocItem[]
}

export interface ManifestItem {
  id: string
  href: string
  mediaType: string
}

export interface SpineItem {
  id: string
  linear: boolean
}

export async function parseEpub(epubBlob: Blob): Promise<{
  metadata: EpubMetadata
  toc: TocItem[]
  manifest: Record<string, ManifestItem>
  spine: SpineItem[]
  getContent: (path: string) => Promise<string | undefined>
  getFile: (path: string) => Promise<Blob | undefined>
}> {
  // Unarchive EPUB - all files in memory
  const files = await unarchive(epubBlob)

  // Helper function to convert blob to text
  const blobToText = async (blob: Blob): Promise<string> => {
    return await blob.text()
  }

  // Parse container.xml
  const containerBlob = files['META-INF/container.xml']
  if (!containerBlob) {
    throw new Error('No container.xml found in EPUB')
  }

  const containerXml = await blobToText(containerBlob)
  const opfPath = parseContainer(containerXml)
  const opfDir = path.dirname(opfPath)

  // Parse OPF
  const opfBlob = files[opfPath]
  if (!opfBlob) {
    throw new Error(`OPF file not found: ${opfPath}`)
  }

  const opfXml = await blobToText(opfBlob)
  const { metadata, manifest, spine } = parseOpf(opfXml, opfDir)

  // Create content getter functions
  const getContent = async (contentPath: string): Promise<string | undefined> => {
    // Normalize path by removing leading slash
    const normalizedPath = contentPath.startsWith('/') ? contentPath.slice(1) : contentPath
    const blob = files[normalizedPath]
    return blob ? await blobToText(blob) : undefined
  }

  const getFile = async (filePath: string): Promise<Blob | undefined> => {
    // Normalize path by removing leading slash
    const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath
    return files[normalizedPath]
  }

  // Parse TOC - first try nav.xhtml
  let toc: TocItem[] = []
  const navFile = Object.values(manifest).find(item =>
    item.mediaType === 'application/xhtml+xml' &&
    (item.href.includes('nav.xhtml') || item.href.includes('toc.xhtml'))
  )

  if (navFile) {
    const navBlob = files[navFile.href]
    if (navBlob) {
      const navXml = await blobToText(navBlob)
      toc = parseNavDocument(navXml, path.dirname(navFile.href))
    }
  }

  // If still no TOC, generate from spine
  if (toc.length === 0) {
    toc = await generateTocFromSpine(spine, manifest, getContent)
  }

  return {
    metadata,
    toc,
    manifest,
    spine,
    getContent,
    getFile
  }
}

function parseContainer(xmlString: string): string {
  const container = parseXml(xmlString)
  const rootfile = container?.container?.rootfiles?.rootfile

  if (!rootfile) {
    throw new Error('No rootfile found in container.xml')
  }

  const rootfileData = Array.isArray(rootfile) ? rootfile[0] : rootfile
  return rootfileData['@_full-path'] || rootfileData['@_fullPath']
}

function parseOpf(xmlString: string, opfDir: string): {
  metadata: EpubMetadata
  manifest: Record<string, ManifestItem>
  spine: SpineItem[]
} {
  const opf = parseXml(xmlString)
  const packageData = opf.package || opf.opf

  if (!packageData) {
    throw new Error('Invalid OPF structure')
  }

  // Parse metadata
  const meta = packageData.metadata || {}

  const metadata: EpubMetadata = {
    title: meta['title'] || meta['dc:title'] || 'Untitled',
    language: meta['language'] || meta['dc:language'] || 'en',
    identifier: typeof meta['identifier'] === 'string' ? meta['identifier'] :
                (meta['identifier']?.['#text'] || meta['dc:identifier'] || 'unknown'),
  }

  const creator = meta['creator'] || meta['dc:creator']
  if (creator !== undefined && creator !== null) {
    metadata.author = Array.isArray(creator)
      ? creator.map((c: any) => typeof c === 'string' ? c : c['#text'])
      : [typeof creator === 'string' ? creator : creator['#text']]
  }

  if (meta['publisher'] || meta['dc:publisher']) {
    metadata.publisher = meta['publisher'] || meta['dc:publisher']
  }

  if (meta['date'] || meta['dc:date']) {
    metadata.date = meta['date'] || meta['dc:date']
  }

  if (meta['description'] || meta['dc:description']) {
    metadata.description = meta['description'] || meta['dc:description']
  }

  // Parse manifest
  const manifest: Record<string, ManifestItem> = {}

  if (packageData.manifest?.item) {
    const items = Array.isArray(packageData.manifest.item)
      ? packageData.manifest.item
      : [packageData.manifest.item]

    for (const item of items) {
      const id = item['@_id']
      const href = item['@_href']
      const mediaType = item['@_media-type'] || item['@_mediaType']

      manifest[id] = {
        id,
        href: path.join(opfDir, href),
        mediaType
      }

      // Find cover image
      if (item['@_properties']?.includes('cover-image') || id === 'cover-image') {
        metadata.cover = path.join(opfDir, href)
      }
    }
  }

  // Parse spine
  const spine: SpineItem[] = []
  if (packageData.spine?.itemref) {
    const items = Array.isArray(packageData.spine.itemref)
      ? packageData.spine.itemref
      : [packageData.spine.itemref]

    for (const item of items) {
      spine.push({
        id: item['@_idref'],
        linear: item['@_linear'] !== 'no'
      })
    }
  }

  return { metadata, manifest, spine }
}

function parseNavDocument(htmlString: string, navDir: string): TocItem[] {
  // Simple HTML parsing for nav documents
  const navRegex = /<nav[^>]*epub:type=["']toc["'][^>]*>(.*?)<\/nav>/s
  const match = htmlString.match(navRegex)

  if (!match) {
    return []
  }

  const navContent = match[1]
  const olRegex = /<ol[^>]*>(.*?)<\/ol>/s
  const olMatch = navContent.match(olRegex)

  if (!olMatch) {
    return []
  }

  const listItems = olMatch[1].match(/<li[^>]*>.*?<\/li>/gs) || []

  return listItems.map((li, index) => {
    const linkMatch = li.match(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/)
    const href = linkMatch ? path.join(navDir, linkMatch[1]) : ''
    const label = linkMatch ? linkMatch[2].replace(/<[^>]*>/g, '').trim() : `Chapter ${index + 1}`

    return {
      id: `chapter-${index + 1}`,
      label,
      href
    }
  })
}

async function generateTocFromSpine(
  spine: SpineItem[],
  manifest: Record<string, ManifestItem>,
  getContentFn: (path: string) => Promise<string | undefined>
): Promise<TocItem[]> {
  const toc: TocItem[] = []

  for (let i = 0; i < spine.length; i++) {
    const spineItem = spine[i]
    const manifestItem = manifest[spineItem.id]

    if (!manifestItem || !manifestItem.href.includes('.html')) {
      continue
    }

    let title = `Chapter ${i + 1}`

    // Try to extract title from HTML content
    try {
      const content = await getContentFn(manifestItem.href)
      if (content) {
        const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i) ||
                          content.match(/<h1[^>]*>(.*?)<\/h1>/i) ||
                          content.match(/<h2[^>]*>(.*?)<\/h2>/i)

        if (titleMatch) {
          title = titleMatch[1].replace(/<[^>]*>/g, '').trim()
        }
      }
    } catch (error) {
      // Use default title if extraction fails
    }

    toc.push({
      id: spineItem.id,
      label: title,
      href: manifestItem.href
    })
  }

  return toc
}
