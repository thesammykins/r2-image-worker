# r2-media-worker

Store and deliver images, videos, and other files with Cloudflare R2 backend via Cloudflare Workers, with duplicate detection and configurable hostnames.

## Synopsis

1.  Configure DNS for three hostnames (e.g., `upload.your-domain.com`, `images.your-domain.com`, `files.your-domain.com`) pointing to Cloudflare.
2.  Deploy **r2-media-worker** to Cloudflare Workers, configured with these hostnames and routes.
3.  `PUT` your file (image, video, etc.) and its original filename to the dedicated upload endpoint (e.g., `https://upload.your-domain.com/upload`).
4.  The worker calculates the file's SHA-256 hash.
5.  If a file with the same hash already exists, its URL is returned immediately.
6.  Otherwise, the file is stored in a Cloudflare R2 storage bucket with a unique name (`sanitized-filename_nanoid.extension`).
7.  **r2-media-worker** responds with the full, direct URL to the stored file.
    *   Image URLs use the configured image hostname (e.g., `https://images.your-domain.com/images/my_photo_aBcDeFg.jpg`).
    *   Other file URLs (videos, text, etc.) use the configured files hostname (e.g., `https://files.your-domain.com/videos/my_video_xYz123.mp4`).
8.  **r2-media-worker** serves files from `/images/<key>`, `/videos/<key>`, and `/files/<key>` via the appropriate hostnames.
9.  Files are cached on the Cloudflare CDN.

```plain
User => File + Filename => Worker (upload.your-domain.com) => Hash Check => R2 (if new)
User <= URL (images.* or files.*) <= Worker
User <= File <= URL (images.* or files.*) (served by Worker/CDN Cache/R2)
```

## Prerequisites

- Cloudflare Account (with a configured zone/domain)
- Wrangler CLI (v3 or later recommended)
- Node.js and npm
- `op` CLI (Optional, for managing secrets with 1Password)

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
# Also create a preview bucket for local testing
wrangler r2 bucket create your-preview-bucket-name
```

Copy `wrangler.example.toml` to `wrangler.toml`:

```bash
cp wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml`:

- Update `compatibility_date` to a recent date.
- Configure the `[[routes]]` section with your desired `pattern`s for the **upload**, **image serving**, and **file serving** hostnames (e.g., `upload.your-domain.com`, `images.your-domain.com`, `files.your-domain.com`). Ensure `custom_domain = true` for each.
- In the `[[r2_buckets]]` section, set `bucket_name` to your production R2 bucket name and `preview_bucket_name` to your preview bucket name.
- In the `[vars]` section, set the `IMAGE_HOSTNAME`, `FILES_HOSTNAME`, and `UPLOAD_HOSTNAME` variables to match the hostnames used in your `[[routes]]`.

## Variables & Secrets

### Required

- `AUTH_KEY` (Secret): A shared secret key required for uploads. Generate a strong, random key.
- `IMAGE_HOSTNAME` (Variable): The hostname used in returned URLs for images (e.g., `images.your-domain.com`). Should match a `[[routes]]` pattern.
- `FILES_HOSTNAME` (Variable): The hostname used in returned URLs for non-image files (e.g., `files.your-domain.com`). Should match a `[[routes]]` pattern.
- `UPLOAD_HOSTNAME` (Variable): The hostname used for the upload endpoint (e.g., `upload.your-domain.com`). Should match a `[[routes]]` pattern.

### Setting Secrets

It is strongly recommended to set `AUTH_KEY` as a secret rather than a plain variable in `wrangler.toml` for production.

```bash
# Using wrangler
wrangler secret put AUTH_KEY
# Paste your generated secret key when prompted

# Using 1Password CLI (Example)
op read "op://API Credentials/Cloudwrap Secret/credential" | wrangler secret put AUTH_KEY
```

### Setting Variables

Set `IMAGE_HOSTNAME`, `FILES_HOSTNAME`, and `UPLOAD_HOSTNAME` in the `[vars]` section of your `wrangler.toml` file.

```toml
# Example [vars] in wrangler.toml
[vars]
IMAGE_HOSTNAME = "images.your-domain.com"
FILES_HOSTNAME = "files.your-domain.com"
UPLOAD_HOSTNAME = "upload.your-domain.com"
# AUTH_KEY = "some-key" # Use secrets for production!
```

## Publish

Ensure your DNS records for the upload, images, and files hostnames are pointing to Cloudflare.

Deploy the worker:

```bash
npm run deploy
# Or directly: npx wrangler deploy
```

## Endpoints

### `https://<upload-hostname>/upload` (PUT)

**Headers:**

Requires an authentication header:

```plain
X-Auth-Key: <your-secret-key>
```

**Request Body (Form Data):**

The body should be `multipart/form-data` containing:

