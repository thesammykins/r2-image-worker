// Worker for uploading images/videos to R2 and serving them via /images/:key or /videos/:key paths.
// Returns full URLs on upload. Requires a shared secret key for uploads.
import { Hono } from 'hono/quick'
import type { Context, Next } from 'hono' // Import Context and Next types
import { cache } from 'hono/cache'
import { sha256 } from 'hono/utils/crypto'
import { getExtension } from 'hono/utils/mime'

type Bindings = {
  BUCKET: R2Bucket
  AUTH_KEY: string // Changed from USER/PASS to a single AUTH_KEY
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
  const originalFilename = data.filename || data.file.name;
  if (!originalFilename) {
      return c.text('Missing filename', 400);
  }

  const timestamp = Date.now();

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

  const key = `${timestamp}_${originalFilename}`;
  const r2Key = `${prefix}/${key}`; 

  // --- Add this log ---
  console.log(`Received url_preference: '${data.url_preference}'`);
  // -------------------

  try {
      const buffer = await body.arrayBuffer()
      await c.env.BUCKET.put(r2Key, buffer, { httpMetadata: { contentType: mimeType } })
  } catch (e) {
    if (e instanceof Error) {
      return c.text(`Failed to upload to R2: ${e.message}`, 500)
    }
    return c.text('Failed to upload to R2 due to an unknown error', 500)
  }

  // --- Construct the URL to return based on preference ---
  const requestUrl = new URL(c.req.url)
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`
  const directUrl = `${baseUrl}/${r2Key}`; // The standard direct URL
  let finalUrl: string;

  // Read the preference from the form data, default to 'Original URL' if missing
  const urlPreference = data.url_preference || 'Original URL'; 

  if (isImage && urlPreference === 'Preview-Optimized URL') {
    // Construct Cloudflare Image Transformation URL only if image AND preference matches
    const transformationParams = 'fit=contain,width=1200,format=auto';
    finalUrl = `${baseUrl}/cdn-cgi/image/${transformationParams}/${directUrl}`;
    console.log(`Returning transformed image URL based on preference: ${finalUrl}`);
  } else {
    // Default to direct URL for non-images, or if preference is 'Original URL' or missing
    finalUrl = directUrl;
    console.log(`Returning direct file URL (default or preference): ${finalUrl}`);
  }
  // --- End URL Construction ---

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

// Handle serving the files from /images/:key or /videos/:key
app.get('/:type/:key', async (c: Context<{ Bindings: Bindings }>) => {
  const type = c.req.param('type')
  const key = c.req.param('key')

  // Only allow 'images' or 'videos' as the type prefix
  if (type !== 'images' && type !== 'videos') {
    return c.notFound()
  }

  const r2Key = `${type}/${key}` // Reconstruct the key used for storage

  const object = await c.env.BUCKET.get(r2Key)
  if (!object) {
    return c.notFound() // Object not found in R2
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  // Convert Headers object to HeaderRecord (Record<string, string | string[]>) for c.body
  const headerRecord: Record<string, string> = {}
  headers.forEach((value, key) => {
    headerRecord[key] = value
  })

  return c.body(object.body, 200, headerRecord) // Use the converted record
})

export default app
