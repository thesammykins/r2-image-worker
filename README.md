# r2-media-worker

Store and deliver images and videos with Cloudflare R2 backend via Cloudflare Workers.

## Synopsis

1. Deploy **r2-media-worker** to Cloudflare Workers using your custom domain.
2. `PUT` your image or video file (and its original filename) to the worker's `/upload` endpoint.
3. The file will be stored in a Cloudflare R2 storage bucket.
4. **r2-media-worker** will respond with the full, direct URL to the stored file (e.g., `https://your-domain.com/images/1678886400000_my_photo.jpg`).
5. **r2-media-worker** serves images from `/images/<key>` and videos from `/videos/<key>` (where `<key>` is `timestamp_sanitized-filename`).
6. Files are cached on the Cloudflare CDN.

```plain
User => File + Filename => r2-media-worker => R2
User <= URL <= r2-media-worker
User <= File <= URL (served by Worker/CDN Cache/R2)
```

## Prerequisites

- Cloudflare Account (with a configured zone/domain)
- Wrangler CLI (v3 or later recommended)
- Node.js and npm

## Set up

First, clone the repository:

```bash
git clone <your-repo-url> # Replace with your repository URL
cd r2-media-worker
npm install
```

Create an R2 bucket using Wrangler:

```bash
# Replace 'your-bucket-name' with the desired name for your R2 bucket
wrangler r2 bucket create your-bucket-name
```

Copy `wrangler.example.toml` to `wrangler.toml`:

```bash
cp wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml`:

- Update `compatibility_date` to a recent date.
- Configure the `[[routes]]` section with your desired `pattern` (e.g., `subdomain.your-domain.com/`).
- In the `[[r2_buckets]]` section, set `bucket_name` to the name you created above.

## Variables

### Secret variables

The worker uses one secret variable for authentication:

- `AUTH_KEY` - A shared secret key required for uploads.

Generate a strong, random key (e.g., using a password manager or `openssl rand -base64 32`).

To set the secret, use the `wrangler secret put` command:

```bash
wrangler secret put AUTH_KEY
# Paste your generated secret key when prompted
```

## Publish

To publish the worker to your Cloudflare account:

```bash
npm run deploy
# Or directly: npx wrangler deploy
```

## Endpoints

### `/upload` (PUT)

**Headers:**

Requires an authentication header:

```plain
X-Auth-Key: <your-secret-key>
```

**Request Body (Form Data):**

The body should be `multipart/form-data` containing:

- `file`: The image or video file binary.
- `filename`: The original filename (e.g., `my_vacation_video.mp4`).

**Response:**

- `200 OK`: Returns the full URL to the uploaded file as plain text (e.g., `https://your-domain.com/videos/1678886400000_my_vacation_video.mp4`).
- `400 Bad Request`: Missing `file` or `filename`.
- `401 Unauthorized`: Missing or incorrect `X-Auth-Key` header.
- `500 Internal Server Error`: Failed to upload to R2.

### `/images/<key>` (GET)

Serves the image file associated with the key (`timestamp_sanitized-filename`).

### `/videos/<key>` (GET)

Serves the video file associated with the key (`timestamp_sanitized-filename`).

## Example Usage (curl)

1. Upload a file:

   ```bash
   # Replace placeholders with your actual values
   YOUR_DOMAIN="your-domain.com"
   YOUR_KEY="your-secure-auth-key"
   FILE_PATH="/path/to/your/image.jpg"
   FILENAME="image.jpg"

   curl -X PUT \
     -H "X-Auth-Key: ${YOUR_KEY}" \
     -F "file=@${FILE_PATH}" \
     -F "filename=${FILENAME}" \
     "https://${YOUR_DOMAIN}/upload"
   ```

2. The command will output the URL (e.g., `https://your-domain.com/images/1678886400000_image.jpg`). Visit this URL in your browser.

## Using with Shortcuts (macOS/iOS)

This worker is ideal for quickly uploading clipboard content via Shortcuts.

**Key Shortcut Actions:**

1.  `Get Clipboard`: Gets the raw content (image or video).
2.  `Get Details of Files`: Get `Name` from the `Clipboard` variable (from step 1).
3.  `Get contents of URL`:
    *   URL: `https://your-domain.com/upload` (replace with your actual domain)
    *   Method: `PUT`
    *   Headers: Add `X-Auth-Key` with your secret key value.
    *   Request Body: `Form`
        *   Add field: Key=`file`, Type=`File`, Value=`Clipboard` (variable from step 1)
        *   Add field: Key=`filename`, Type=`Text`, Value=`Name` (variable from step 2)
4.  `Copy to Clipboard`: Copy the output of step 3 (which is the returned URL).

Grab it from here and edit <https://www.icloud.com/shortcuts/9270d7905a72458e925a51b6323c3693>

## Author

Original concept by Yusuke Wada <https://github.com/yusukebe>

Modifications by [thesammykins] <https://github.com/thesammykins>

## License

MIT