- `file`: The image, video, or other file binary.
- `filename` (Optional): The desired original filename (e.g., `my_vacation_video.mp4`). If omitted, the filename from the `file` part is used.
- `url_preference` (Optional): Text value indicating desired URL type for images. Send `Preview-Optimized URL` to get a Cloudflare Image Transformation URL. If omitted or set to anything else (e.g., `Original URL`), a direct link is returned.

**Response:**

- `200 OK`: Returns the full URL to the uploaded file as plain text.
    - Image URLs use `IMAGE_HOSTNAME` (e.g., `https://images.your-domain.com/images/image_abc123.jpg`).
    - Non-Image URLs use `FILES_HOSTNAME` (e.g., `https://files.your-domain.com/videos/video_xyz789.mp4`).
    - For images, if `url_preference` was set to `Preview-Optimized URL`, the returned URL will be a longer `/cdn-cgi/image/...` transformation URL based on the `IMAGE_HOSTNAME`.
- `400 Bad Request`: Missing `file` in form data.
- `401 Unauthorized`: Missing or incorrect `X-Auth-Key` header.
- `500 Internal Server Error`: Failed to calculate hash or upload to R2.

### `https://<images-hostname>/images/<key>` (GET)

Serves the image file associated with the key (`sanitized-filename_nanoid.extension`).

### `https://<files-hostname>/videos/<key>` (GET)

Serves the video file associated with the key.

### `https://<files-hostname>/files/<key>` (GET)

Serves any other file type associated with the key.

## Example Usage (curl)

1. Upload a file:

   ```bash
   # Replace placeholders with your actual values
   UPLOAD_DOMAIN="upload.your-domain.com"
   YOUR_KEY="your-secure-auth-key"
   FILE_PATH="/path/to/your/file.zip"
   FILENAME="archive.zip"

   curl -X PUT \
     -H "X-Auth-Key: ${YOUR_KEY}" \
     -F "file=@${FILE_PATH}" \
     -F "filename=${FILENAME}" \
     "https://${UPLOAD_DOMAIN}/upload"
   ```

2. The command will output the URL (e.g., `https://files.your-domain.com/files/archive_abc123.zip`). Visit this URL in your browser or use it as needed.

## Command-Line Upload Script

A Bash script (`upload.sh`) is provided in the `script_use/` directory for quick uploads from the command line on macOS.

**Features:**

- Uploads files specified as arguments.
- If no arguments are given, attempts to upload PNG image data directly from the clipboard (requires `pngpaste`: `brew install pngpaste`).
- Retrieves the `AUTH_KEY` from 1Password CLI (requires `op`: `brew install --cask 1password-cli`).
- Copies the returned URL to the clipboard.

**Setup:**

1.  Ensure `op` and `pngpaste` are installed.
2.  Make sure you are logged into the `op` CLI (`op signin`).
3.  Edit the script (`script_use/upload.sh`) to:
    *   Set the correct `UPLOAD_URL`.
    *   Adjust the `op read` command to point to your `AUTH_KEY` secret in 1Password.
4.  Make the script executable: `chmod +x script_use/upload.sh`

**Usage:**

```bash
# Upload a specific file
./script_use/upload.sh /path/to/your/image.png

# Upload image from clipboard
./script_use/upload.sh
```

## Using with Shortcuts (macOS/iOS)

This worker is ideal for quickly uploading clipboard content or files via Shortcuts.

**Key Shortcut Actions:**

1.  Determine the input file (`FileToUpload`) and filename (`FilenameToUpload`) either from `Shortcut Input` (for Share Sheet/Quick Actions) or from `Clipboard` (if no direct input).
2.  **(Optional) Add `Choose from Menu` action:** Prompt the user to select between `Original URL` and `Preview-Optimized URL`. Store the result in a variable (e.g., `UrlPreference`).
3.  `Get contents of URL`:
    *   URL: `https://upload.your-domain.com/upload` (replace with your actual upload domain variable)
    *   Method: `PUT`
    *   Headers: Add `X-Auth-Key` with your secret key value.
    *   Request Body: `Form`
        *   Add field: Key=`file`, Type=`File`, Value=`FileToUpload` (variable from step 1)
        *   Add field: Key=`filename`, Type=`Text`, Value=`FilenameToUpload` (variable from step 1)
        *   **(Optional) Add field:** Key=`url_preference`, Type=`Text`, Value=`UrlPreference` (variable from step 2)
4.  `Copy to Clipboard`: Copy the output of step 3 (which is the returned URL - either `images.*` or `files.*` hostname).

Grab it from here and edit <https://www.icloud.com/shortcuts/1f10d1c0ee9c45ef9551af3c69817564>

Also if you have issues  with images being formatted incorrectly you can auto-crop with this shortcut <https://www.icloud.com/shortcuts/726a778e3d314068af9cf9b3b56db925>

## Author

Original concept by Yusuke Wada <https://github.com/yusukebe>

Modifications by thesammykins <https://github.com/thesammykins>

## License

MIT
