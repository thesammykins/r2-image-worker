import { getExtension } from 'hono/utils/mime'
import { nanoid } from 'nanoid'
import { MAX_FILENAME_LENGTH } from '../config'

export function sanitizeFilename(name: string): string {
  const baseName = name.substring(name.lastIndexOf('/') + 1)
  const sanitized = baseName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '')
  return sanitized.substring(0, MAX_FILENAME_LENGTH)
}

export function generateUniqueFilename(originalFilename: string): string {
  const sanitized = sanitizeFilename(originalFilename)
  const extMatch = sanitized.match(/\.([^.]+)$/)
  let extension = extMatch ? extMatch[0] : ''
  let basename = extension ? sanitized.substring(0, sanitized.lastIndexOf(extension)) : sanitized
  
  if (!extension) {
    const mimeExt = getExtension(basename)
    if (mimeExt) extension = `.${mimeExt}`
  }
  
  if (basename.endsWith('.') && !extension) {
    basename = basename.slice(0, -1)
  }

  return `${basename}_${nanoid()}${extension}`
}
