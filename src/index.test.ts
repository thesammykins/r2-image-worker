// Tests for the R2 Image Worker using @cloudflare/vitest-pool-workers
import { env, SELF } from 'cloudflare:test'; // Import test helpers
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';

// Define the expected shape of the environment bindings for tests
interface TestBindings {
    BUCKET: R2Bucket;
    AUTH_KEY: string;
    // Expect hostname variables from wrangler.toml
    IMAGE_HOSTNAME: string;
    FILES_HOSTNAME: string;
    UPLOAD_HOSTNAME: string;
}

// Cast the imported env to our specific type
const testEnv = env as TestBindings;
// We still expect the AUTH_KEY value specifically
const EXPECTED_AUTH_KEY = 'test-secret-key-12345'; 

// --- Read Test Hostnames from Environment --- 
// Tests will now expect the hostnames defined in wrangler.toml
// or overridden by a specific test environment if configured.
const TEST_PROTOCOL = 'http'; // Keep using http for test simplicity
const TEST_UPLOAD_HOST = testEnv.UPLOAD_HOSTNAME; 
const TEST_IMAGES_HOST = testEnv.IMAGE_HOSTNAME;
const TEST_FILES_HOST = testEnv.FILES_HOSTNAME;
const UPLOAD_URL_BASE = `${TEST_PROTOCOL}://${TEST_UPLOAD_HOST}`;
// -------------------------------------------

// Helper to create a test file
function createTestFile(name: string, type: string, content: string): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

// Helper to clear the R2 bucket used in tests
async function clearTestBucket() {
    const bucket = testEnv.BUCKET;
    const listed = await bucket.list();
    const keysToDelete = listed.objects.map(obj => obj.key);
    if (keysToDelete.length > 0) {
        await bucket.delete(keysToDelete);
        console.log(`Cleared ${keysToDelete.length} objects from test bucket.`);
    }
}

