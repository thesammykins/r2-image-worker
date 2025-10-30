import type { Context } from 'hono'
import { z } from 'zod'
import type { Bindings, FileMetadata, UploadFormData } from './types'
import { ValidationError, R2OperationError } from '../errors/AppError'
import { sha256Hash } from '../utils/hashing'
import { generateUniqueFilename } from '../utils/filename'
import { buildBaseUrl, buildDirectUrl, buildTransformedUrl } from '../utils/urls'
import { logUpload } from '../utils/logger'
import { R2_LIST_LIMIT } from '../config'

const uploadFormSchema = z.object({
  file: z.instanceof(File, { message: 'Missing "file" in form data' }),
  filename: z.string().optional(),
  url_preference: z.enum(['Original URL', 'Preview-Optimized URL']).optional()
})

async function findDuplicateFile(bucket: R2Bucket, fileHash: string, prefix: string): Promise<{ key: string } | null> {
  const options = {
    prefix: prefix,
    limit: R2_LIST_LIMIT
  }
  
  let cursor: string | undefined
  
  do {
    const listed = await bucket.list({ ...options, cursor: cursor })
    
    for (const object of listed.objects) {
      const key = object.key
      if (typeof key !== 'string') continue
      const metadata = await bucket.head(key)
      if (metadata?.customMetadata?.originalHash === fileHash) {
        return { key }
      }
    }
    
    const listResult = listed as { cursor?: string }
    cursor = listResult.cursor
  } while (cursor)
  
  return null
}

export async function handleUpload(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const data = await c.req.parseBody<UploadFormData>()

  if (!data?.file) {
    const error = new ValidationError('Missing "file" in form data')
    return c.text(error.message, error.statusCode)
  }

  const validationResult = uploadFormSchema.safeParse(data)
  if (!validationResult.success) {
    const firstError = validationResult.error?.errors?.[0]
    const errorMessage = firstError?.message || 'Invalid form data'
    const error = new ValidationError(errorMessage)
    return c.text(error.message, error.statusCode)
  }

  const { file: body, filename: providedFilename, url_preference } = validationResult.data
  const mimeType = body.type
  const fileName = typeof body.name === 'string' ? body.name : ''
  const originalFilename = providedFilename || fileName || 'untitled'

  const buffer = await body.arrayBuffer()
  const fileHash = await sha256Hash(new Uint8Array(buffer))

  let prefix: string
  let isImage = false
  if (mimeType.startsWith('image/')) {
    prefix = 'images'
    isImage = true
  } else if (mimeType.startsWith('video/')) {
    prefix = 'videos'
  } else {
    prefix = 'files'
  }

  const requestUrl = new URL(c.req.url)
  const protocol = requestUrl.protocol
  const baseUrl = buildBaseUrl(protocol, isImage, c.env)

  const duplicate = await findDuplicateFile(c.env.BUCKET, fileHash, prefix)
  if (duplicate?.key) {
    const directUrl = buildDirectUrl(baseUrl, duplicate.key)

    if (isImage && url_preference === 'Preview-Optimized URL') {
      const transformationParams = 'fit=contain,width=1200,format=auto'
      const imageServeHost = `${protocol}//${c.env.IMAGE_HOSTNAME || 'images.localhost'}`
      const transformedUrl = buildTransformedUrl(imageServeHost, duplicate.key, transformationParams)
      logUpload(duplicate.key, true, 'transformed image URL')
      return c.text(transformedUrl, 200)
    }
    
    logUpload(duplicate.key, true, `direct file URL (${isImage ? 'image' : 'non-image'})`)
    return c.text(directUrl, 200)
  }

  const uniqueFilename = generateUniqueFilename(originalFilename)
  const r2Key = `${prefix}/${uniqueFilename}`

  const metadata: FileMetadata = {
    originalHash: fileHash,
    originalFilename: originalFilename,
    uploadTimestamp: Date.now(),
    mimeType: mimeType
  }

  try {
    await c.env.BUCKET.put(r2Key, buffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: Object.entries(metadata).reduce((acc, [key, value]) => {
        acc[key] = String(value)
        return acc
      }, {} as Record<string, string>)
    })
  } catch (e) {
    if (e instanceof Error) {
      const error = new R2OperationError(`Failed to upload to R2: ${e.message}`)
      return c.text(error.message, error.statusCode)
    }
    const error = new R2OperationError('Failed to upload to R2 due to an unknown error')
    return c.text(error.message, error.statusCode)
  }

  const directUrl = buildDirectUrl(baseUrl, r2Key)
  const urlPreference = url_preference || 'Original URL'

  if (isImage && urlPreference === 'Preview-Optimized URL') {
    const transformationParams = 'fit=contain,width=1200,format=auto'
    const imageServeHost = `${protocol}//${c.env.IMAGE_HOSTNAME || 'images.localhost'}`
    const finalUrl = buildTransformedUrl(imageServeHost, r2Key, transformationParams)
    logUpload(r2Key, false, 'transformed image URL')
    return c.text(finalUrl, 200)
  }

  logUpload(r2Key, false, `direct file URL (${isImage ? 'image' : 'non-image'})`)
  return c.text(directUrl, 200)
}
