import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, basename, dirname } from 'path'
import { parseEpub } from './parse-epub'

export async function parseLocalEpub(epubPath: string): Promise<void> {
  // Read EPUB file
  const fileData = await readFile(epubPath)
  const epubBlob = new Blob([fileData])

  // Parse EPUB
  const { metadata, toc, manifest, spine, getFile } = await parseEpub(epubBlob)

  // Create output directory
  const epubName = basename(epubPath, '.epub')
  const outputDir = join('output', epubName, 'epub')
  await mkdir(outputDir, { recursive: true })

  // Save metadata
  await writeFile(
    join(outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  )

  // Save TOC
  await writeFile(
    join(outputDir, 'toc.json'),
    JSON.stringify(toc, null, 2)
  )

  // Save manifest
  await writeFile(
    join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )

  // Save spine
  await writeFile(
    join(outputDir, 'spine.json'),
    JSON.stringify(spine, null, 2)
  )

  // Extract all files
  for (const [id, item] of Object.entries(manifest)) {
    const file = await getFile(item.href)
    if (file) {
      const filePath = join(outputDir, item.href)
      const fileDir = dirname(filePath)
      await mkdir(fileDir, { recursive: true })

      const arrayBuffer = await file.arrayBuffer()
      await writeFile(filePath, Buffer.from(arrayBuffer))
    }
  }

  console.log(`EPUB parsed and extracted to: ${outputDir}`)
}