// Helper function to calculate SHA-256 hash (mimics worker internal)
async function calculateSha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('R2 Image Worker Tests (vitest-pool-workers)', () => {

  beforeEach(async () => { 
      await clearTestBucket();
      // Check if hostnames are defined
      if (!TEST_UPLOAD_HOST || !TEST_IMAGES_HOST || !TEST_FILES_HOST) {
          throw new Error('Required hostname environment variables (UPLOAD_HOSTNAME, IMAGE_HOSTNAME, FILES_HOSTNAME) are not defined in the test environment (check wrangler.toml)');
      }
  });

  afterAll(async () => {
    // Optional: final cleanup after all tests
    await clearTestBucket();
  });

  // --- Authorization Tests ---
  it('AUTH: should return 401 Unauthorized for /upload without key', async () => {
    const formData = new FormData();
    formData.append('file', createTestFile('test.jpg', 'image/jpeg', 'dummy image data'));

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, {
      method: 'PUT',
      body: formData,
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Unauthorized');
  });

  it('AUTH: should return 401 Unauthorized for /upload with incorrect key', async () => {
    const formData = new FormData();
    formData.append('file', createTestFile('test.jpg', 'image/jpeg', 'dummy image data'));

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, {
      method: 'PUT',
      headers: { 'X-Auth-Key': 'wrong-key' },
      body: formData,
    });

    expect(res.status).toBe(401);
  });

  it('AUTH: should succeed with correct key from env', async () => {
    const formData = new FormData();
    formData.append('file', createTestFile('auth-test.txt', 'text/plain', 'auth test'));

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, {
      method: 'PUT',
      headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
      body: formData,
    });

    expect(res.status).not.toBe(401);
    const url = await res.text();
    // Check the *returned* URL uses the FILES_HOSTNAME from env
    expect(url).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_FILES_HOST}\/files\/auth-test_[a-zA-Z0-9_-]+\.txt$`));
    expect(testEnv.AUTH_KEY).toBe(EXPECTED_AUTH_KEY);
  });

  // --- Upload Input Validation Tests ---
  it('UPLOAD: should return 400 Bad Request if file is missing', async () => {
    const formData = new FormData();

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, {
      method: 'PUT',
      headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
      body: formData,
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Missing "file" in form data');
  });

  // --- Upload Success Tests ---
  it('UPLOAD: should successfully upload an image and return direct URL', async () => {
    const fileContent = 'this is a jpeg image';
    const fileBuffer = new TextEncoder().encode(fileContent).buffer as ArrayBuffer;
    const expectedHash = await calculateSha256(fileBuffer);
    const fileName = 'my-test-image.jpg';
    const formData = new FormData();
    formData.append('file', createTestFile(fileName, 'image/jpeg', fileContent));
    formData.append('filename', fileName);
    formData.append('url_preference', 'Original URL');

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, { 
      method: 'PUT',
      headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
      body: formData,
    });

    expect(res.status).toBe(200);
    const url = await res.text();
    // Assert the *returned* URL uses the IMAGE_HOSTNAME from env
    expect(url).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_IMAGES_HOST}\/images\/my-test-image_[a-zA-Z0-9_-]+\.jpg$`));

    // Verify in R2 using the path part of the URL
    const urlPath = new URL(url).pathname;
    const r2Key = urlPath.substring(1);
    const bucket = testEnv.BUCKET;
    const storedObject = await bucket.get(r2Key);
    expect(storedObject).not.toBeNull();
    if (!storedObject) return; 
    expect(await storedObject.arrayBuffer()).toEqual(fileBuffer);
    expect(storedObject.httpMetadata?.contentType).toBe('image/jpeg');
    expect(storedObject.customMetadata?.originalFilename).toBe(fileName);
    expect(storedObject.customMetadata?.mimeType).toBe('image/jpeg');
    expect(storedObject.customMetadata?.originalHash).toBe(expectedHash);
    expect(Number(storedObject.customMetadata?.uploadTimestamp)).toBeCloseTo(Date.now(), -3);
  });

  it('UPLOAD: should successfully upload an image and return Preview-Optimized URL', async () => {
      const fileContent = 'this is another jpeg image';
      const fileName = 'preview-test.jpg';
      const formData = new FormData();
      formData.append('file', createTestFile(fileName, 'image/jpeg', fileContent));
      formData.append('url_preference', 'Preview-Optimized URL');

      // Use placeholder upload URL
      const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, { 
          method: 'PUT',
          headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
          body: formData,
      });

      expect(res.status).toBe(200);
      const url = await res.text();
      // Assert the *returned* URL uses the IMAGE_HOSTNAME from env for both parts
      const expectedUrlRegex = new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_IMAGES_HOST}\/cdn-cgi\/image\/fit=contain,width=1200,format=auto\/${TEST_PROTOCOL}:\/\/${TEST_IMAGES_HOST}\/images\/preview-test_[a-zA-Z0-9_-]+\.jpg$`);
      expect(url).toMatch(expectedUrlRegex);
      
      // Check R2 object existence based on the inner URL
      const directUrlMatch = url.match(new RegExp(`${TEST_PROTOCOL}:\/\/${TEST_IMAGES_HOST}\/images\/preview-test_[a-zA-Z0-9_-]+\.jpg$`));
      expect(directUrlMatch).not.toBeNull();
      const directUrl = directUrlMatch?.[0]; 
      if (directUrl) {
        const bucket = testEnv.BUCKET; 
        const urlPath = new URL(directUrl).pathname;
        const r2Key = urlPath.substring(1);
        const storedObject = await bucket.head(r2Key);
        expect(storedObject).not.toBeNull();
        expect(storedObject?.httpMetadata?.contentType).toBe('image/jpeg');
      } else {
          throw new Error('Could not extract direct URL from optimized URL in test');
      }
  });

  it('UPLOAD: should successfully upload a video and return direct URL', async () => {
    const fileContent = 'this is an mp4 video';
    const fileBuffer = new TextEncoder().encode(fileContent).buffer as ArrayBuffer;
    const expectedHash = await calculateSha256(fileBuffer);
    const fileName = 'my video file.mp4';
    const expectedSanitizedBase = 'my_video_file';
    const formData = new FormData();
    formData.append('file', createTestFile(fileName, 'video/mp4', fileContent));

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, { 
      method: 'PUT',
      headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
      body: formData,
    });

    expect(res.status).toBe(200);
    const url = await res.text();
    // Assert the *returned* URL uses the FILES_HOSTNAME from env
    expect(url).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_FILES_HOST}\/videos\/${expectedSanitizedBase}_[a-zA-Z0-9_-]+\.mp4$`));

    // Verify in R2 using the path part of the URL
    const urlPath = new URL(url).pathname;
    const r2Key = urlPath.substring(1);
    const bucket = testEnv.BUCKET;
    const storedObject = await bucket.get(r2Key);
    expect(storedObject).not.toBeNull();
    if (!storedObject) return;
    expect(await storedObject.arrayBuffer()).toEqual(fileBuffer); 
    expect(storedObject.httpMetadata?.contentType).toBe('video/mp4');
    expect(storedObject.customMetadata?.originalFilename).toBe(fileName);
    expect(storedObject.customMetadata?.mimeType).toBe('video/mp4');
    expect(storedObject.customMetadata?.originalHash).toBe(expectedHash);
  });

  it('UPLOAD: should handle filename with special characters', async () => {
    const fileContent = 'special chars test';
    const fileName = 'file@name with$symbols& spaced .txt';
    const expectedSanitizedBase = 'filename_withsymbols_spaced_';
    const formData = new FormData();
    formData.append('file', createTestFile(fileName, 'text/plain', fileContent));

    // Use placeholder upload URL
    const res = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, { 
        method: 'PUT',
        headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
        body: formData,
    });

    expect(res.status).toBe(200);
    const url = await res.text();
    // Assert the *returned* URL uses the FILES_HOSTNAME from env
    expect(url).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_FILES_HOST}\/files\/${expectedSanitizedBase}_[a-zA-Z0-9_-]+\.txt$`));

    // Verify in R2 using the path part of the URL
    const urlPath = new URL(url).pathname;
    const r2Key = urlPath.substring(1);
    const bucket = testEnv.BUCKET;
    const storedObjectHead = await bucket.head(r2Key);
    expect(storedObjectHead?.customMetadata?.originalFilename).toBe(fileName);
  });

  // --- Duplicate Detection Tests ---
  it('UPLOAD: should detect duplicate file upload and return existing URL', async () => {
    const fileContent = 'this is a duplicate check file';
    const fileBuffer = new TextEncoder().encode(fileContent).buffer as ArrayBuffer;
    const fileName1 = 'duplicate.txt';
    const formData1 = new FormData();
    formData1.append('file', createTestFile(fileName1, 'text/plain', fileContent));

    // First upload (non-image) - use placeholder upload URL
    const res1 = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, { 
      method: 'PUT',
      headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
      body: formData1,
    });
    expect(res1.status).toBe(200);
    const url1 = await res1.text();
    // Assert the *returned* URL uses the FILES_HOSTNAME from env
    expect(url1).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_FILES_HOST}\/files\/duplicate_[a-zA-Z0-9_-]+\.txt$`));
    const firstR2Key = new URL(url1).pathname.substring(1);

    // ... (check R2 state) ...
    const bucket = testEnv.BUCKET;
    const list1 = await bucket.list();
    expect(list1.objects.length).toBe(1);

    // Second upload (same content, non-image) - use placeholder upload URL
    const fileName2 = 'another-name.txt';
    const formData2 = new FormData();
    formData2.append('file', createTestFile(fileName2, 'text/plain', fileContent));

    const res2 = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, { 
      method: 'PUT',
      headers: { 'X-Auth-Key': testEnv.AUTH_KEY },
      body: formData2,
    });
    expect(res2.status).toBe(200);
    const url2 = await res2.text();

    // Should return the URL of the *first* upload, which should have the FILES_HOSTNAME from env
    expect(url2).toBe(url1);
    expect(url2).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_FILES_HOST}\/`));

    // ... (check R2 state hasn't changed) ...
    const list2 = await bucket.list();
    expect(list2.objects.length).toBe(1);
    expect(list2.objects[0].key).toBe(firstR2Key);
    const storedObject = await bucket.head(firstR2Key);
    expect(storedObject?.customMetadata?.originalFilename).toBe(fileName1);
  });

  // --- Retrieval Tests ---
  it('GET: should successfully retrieve an uploaded image', async () => {
    const fileContent = 'image data for retrieval';
    const fileName = 'retrievable.png';
    const fileBuffer = new TextEncoder().encode(fileContent).buffer as ArrayBuffer;
    const formData = new FormData();
    formData.append('file', createTestFile(fileName, 'image/png', fileContent));

    // Upload the file first (using placeholder upload URL)
    const uploadRes = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, {
        method: 'PUT',
        headers: { 'X-Auth-Key': testEnv.AUTH_KEY }, 
        body: formData,
    });
    expect(uploadRes.status).toBe(200);
    const url = await uploadRes.text(); // This will have IMAGE_HOSTNAME from env
    expect(url).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_IMAGES_HOST}\/`));
    
    // Now try to retrieve it using the returned URL
    const getRes = await SELF.fetch(url, { method: 'GET' });

    expect(getRes.status).toBe(200);
    expect(await getRes.arrayBuffer()).toEqual(fileBuffer);
    expect(getRes.headers.get('content-type')).toBe('image/png');
    expect(getRes.headers.get('etag')).toBeDefined();
    expect(getRes.headers.get('cache-control')).toContain('max-age=2592000'); // 30 days
  });

  it('GET: should successfully retrieve an uploaded file (via env files domain)', async () => {
    const fileContent = 'this is a test text file';
    const fileName = 'retrievable-file.txt';
    const fileBuffer = new TextEncoder().encode(fileContent).buffer as ArrayBuffer;
    const formData = new FormData();
    formData.append('file', createTestFile(fileName, 'text/plain', fileContent));

    // Upload the file first (using placeholder upload URL)
    const uploadRes = await SELF.fetch(`${UPLOAD_URL_BASE}/upload`, {
        method: 'PUT',
        headers: { 'X-Auth-Key': testEnv.AUTH_KEY }, 
        body: formData,
    });
    expect(uploadRes.status).toBe(200);
    const url = await uploadRes.text(); // This will have FILES_HOSTNAME from env
    expect(url).toMatch(new RegExp(`^${TEST_PROTOCOL}:\/\/${TEST_FILES_HOST}\/`));

    // Now try to retrieve it using the returned URL 
    const getRes = await SELF.fetch(url, { method: 'GET' });

    expect(getRes.status).toBe(200);
    expect(await getRes.arrayBuffer()).toEqual(fileBuffer); 
    expect(getRes.headers.get('content-type')).toBe('text/plain');
    expect(getRes.headers.get('etag')).toBeDefined();
    expect(getRes.headers.get('cache-control')).toContain('max-age=2592000'); 
  });

  it('GET: should return 404 for non-existent key', async () => {
    // Fetch using hostnames from env
    const res = await SELF.fetch(`${TEST_PROTOCOL}://${TEST_IMAGES_HOST}/images/non-existent-key.jpg`, { method: 'GET' });
    expect(res.status).toBe(404);
    const res2 = await SELF.fetch(`${TEST_PROTOCOL}://${TEST_FILES_HOST}/files/non-existent-key.txt`, { method: 'GET' });
    expect(res2.status).toBe(404);
  });

  it('GET: should return 404 for invalid type prefix', async () => {
    // Use images host from env for example
    const res = await SELF.fetch(`${TEST_PROTOCOL}://${TEST_IMAGES_HOST}/documents/some-key.doc`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  // TODO: Add tests for sanitizeFilename, generateUniqueFilename if they were exported
  // TODO: Add test for hash calculation failure (difficult to reliably trigger)
}); 