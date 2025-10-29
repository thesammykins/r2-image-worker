// Worker for uploading images/videos to R2 and serving them via /images/:key or /videos/:key paths.
// Returns full URLs on upload. Requires a shared secret key for uploads.
// Changes:
// - Added duplicate file detection using SHA-256 hashing
// - Modified file naming to preserve original names with UUID suffix
// - Added metadata storage for file tracking
import { Hono } from 'hono/quick'
import type { Context, Next } from 'hono' // Import Context and Next types
import { cache } from 'hono/cache'
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

const ONE_YEAR_IN_SECONDS = 31536000;

// Helper function to validate cache-control headers
function getValidCacheControl(header: string | undefined): string {
	const defaultCacheControl = `public, max-age=${ONE_YEAR_IN_SECONDS}`;
	if (!header) {
		return defaultCacheControl;
	}
	// A whitelist of allowed directives (case-insensitive)
	const allowedDirectives = new Set([
		'public',
		'private',
		'no-cache',
		'no-store',
		'must-revalidate',
		'proxy-revalidate',
		'immutable',
		'no-transform',
		's-maxage',
		'max-age',
		'max-stale',
		'min-fresh',
		'stale-while-revalidate',
		'stale-if-error',
	]);

	// Split header into directives, trim, and validate each
	const directives = header.split(',').map(d => d.trim());
	for (const directive of directives) {
		// Check for key[=value] format
		const [key, value] = directive.split('=', 2);
		const lowerKey = key.toLowerCase();

		if (!allowedDirectives.has(lowerKey)) {
			return defaultCacheControl;
		}

		// If directive expects a value, check that value is a non-negative integer
		if (['max-age', 's-maxage', 'max-stale', 'min-fresh', 'stale-while-revalidate', 'stale-if-error'].includes(lowerKey)) {
			if (typeof value === 'undefined' || !/^\d+$/.test(value)) {
				return defaultCacheControl;
			}
		} else {
			// If value is present for a directive that shouldn't have one, reject
			if (typeof value !== 'undefined') {
				return defaultCacheControl;
			}
		}
	}

	return header;
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
  const data = await c.req.parseBody<{ file?: File, filename?: string, url_preference?: string, cache_control?: string }>()

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
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const fileHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

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
  const cacheControl = getValidCacheControl(data.cache_control)
  try {
    await c.env.BUCKET.put(r2Key, buffer, {
      httpMetadata: { contentType: mimeType, cacheControl: cacheControl },
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


// --- Updated GET Handler ---
// Handles serving files from /images/:key, /videos/:key, or /files/:key
app.get('/:type(images|videos|files)/:key', async (c: Context<{ Bindings: Bindings }>) => {
	const type = c.req.param('type'); // Type is guaranteed by regex
	const key = c.req.param('key');  // Key is guaranteed by regex
	const r2Key = `${type}/${key}`;

	const cache = caches.default;
	const cachedResponse = await cache.match(c.req.url);
	if (cachedResponse) {
		return cachedResponse;
	}

	const object = await c.env.BUCKET.get(r2Key);
	if (!object) {
		return c.notFound();
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);

	const response = new Response(object.body, {
		headers: headers,
		status: 200
	});

	const cacheControl = headers.get('cache-control');
	const shouldCache = cacheControl && !/(private|no-store|no-cache|max-age=0)/.test(cacheControl);

	if (shouldCache) {
		c.executionCtx.waitUntil(cache.put(c.req.url, response.clone()));
	}

	return response;
})

export default app
