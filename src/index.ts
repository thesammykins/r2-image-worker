// Worker for uploading images/videos to R2 and serving them via /images/:key or /videos/:key paths.
// Returns full URLs on upload. Requires a shared secret key for uploads.
// Changes:
// - Added duplicate file detection using SHA-256 hashing
// - Modified file naming to preserve original names with UUID suffix
// - Added metadata storage for file tracking
import { Hono } from 'hono/quick'
import type { Context, Next } from 'hono' // Import Context and Next types
import { cache } from 'hono/cache'
import { sha256 } from 'hono/utils/crypto'
import { getExtension } from 'hono/utils/mime'
import { nanoid } from 'nanoid' // Import nanoid

type Bindings = {
  BUCKET: R2Bucket
  AUTH_KEY: string // Changed from USER/PASS to a single AUTH_KEY
  IMAGE_HOSTNAME?: string
  FILES_HOSTNAME?: string
  UPLOAD_HOSTNAME?: string // Optional: might be useful elsewhere
}

// Metadata interface for R2 objects
interface FileMetadata {
  originalHash: string
  originalFilename: string
  uploadTimestamp: number
  mimeType: string
}

const maxAge = 60 * 60 * 24 * 30 // 30 days

// Helper function to sanitize filenames
function sanitizeFilename(name: string): string {
  // Remove path components (just keep the filename part)
  const baseName = name.substring(name.lastIndexOf('/') + 1);
  // Replace spaces with underscores, remove characters unsafe for URLs/R2 keys
  // Allow letters, numbers, underscore, hyphen, period.
  const sanitized = baseName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
  // Prevent excessively long names (optional)
  return sanitized.substring(0, 100); // Limit length
}

// Helper function to generate final filename with nanoid
function generateUniqueFilename(originalFilename: string): string {
  const sanitized = sanitizeFilename(originalFilename)
  // Try to get extension from sanitized name first
  const extMatch = sanitized.match(/\.([^.]+)$/);
  let extension = extMatch ? extMatch[0] : '' // Includes the dot
  let basename = extension ? sanitized.substring(0, sanitized.lastIndexOf(extension)) : sanitized;
  
  // If no extension found in sanitized name, try mime utils (less reliable for filenames)
  if (!extension) {
      const mimeExt = getExtension(basename) // Use getExtension on the base if needed
      if(mimeExt) extension = `.${mimeExt}`;
  }
  
  // Ensure basename doesn't end with a dot if we couldn't find extension
  if (basename.endsWith('.') && !extension) {
      basename = basename.slice(0, -1);
  }

  // Use nanoid() for a shorter ID (default length 21 chars)
  return `${basename}_${nanoid()}${extension}`;
}

