/**
 * Extracts the directory path from a file path string
 * Works in browser environments and handles both forward and backslashes
 *
 * @param filePath - The full file path string
 * @returns The directory path without the filename
 *
 * @example
 * getDirPath('path/to/file.ext') // returns 'path/to'
 * getDirPath('path\\to\\file.ext') // returns 'path/to'
 * getDirPath('file.ext') // returns ''
 * getDirPath('/file.ext') // returns '/'
 * getDirPath('') // returns ''
 */
export function getDirPath(filePath: string): string {
  if (!filePath) return ''

  const normalizedPath = filePath.replace(/\\/g, '/') // Normalize slashes to forward slashes

  const lastSlashIndex = normalizedPath.lastIndexOf('/')

  if (lastSlashIndex === -1) return ''
  if (lastSlashIndex === 0) return '/'
  return normalizedPath.slice(0, lastSlashIndex)
}

export function getMimeExtension(mimeType: string) {
  const normalizedMime = mimeType.trim().toLowerCase()

  const ext = mimeToExtMap[mimeType]
  if (ext) return ext

  const parts = normalizedMime.split('/') // Handle unknown MIME types
  if (parts.length === 2) return `.${parts[1]}`

  return '.unknown' // Fallback for completely unknown formats
}

export function getMimeType(extension: string): string {
  const normalizedExt = extension.toLowerCase()
  const extWithDot = normalizedExt.startsWith('.') ? normalizedExt : `.${normalizedExt}`
  
  // Reverse lookup in the existing mimeToExtMap
  for (const [mimeType, ext] of Object.entries(mimeToExtMap)) {
    if (ext === extWithDot) {
      return mimeType
    }
  }
  
  return 'application/octet-stream'
}

const mimeToExtMap: Record<string, string> = {
  // Images
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',

  // Audio
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/midi': '.midi',
  'audio/webm': '.webm',

  // Video
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',

  // Documents
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',

  // Web and EPUB
  'text/html': '.html',
  'application/xhtml+xml': '.xhtml',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/json': '.json',
  'text/plain': '.txt',
  'text/xml': '.xml',
  'application/xml': '.xml',
  'application/oebps-package+xml': '.opf',
  'application/x-dtbncx+xml': '.ncx',

  // Archives
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',

  // Others
  'application/octet-stream': '.bin',
  'text/csv': '.csv',
  'application/x-yaml': '.yaml',
}

