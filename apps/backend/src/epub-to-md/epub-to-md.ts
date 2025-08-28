import { parseEpub } from '../parse-epub/parse-epub'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import remarkStringify from 'remark-stringify'
import { Root } from 'mdast'


export interface EpubMdData {
  mdast: Root
  resources: Map<string, Blob>
}

export async function epubToMd(epubBlob: Blob): Promise<EpubMdData> {
  const data = await parseEpub(epubBlob)
  const { mdast, resources } = await convertContentAndExtractResources(data)
  return { mdast, resources }
}

function cleanHtmlContent(html: string): string {
  let cleaned = html

  // Remove XML processing instructions
  cleaned = cleaned.replace(/<\?xml[^>]*\?>/gi, '')

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--.*?-->/gs, '')

  // Remove DOCTYPE declarations
  cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '')

  // Clean up extra whitespace and empty lines
  cleaned = cleaned.replace(/^\s*\n/gm, '').trim()

  return cleaned
}

async function convertContentAndExtractResources(data: Awaited<ReturnType<typeof parseEpub>>): Promise<EpubMdData> {
  const { spine, manifest, getContent, getFile } = data
  const resources = new Map<string, Blob>()

  let combinedHtml = ''

  for (const spineItem of spine) {
    const manifestItem = manifest[spineItem.id]
    if (!manifestItem || !manifestItem.href.includes('.html')) {
      continue
    }

    const content = await getContent(manifestItem.href)
    if (content) {
      // Clean the HTML content to remove XML processing instructions and unwanted elements
      const cleanedContent = cleanHtmlContent(content)
      combinedHtml += `<div class="chapter" data-spine-id="${spineItem.id}">\n${cleanedContent}\n</div>\n\n`
    }
  }

  let mdast: Root | undefined = undefined

  const processor = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark)
    .use(() => (tree: Root) => {
      // Capture the mdast tree
      mdast = tree
      return tree
    })
    .use(remarkStringify)

  await processor.process(combinedHtml)

  for (const manifestItem of Object.values(manifest)) {
    if (manifestItem.mediaType.startsWith('image/') ||
        manifestItem.mediaType.startsWith('text/css') ||
        manifestItem.mediaType.startsWith('font/')) {
      const file = await getFile(manifestItem.href)
      if (file) {
        resources.set(manifestItem.href, file)
      }
    }
  }

  if (!mdast) {
    throw new Error('No mdast generated')
  }

  return { mdast, resources }
}
