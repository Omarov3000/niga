import { BlobWriter, BlobReader, ZipWriter, ZipReader } from '@zip.js/zip.js'
import { getMimeType } from '../utils/ufile-utils'

export async function archive(files: Record<string, Blob>): Promise<Blob> {
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'))
  
  for (const [path, blob] of Object.entries(files)) {
    await zipWriter.add(path, new BlobReader(blob))
  }
  
  return await zipWriter.close()
}

function getMimeTypeFromFilename(filename: string): string {
  const extension = filename.toLowerCase().match(/\.([^.]+)$/)
  if (!extension) return 'application/octet-stream'
  
  return getMimeType(`.${extension[1]}`)
}

export async function unarchive(zip: Blob): Promise<Record<string, Blob>> {
  const zipReader = new ZipReader(new BlobReader(zip))
  const entries = await zipReader.getEntries()
  const files: Record<string, Blob> = {}
  
  for (const entry of entries) {
    if (!entry.directory && entry.getData) {
      const writer = new BlobWriter()
      const originalBlob = await entry.getData(writer)
      
      // Restore the correct MIME type based on file extension
      const mimeType = getMimeTypeFromFilename(entry.filename)
      const blob = new Blob([originalBlob], { type: mimeType })
      
      files[entry.filename] = blob
    }
  }
  
  await zipReader.close()
  return files
}