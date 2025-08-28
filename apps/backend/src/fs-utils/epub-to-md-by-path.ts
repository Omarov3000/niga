import { unified } from 'unified'
import remarkStringify from 'remark-stringify'
import { readFile, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { epubToMd } from '../epub-to-md/epub-to-md'

export async function epubToMdByPath(epubPath: string, outputDir?: string): Promise<void> {
  const fileData = await readFile(epubPath)
  const epubBlob = new Blob([fileData])
  const { mdast, resources } = await epubToMd(epubBlob)

  const epubName = path.basename(epubPath, '.epub')
  const baseOutputDir = outputDir || 'output'
  const fullOutputDir = path.join(baseOutputDir, epubName, 'md')

  if (!existsSync(fullOutputDir)) {
    await mkdir(fullOutputDir, { recursive: true })
  }

  const resourcesDir = path.join(fullOutputDir, 'resources')
  if (!existsSync(resourcesDir)) {
    await mkdir(resourcesDir, { recursive: true })
  }

  for (const [resourcePath, blob] of resources) {
    const resourceName = path.basename(resourcePath)
    const resourceFilePath = path.join(resourcesDir, resourceName)
    const arrayBuffer = await blob.arrayBuffer()
    await writeFile(resourceFilePath, new Uint8Array(arrayBuffer))
  }

  // Convert mdast to markdown string
  const markdownProcessor = unified()
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '_',
      strong: '*',
      listItemIndent: 'one'
    })

  const markdownFile = markdownProcessor.stringify(mdast)
  const mdFilePath = path.join(fullOutputDir, `${epubName}.md`)
  await writeFile(mdFilePath, markdownFile)

  console.log(`Converted ${epubPath} to ${fullOutputDir}`)
}