// Helper function to find duplicate file by hash
async function findDuplicateFile(bucket: R2Bucket, fileHash: string, prefix: string): Promise<{ key: string } | null> {
  const options = {
    prefix: prefix,
    limit: 1000
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

// Define the app with explicit Bindings type for context
const app = new Hono<{ Bindings: Bindings }>()

// Middleware to check for the shared secret key on /upload
app.put('/upload', async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const providedKey = c.req.header('X-Auth-Key') // Or use 'Authorization: Bearer <key>'
  const expectedKey = c.env.AUTH_KEY

  if (!providedKey || providedKey !== expectedKey) {
    return c.text('Unauthorized', 401)
  }

  await next()
})

// Handle the file upload
app.put('/upload', async (c: Context<{ Bindings: Bindings }>) => {
  // Expect file, filename, and the new optional preference
  const data = await c.req.parseBody<{ file?: File, filename?: string, url_preference?: string }>()

  if (!data?.file) {
    return c.text('Missing "file" in form data', 400)
  }

  const body = data.file
  const mimeType = data.file.type
  const providedFilename = typeof data.filename === 'string' ? data.filename : ''
  const fileName = typeof data.file.name === 'string' ? data.file.name : ''
  const originalFilename = providedFilename || fileName || 'untitled'

  // Calculate file hash
  const buffer = await body.arrayBuffer()
  const fileHashNullable = await sha256(new Uint8Array(buffer))

  if (!fileHashNullable) {
    return c.text('Failed to calculate file hash', 500)
  }
  const fileHash = fileHashNullable

  // Determine prefix and if it's an image
  let prefix: string;
  let isImage = false;
  if (mimeType.startsWith('image/')) {
    prefix = 'images';
    isImage = true;
  } else if (mimeType.startsWith('video/')) {
    prefix = 'videos';
  } else {
    prefix = 'files';
  }

  // --- Determine Base URL for the *returned* URL using ENV vars --- 
  const requestUrl = new URL(c.req.url) // Still needed for protocol
  const protocol = requestUrl.protocol;
  // Read hostnames from environment, provide sensible defaults
  const imageHost = c.env.IMAGE_HOSTNAME || 'images.localhost'; // Default fallback
  const filesHost = c.env.FILES_HOSTNAME || 'files.localhost'; // Default fallback
  const targetHost = isImage ? imageHost : filesHost;
  const baseUrl = `${protocol}//${targetHost}`;
  // ---------------------------------------------------------------

  // Check for duplicate file
  const duplicate = await findDuplicateFile(c.env.BUCKET, fileHash, prefix)
  if (duplicate?.key) {
    const directUrl = `${baseUrl}/${duplicate.key}`;

    if (isImage && data.url_preference === 'Preview-Optimized URL') {
      const transformationParams = 'fit=contain,width=1200,format=auto';
      // Base the transformation source URL on the configured IMAGE_HOSTNAME
      const imageServeHost = `${protocol}//${imageHost}`;
      const sourceImageUrl = `${imageServeHost}/${duplicate.key}`;
      const transformBaseUrl = imageServeHost; // Assume transformations served from same base
      return c.text(`${transformBaseUrl}/cdn-cgi/image/${transformationParams}/${sourceImageUrl}`, 200);
    }
    // Return direct URL (with IMAGE_HOSTNAME or FILES_HOSTNAME)
    return c.text(directUrl, 200);
  }

  // Generate unique filename with nanoid
  const uniqueFilename = generateUniqueFilename(originalFilename)
  const r2Key = `${prefix}/${uniqueFilename}`

  // Prepare metadata
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
      return c.text(`Failed to upload to R2: ${e.message}`, 500)
    }
    return c.text('Failed to upload to R2 due to an unknown error', 500)
  }

  // Construct the final URL using the determined baseUrl
  const directUrl = `${baseUrl}/${r2Key}`;
  let finalUrl: string;

  const urlPreference = data.url_preference || 'Original URL'; 

  if (isImage && urlPreference === 'Preview-Optimized URL') {
    const transformationParams = 'fit=contain,width=1200,format=auto';
    // Base the transformation source URL on the configured IMAGE_HOSTNAME
    const imageServeHost = `${protocol}//${imageHost}`;
    const sourceImageUrl = `${imageServeHost}/${r2Key}`;
    const transformBaseUrl = imageServeHost; // Assume transformations served from same base
    finalUrl = `${transformBaseUrl}/cdn-cgi/image/${transformationParams}/${sourceImageUrl}`;
    console.log(`Returning transformed image URL: ${finalUrl}`);
  } else {
    finalUrl = directUrl;
    console.log(`Returning direct file URL (${isImage ? 'image' : 'non-image'}): ${finalUrl}`);
  }

  return c.text(finalUrl, 200)
})

// Apply caching middleware to GET requests
app.get(
  '*',
  cache({
    cacheName: 'r2-media-worker', // Updated cache name
    cacheControl: `public, max-age=${maxAge}` // Define cache control directly here
  })
)

// --- Updated GET Handler ---
// Handles serving files from /images/:key, /videos/:key, or /files/:key
app.get('/:type(images|videos|files)/:key', async (c: Context<{ Bindings: Bindings }>) => {
  const type = c.req.param('type'); // Type is guaranteed by regex
  const key = c.req.param('key');  // Key is guaranteed by regex

  const r2Key = `${type}/${key}`; 

  const object = await c.env.BUCKET.get(r2Key)
  if (!object) {
    return c.notFound() 
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  const headerRecord: Record<string, string> = {}
  headers.forEach((value, key) => { headerRecord[key] = value })

  return c.body(object.body, 200, headerRecord)
})

export default app
