# Cloudflare Images: October 2025 Update Summary

**Research Date:** October 30, 2025  
**Primary Sources:** 
- Official Cloudflare Images Documentation (developers.cloudflare.com/images)
- Cloudflare API Reference Documentation
- Context7 Library Documentation (342 code snippets)
- Cloudflare Blog Posts and Changelog
- Tutorial and Integration Guides

**Relevant Versions:** 
- Latest Images service (merged with Image Resizing as of November 2023)
- Current pricing model active through October 2025
- Documentation last updated: August-October 2025
- Wrangler versions supporting high/low-fidelity Images modes

---

## Executive Summary

Cloudflare Images has evolved into a comprehensive end-to-end image management solution combining storage, transformation, and delivery capabilities. As of October 2025, the service offers advanced AI-powered features (face detection, background segmentation), flexible variant system for dynamic resizing, seamless R2 integration, and a unified pricing model based on unique transformations rather than cache hits. The service is available on all Cloudflare plans, with enterprise-grade capabilities accessible through Workers bindings and specialized integration tutorials. 

**Key Recent Enhancements:**
- Sourcing Kit (beta) for S3 migration with deduplication
- Content Credentials preservation (C2PA metadata)
- Improved Workers integration for advanced image pipelines
- Subject segmentation via BiRefNet AI model
- Face-aware cropping with zoom control

---

## Key Findings

### Major Capabilities

- **Unified Product**: Images and Image Resizing merged (November 2023) into single, cohesive product with simplified pricing model
- **AI-Powered Transformations**: 
  - Face detection for intelligent cropping (RetinaFace model via Workers AI)
  - Background segmentation/subject isolation (BiRefNet model)
  - Automatic saliency detection for optimal focal points
- **Flexible Variants**: Dynamic resizing without predefined variants, enabled per-account with URL parameter customization
- **Deep Workers Integration**: Direct binding to Cloudflare Workers for programmatic image manipulation, watermarking, and R2 pipeline creation
- **R2 Native Integration**: Official tutorial for transforming user-uploaded images before R2 storage, with Worker Assets support for watermarking
- **40+ Transformation Parameters**: Comprehensive image manipulation capabilities including resize, crop, compress, rotate, blur, sharpen, saturation, brightness, gamma, contrast, trim, overlay

### Transformation Features Available

**Output Formats:**
- AVIF (with fallback chain)
- WebP (with animation support)
- JPEG (progressive & baseline)
- PNG (with PNG8 palette variant)
- GIF (with animation preservation)
- SVG (sanitized via svg-hush)
- JSON (metadata only)

**Fit Modes:**
- `scale-down`: Never enlarge; preserve original if smaller than specified
- `contain`: Fit within bounds while preserving aspect ratio
- `cover`: Fill entire area (crops to maintain aspect)
- `crop`: Shrink and crop, no enlargement
- `pad`: Fit with background fill
- `squeeze`: Stretch to exact dimensions (ignores aspect ratio)

**Gravity & Cropping:**
- `auto`: Saliency detection (maximum symmetric surround)
- `face`: Face-aware focal point (with zoom 0-1)
- Manual coordinates: `0x1`, `0.5x0.5`, `0.5x0.33` (0.0-1.0 range)
- Edge alignment: `left`, `right`, `top`, `bottom`

**Advanced Features:**
- Metadata handling: `copyright`, `keep`, `none`
- C2PA (Content Credentials) preservation
- Overlay/watermarking with opacity and positioning
- Animation frame control (`anim=true/false`)
- Slow connection detection and quality override
- SVG sanitization (no resizing, scalable by nature)

### Pricing Model (Current as of October 2025)

**Free Plan:**
- Up to 5,000 unique transformations/month
- Transformations only (no storage)
- Unlimited remote image optimization

**Paid Plan:**
- **Images Transformed**: $0.50 per 1,000 unique transformations/month (first 5,000 included)
- **Images Stored**: $5 per 100,000 images stored/month
- **Images Delivered**: $1 per 100,000 images delivered/month

**Unique Transformation Billing:**
- Counted over 30-day rolling sliding window (not calendar month)
- Same transformation served in multiple formats (AVIF/WebP via `format=auto`) counts as 1 transformation
- Example: `width=100/thumbnail.jpg` on June 30 = 1 unit; same transformation on July 1 = NOT re-billed
- More predictable than previous cache-dependent model
- Aligns with business logic (original image + number of resize variations)

---

## Detailed Information

### 1. /cdn-cgi/image/ API & Transformation Parameters

#### URL Structure
```
https://<ZONE>/cdn-cgi/image/<OPTIONS>/<SOURCE-IMAGE>
```

**Components:**
- `<ZONE>`: Your Cloudflare domain (omit for relative paths)
- `/cdn-cgi/image/`: Fixed prefix for image transformation
- `<OPTIONS>`: Comma-separated parameters (no spaces)
- `<SOURCE-IMAGE>`: Absolute path or full URL to source

#### Complete Parameter Reference

| Parameter | Type | Range | Default | Purpose |
|-----------|------|-------|---------|---------|
| `width` / `w` | integer / `auto` | pixels or auto | - | Maximum image width |
| `height` / `h` | integer | pixels | - | Maximum image height |
| `fit` | string | scale-down, contain, cover, crop, pad, squeeze | - | Resize behavior |
| `format` / `f` | string | auto, avif, webp, jpeg, baseline-jpeg, json | - | Output format |
| `quality` / `q` | 1-100 or string | 1-100 or high/medium-high/medium-low/low | 85 | JPEG/WebP/AVIF quality |
| `dpr` | float | 1-4 | 1 | Device pixel ratio multiplier |
| `rotate` | integer | 90, 180, 270 | - | Rotation degrees |
| `flip` | string | h, v, hv | - | Horizontal/vertical flip |
| `blur` | integer | 1-250 | - | Blur radius |
| `sharpen` | float | 0-10 | 0 | Sharpening strength |
| `brightness` | float | 0.5-2.0 | 1.0 | Brightness multiplier |
| `contrast` | float | 0.5-2.0 | 1.0 | Contrast multiplier |
| `saturation` | float | 0-2.0 | 1.0 | Color saturation (0=grayscale) |
| `gamma` | float | 0.5-2.0 | 1.0 | Exposure adjustment |
| `trim` | string/coords | border or top;right;bottom;left | - | Border/pixel removal |
| `compression` | string | fast | - | Quick encode (not recommended) |
| `metadata` | string | copyright, keep, none | copyright (JPEG) | EXIF preservation |
| `background` | CSS color | #RRGGBB, rgb(), rgba() | white | Fill for transparency |
| `gravity` | string/coords | auto, face, left/right/top/bottom, 0x1 | auto | Crop focal point |
| `zoom` | float | 0-1 | 0 | Face zoom (with gravity=face) |
| `segment` | string | foreground | - | AI subject isolation |
| `anim` | boolean | true/false | true | Preserve animation frames |
| `slow-connection-quality` / `scq` | 1-100 or string | same as quality | - | Quality override for slow connections |
| `onerror` | string | redirect | - | Fallback on fatal error |

#### Example Transformations

**Responsive Image:**
```
/cdn-cgi/image/fit=scale-down,width=1920/image.jpg  // Desktop
/cdn-cgi/image/fit=scale-down,width=960/image.jpg   // Tablet
/cdn-cgi/image/fit=scale-down,width=640/image.jpg   // Mobile
```

**Face-Centric Cropping:**
```
/cdn-cgi/image/width=400,height=400,fit=cover,gravity=face,zoom=0.3/photo.jpg
/cdn-cgi/image/width=400,height=400,fit=cover,gravity=face,zoom=0.8/photo.jpg // Tight crop
```

**Subject Segmentation:**
```
/cdn-cgi/image/segment=foreground,width=400/product.jpg  // Transparent background
```

**Format Negotiation:**
```
/cdn-cgi/image/width=800,format=auto,quality=85/image.jpg  // AVIF/WebP/JPEG per browser
```

**Quality by Connection:**
```
/cdn-cgi/image/width=800,quality=85,scq=50/image.jpg  // 50 quality on slow connections
```

### 2. Workers Binding API & Advanced Integration

#### Setup
```toml
# wrangler.toml
[images]
binding = "IMAGES"
```

#### Method Chain Pattern
```typescript
const response = await env.IMAGES
  .input(stream)                    // ReadableStream or ArrayBuffer
  .transform({ width: 800 })        // Apply transformation
  .transform({ blur: 20 })          // Chain multiple transforms
  .draw(watermark, options)         // Overlay another image
  .output({ format: "image/avif" }) // Specify output
  .response();                       // Generate HTTP response
```

#### Core Methods

**`.info(stream)` - Extract Metadata**
```typescript
const info = await env.IMAGES.info(stream);
// Returns: { format, width, height, fileSize, ... }
```

**`.input(stream)` - Initialize Pipeline**
- Accepts: ReadableStream or ArrayBuffer
- Returns: Chainable builder object
- Can source from: R2, HTTP fetch, uploaded files, Worker Assets

**`.transform(params)` - Apply Transformation (Chainable)**
```typescript
.transform({ 
  width: 800,
  height: 600,
  fit: "cover",
  rotate: 90,
  blur: 5,
  sharpen: 2,
  quality: 85
})
```
- All 40+ parameters supported
- Multiple `.transform()` calls allowed
- Order matters: trim → rotate → resize → effects

**`.draw(overlayStream, options)` - Overlay Image**
```typescript
.draw(watermarkStream, {
  opacity: 0.5,
  bottom: 10,
  right: 10,
  repeat: true,  // or "x", "y"
  fit: "contain",
  width: 100,
  height: 50,
  rotate: 45
})
```
- Supports transformation on overlay via chained `.transform()`
- Multiple `.draw()` calls for layered composition

**`.output(options)` - Specify Output**
```typescript
.output({ 
  format: "image/avif",  // or "image/webp", "image/jpeg"
  quality: 85
})
```
- Format options: `image/avif`, `image/webp`, `image/jpeg`, `image/png`, `image/json`

**`.response()` - Generate HTTP Response**
```typescript
const httpResponse = (await pipeline).response();
return httpResponse;  // Return to browser
```

#### Local Development Modes

**High-Fidelity (Full Features):**
```bash
npx wrangler dev
# Uses production Images API; all features available
# May consume free usage if not mocked
```

**Low-Fidelity (Offline Mode):**
```bash
npx wrangler dev --experimental-images-local-mode
# Subset of features: width, height, rotate, format only
# No API calls; faster for development
```

**Vitest Integration:**
```typescript
// Default: Low-fidelity mode
// To use high-fidelity: Configure custom test environment
```

### 3. Transformation Feature Details

#### Face Detection & Cropping

**Technology:** RetinaFace model via Workers AI (detection only, no identification)

**Parameters:**
```
gravity=face              // Enable face detection
zoom=0.5                  // 0 (max background) to 1 (tight crop)
face-zoom=0.5            // Alias for zoom parameter
width=400,height=400,fit=cover,gravity=face,zoom=0.3
```

**Behavior:**
- Calculates minimum bounding box around all detected faces
- Falls back to image center if no faces detected
- Works with any fit mode
- Useful for: Profile pictures, team photos, user-generated content

**Example:**
```
/cdn-cgi/image/width=200,height=200,fit=cover,gravity=face,zoom=0.6/portrait.jpg
// Returns 200x200 crop focused on detected face with 60% zoom
```

#### Subject Segmentation (Background Removal)

**Technology:** BiRefNet model via Workers AI

**Parameter:**
```
segment=foreground
```

**Behavior:**
- Replaces background with transparent pixels
- Isolates image subject automatically
- Works with PNG output for transparency preservation

**Usage:**
```
/cdn-cgi/image/segment=foreground,format=webp,quality=85/product.jpg
// Returns product with transparent background in WebP format
```

**Use Cases:** E-commerce, product photography, content creation, automated editing

#### Animation Frame Control

**Parameter:** `anim=true/false`

**Behavior:**
- `true` (default): Preserves all frames in GIF/WebP animations
- `false`: Converts animations to still images (first frame)
- Reduces file size for animations
- Recommended when enlarging images or processing user content

**Performance Impact:**
- GIF/WebP animations limited to 50 megapixels total (sum of all frames)
- Large animations process slowly; use `anim=false` to reduce latency

**Example:**
```
/cdn-cgi/image/width=500,anim=false/animation.gif
// Returns static image (first frame) at 500px width
```

#### Metadata & Content Credentials (C2PA)

**EXIF Preservation:**
```
metadata=keep        // Preserve all EXIF (including GPS)
metadata=copyright   // Keep copyright tag only
metadata=none        // Strip all metadata (default for WebP/PNG)
```

**Content Credentials (C2PA):**
- Cryptographically signed image provenance chain
- Enable in dashboard: Images > Transformations > "Preserve Content Credentials"
- Behavior when enabled:
  - `metadata=keep` or `copyright`: Preserves existing C2PA
  - `metadata=none`: Strips C2PA
  - Automatically appends transformation action to provenance chain

**Privacy Consideration:** Strip metadata (`metadata=none`) for privacy-sensitive applications

#### SVG Handling

**Sanitization:** All SVGs processed through `svg-hush` (open-source Rust tool)

**Security Features:**
- Removes scripts (prevents XSS in standalone viewing)
- Removes external references (prevents tracking)
- Removes cross-origin resources

**Limitation:** SVGs cannot be resized (inherently scalable format)

**Serving SVGs:**
```
https://imagedelivery.net/{account_hash}/{svg_id}/public
// Use variant as placeholder; SVG served without transformation
```

### 4. Format Limitations & Fallbacks

#### Hard vs. Soft Limits

| Format | Hard Limit (longest side) | Soft Limit | Notes |
|--------|--------------------------|-----------|-------|
| AVIF | 1,200px (1,600px explicit) | 640px | Slow; fallback to WebP then JPEG |
| WebP | - | 2,560px (lossy); 1,920px (lossless) | Modern browsers; good compression |
| JPEG | 12,000px | - | Universally supported |
| GIF/WebP Anim | 50 megapixels total | - | Sum of all frames |
| All formats | <70 MB file size; 100 megapixels area | - | Hard limits for stability |

**Progressive JPEG Fallback:**
- Uses progressive JPEG for images >150×150 and <3,000×3,000
- Falls back to baseline JPEG for: 
  - Very small (<150×150): Always baseline
  - Very large (>3,000×3,000): Always baseline

#### AVIF Format Strategy

**Best Effort Approach:**
- AVIF requested but falls back to WebP/JPEG if:
  - Image too large (>1,200px longest side)
  - System under load (soft limit exceeded)
  - Explicit `format=avif` still hard limit at 1,600px

**Auto Format Selection:**
```
format=auto  // Serves best format for browser
             // AVIF > WebP > JPEG per browser support
```

### 5. Flexible Variants System

#### Enable Flexible Variants

**Dashboard:**
- Navigate to: Images > Variants
- Toggle: "Enable Flexible Variants"

**API:**
```bash
curl --request PATCH https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v1/config \
  --header "Authorization: Bearer <API_TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{"flexible_variants": true}'
```

#### Usage After Enabling

```
https://imagedelivery.net/{account_hash}/{image_id}/w=400,sharpen=3
https://imagedelivery.net/{account_hash}/{image_id}/width=800,height=600,fit=cover
```

**Parameters:** All `/cdn-cgi/image/` options supported

**Limitations:**
- Cannot combine with signed delivery URLs (for private images)
- Each unique transformation parameter combination = 1 billable unit
- Recommended for public/unauthenticated images

### 6. Responsive Image Patterns

#### HTML Srcset (Recommended)
```html
<img
  src="/cdn-cgi/image/width=800,format=auto/hero.jpg"
  srcset="
    /cdn-cgi/image/width=640,format=auto/hero.jpg 640w,
    /cdn-cgi/image/width=1024,format=auto/hero.jpg 1024w,
    /cdn-cgi/image/width=1600,format=auto/hero.jpg 1600w
  "
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1200px"
  alt="Hero"
/>
```

#### Dynamic Width (Chromium Only)
```
/cdn-cgi/image/width=auto/image.jpg
```
- Browser hints automatically select optimal width
- Requires Accept-CH headers: `rtt, save-data, ect, downlink`
- Reduces guesswork in responsive design

#### Picture Element with Media Queries
```html
<picture>
  <source media="(min-width: 1024px)" srcset="/cdn-cgi/image/width=1200,format=auto/hero.jpg" />
  <source media="(min-width: 640px)" srcset="/cdn-cgi/image/width=768,format=auto/hero.jpg" />
  <img src="/cdn-cgi/image/width=480,format=auto/hero.jpg" alt="Hero" />
</picture>
```

### 7. Watermarking & Overlay Operations

#### URL-Based Fetch Method (Limited)
```javascript
fetch(imageURL, {
  cf: {
    image: {
      width: 1024,
      draw: [
        {
          url: 'https://example.com/logo.png',
          bottom: 5,
          right: 5,
          opacity: 0.8,
          width: 100,
          height: 50,
          fit: 'contain'
        }
      ]
    }
  }
});
```

**Limitations:**
- Only available in Workers fetch, not URL-based API
- Limited positioning options
- Better approach: Use Workers binding

#### Workers Binding Method (Recommended)
```typescript
const watermark = await fetch('https://example.com/watermark.png');
const image = await fetch('https://example.com/image.jpg');

const response = await env.IMAGES
  .input(image.body)
  .transform({ width: 1024 })
  .draw(watermark.body, {
    opacity: 0.25,
    bottom: 10,
    right: 10,
    repeat: false
  })
  .output({ format: 'image/avif' })
  .response();
```

#### Draw Options

- `opacity`: 0 (transparent) to 1 (opaque)
- `repeat`: `true` (tile fully), `"x"` (horizontal line), `"y"` (vertical line), `false` (single placement)
- `top`, `bottom`, `left`, `right`: Pixel offsets (omit both top/bottom and left/right to center)
- `width`, `height`: Maximum size of overlay
- `fit`: Resize behavior (scale-down, contain, cover, crop)
- `gravity`: Focal point for overlay sizing
- `rotate`: Rotation in degrees
- `background`: Background color fill

#### Multi-Layer Composition
```typescript
const response = await env.IMAGES
  .input(baseImage)
  .draw(watermark1, { bottom: 5, right: 5, opacity: 0.8 })
  .draw(watermark2, { top: 5, left: 5, opacity: 0.5 })
  .draw(logo, { top: 50, left: 50 })
  .output({ format: 'image/avif' })
  .response();
```

**Order matters:** Overlays drawn in array order (last = topmost layer)

### 8. R2 Integration Pattern

#### Optimal Workflow: Transform Before Storage
```typescript
export default {
  async fetch(request, env) {
    if (request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('image');
      const fileBuffer = await file.arrayBuffer();
      
      // Fetch watermark from Worker Assets
      const watermarkResponse = await env.ASSETS.fetch(
        new URL('/watermark.png', request.url)
      );
      
      // Transform & watermark
      const transformed = await env.IMAGES
        .input(fileBuffer)
        .draw(watermarkResponse.body, {
          width: 100,
          height: 100,
          bottom: 10,
          right: 10,
          opacity: 0.75
        })
        .output({ format: 'image/avif' })
        .response();
      
      // Store in R2
      const fileName = `processed-${Date.now()}.avif`;
      await env.R2.put(fileName, transformed.body);
      
      return new Response(`Stored as ${fileName}`);
    }
  }
};
```

#### Optimize R2-Stored Images
```typescript
// Get image from R2 and transform on-the-fly
const r2Object = await env.R2.get('original.jpg');

const optimized = await env.IMAGES
  .input(r2Object.body)
  .transform({ width: 800, quality: 75 })
  .output({ format: 'image/webp' })
  .response();

return optimized;
```

### 9. Sourcing Kit (Beta)

#### Purpose
Bulk import images from Amazon S3 repositories into Cloudflare Images

#### Workflow
1. **Configure Source:** Define S3 bucket, region, credentials
2. **Set Prefix:** Optional path filtering (e.g., `/products/`)
3. **Import:** One-time or recurring imports
4. **Deduplication:** Automatically skips already-imported images
5. **Error Logging:** Generates migration log for skipped items

#### Supported S3 Storage Classes
- Standard ✓
- Standard-IA ✓
- Intelligent-Tiering ✓
- One Zone-IA ✓
- Glacier Instant Retrieval ✓
- **Glacier Flexible & Deep Archive:** ✗ Skipped

#### Current Status
- Invitation-based closed beta
- Sign up via form: https://forms.gle/...
- Community support: Cloudflare Discord

---

## Best Practices

### Image Serving & Performance

1. **Always use `format=auto`** for modern image delivery
   - Automatically serves AVIF to supporting browsers
   - Falls back to WebP, then JPEG
   - Single transformation billing despite format variations

2. **Implement responsive images** with srcset or picture element
   - Define breakpoints: 640px (mobile), 960px (tablet), 1920px (desktop)
   - Use `fit=scale-down` to prevent unnecessary enlargement
   - Reduces bandwidth; improves Core Web Vitals

3. **Set appropriate quality levels**
   - Desktop/high-DPI: quality=85 (default)
   - Mobile/network-constrained: quality=75
   - Thumbnails/secondary images: quality=50-70
   - Slow connections: Use `scq` parameter for automatic downgrade

4. **Leverage caching aggressively**
   - Resized images cached 1+ hour by default (per Cache-Control headers)
   - Original image cached; reused across multiple transformations
   - Reduces origin server load

5. **Use Cloudflare's global network**
   - Edge transformation reduces latency
   - No need to transform at origin
   - Scales automatically with demand

### AI Feature Usage

**Face-Aware Cropping:**
- Ideal for: Profile pictures, team photos, user avatars
- Use `gravity=face` with `zoom=0.3-0.5` for comfortable framing
- Falls back gracefully to center crop if faces not detected

**Subject Segmentation:**
- Ideal for: E-commerce products, content creation, background removal
- Output as PNG for transparency preservation
- Enables clean product photography automation

### Security & Privacy

1. **SVG Sanitization:** All SVGs automatically sanitized (svg-hush)
   - Removes scripts, external references, tracking
   - Safe to serve directly as images

2. **Strip metadata for privacy:** Use `metadata=none` for sensitive images
   - Removes EXIF (GPS location, camera info, timestamps)
   - Removes Content Credentials if not required

3. **Use signed URLs for access control** (paid plan feature)
   - Prevents direct URL guessing/enumeration
   - Note: Incompatible with flexible variants

4. **Control origin access:** Restrict transformations to specific domains
   - Prevents unauthorized third-party image optimization
   - Implemented via origin validation rules

### Cost Management

1. **Monitor unique transformations** carefully
   - Each width×height combination = 1 unit
   - Each fit mode variation = 1 unit
   - Track monthly usage to stay within budget

2. **Use Free plan for remote images**
   - 5,000 transformations/month is substantial
   - Perfect for CDN + remote image optimization
   - No storage or delivery charges

3. **Combine R2 + Images strategically**
   - Store originals in R2 (cheap storage: $0.015/GB)
   - Transform on-demand via Images
   - More flexible than storing pre-resized variants

4. **Avoid `compression=fast` unless necessary**
   - Only for uncacheable, dynamically-generated images
   - Increases file size; reduces quality
   - Better to pre-compute or use cdn cache

### Workers Integration

1. **Use high-fidelity mode for testing**
   ```bash
   npx wrangler dev  # Full feature support
   ```

2. **Test with low-fidelity in CI/CD**
   ```bash
   npx wrangler dev --experimental-images-local-mode  # Faster, offline
   ```

3. **Chain transformations efficiently**
   - Group related transforms together
   - Order: trim → rotate → resize → effects
   - Each `.transform()` call adds processing time

4. **Handle pipeline errors gracefully**
   - Image transformation has CPU/memory limits
   - Implement fallbacks for oversized/complex images
   - Return original on error if possible

---

## Considerations and Trade-offs

### Storage Location Decisions

| Choice | Pros | Cons | Best For |
|--------|------|------|----------|
| **Cloudflare Images** | Native API, no egress fees, unified | Monthly storage cost, vendor lock-in | Small catalogs, native Cloudflare apps |
| **R2 + Images** | Cheaper storage, independent, multi-vendor | Requires orchestration, manage two services | Large catalogs, cost-sensitive operations |
| **Remote (S3/self-hosted)** | Complete independence, free transforms | Manual URL building, complex setup | Existing infrastructure, multi-cloud |

### Feature Availability by Method

| Feature | URL API | Workers Fetch | Workers Binding |
|---------|---------|---------------|-----------------|
| Basic resize | ✓ | ✓ | ✓ |
| Format conversion | ✓ | ✓ | ✓ |
| Face detection | ✓ | ✓ | ✓ |
| Subject segmentation | ✓ | ✓ | ✓ |
| Overlay/watermark | ✗ | Limited | ✓ Full |
| Flexible variants | ✓ | ✓ | ✓ |
| Signed URLs | ✗ | ✗ | ✗ |
| Direct R2 input | ✗ | ✗ | ✓ |

### Limitations

1. **SVG files:** Not resizable (inherently scalable); sanitization only
2. **Flexible variants + signed URLs:** Incompatible combination
3. **Face zoom fallback:** Defaults to image center if no faces detected
4. **Sourcing Kit:** Only works with non-archival S3 storage classes
5. **GIF animations:** Limited to 50 megapixels total (all frames combined)
6. **AVIF encoding:** Slow; automatic fallback to WebP/JPEG for large images

### Performance Trade-offs

| Decision | Benefit | Cost | When to Use |
|----------|---------|------|------------|
| **format=auto** | Optimal delivery | Browser detection overhead | Always, for modern sites |
| **compression=fast** | Faster response | Larger file size, lower quality | Uncacheable dynamic images only |
| **Preserve metadata** | Useful for photographers | Slightly larger files, privacy concerns | Professional photography only |
| **Draw operations** | On-the-fly watermarking | CPU time cost | Uncached images; batch pre-compute for cached |
| **High-quality AVIF** | Best compression | Slow encoding, fallback risk | Mobile; bandwidth-constrained |

### Billing Considerations

**Free Plan Cliff:**
- 5,000 unique transformations included
- Excess requests return 9422 error (not billed, but not served)
- No partial month carryover

**30-Day Rolling Window:**
- Transformation counted only once per 30 days
- Resets daily as sliding window moves forward
- Example: `width=100/image.jpg` on June 30 + July 1 = 1 unit (not 2)

---

## Code Examples & Integration Patterns

### Example 1: Responsive Product Gallery
```html
<ul class="product-gallery">
  <li>
    <picture>
      <source 
        media="(min-width: 1024px)"
        srcset="
          /cdn-cgi/image/width=400,format=auto,quality=85/product.jpg 1x,
          /cdn-cgi/image/width=400,format=auto,quality=85,dpr=2/product.jpg 2x
        "
      />
      <source
        media="(min-width: 640px)"
        srcset="
          /cdn-cgi/image/width=300,format=auto,quality=80/product.jpg 1x,
          /cdn-cgi/image/width=300,format=auto,quality=80,dpr=2/product.jpg 2x
        "
      />
      <img 
        src="/cdn-cgi/image/width=200,format=auto,quality=75/product.jpg"
        alt="Product"
      />
    </picture>
  </li>
</ul>
```

### Example 2: Face-Centric Image Optimization
```javascript
// Auto-crop group photo toward detected faces
const imageUrl = 'https://example.com/group.jpg';
const transformed = `/cdn-cgi/image/width=600,height=400,fit=cover,gravity=face,zoom=0.2/`
  + imageUrl;

// Returns 600x400 crop focused on faces with minimal zoom
// Falls back to center crop if no faces detected
document.getElementById('photo').src = transformed;
```

### Example 3: Complete R2 + Watermark Workflow
```typescript
export default {
  async fetch(request, env) {
    if (request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('image');
        
        if (!file || typeof file.arrayBuffer !== 'function') {
          return new Response('No image file provided', { status: 400 });
        }
        
        // Read uploaded image
        const fileBuffer = await file.arrayBuffer();
        
        // Fetch watermark from Worker Assets
        let watermarkStream = (
          await env.ASSETS.fetch(new URL('/watermark.png', request.url))
        ).body;
        
        // Apply watermark and convert to AVIF
        const imageResponse = await env.IMAGES
          .input(fileBuffer)
          .draw(env.IMAGES.input(watermarkStream)
            .transform({ width: 100, height: 100 }), {
              bottom: 10,
              right: 10,
              opacity: 0.75
            })
          .output({ format: 'image/avif' })
          .response();
        
        // Add timestamp to filename
        const fileName = `image-${Date.now()}.avif`;
        
        // Upload to R2
        await env.R2.put(fileName, imageResponse.body);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            fileName: fileName 
          }),
          { 
            headers: { 'Content-Type': 'application/json' },
            status: 200
          }
        );
      } catch (err) {
        console.error(err.message);
        return new Response(JSON.stringify({ error: err.message }), 
          { status: 500 });
      }
    }
    
    return new Response('Method not allowed', { status: 405 });
  }
};
```

### Example 4: Subject Segmentation for E-commerce
```javascript
// Auto-remove product background
const productImageUrl = 'https://cdn.example.com/products/chair.jpg';

const segmentedUrl = `/cdn-cgi/image/segment=foreground,width=500,format=webp,quality=90/` 
  + productImageUrl;

// Returns product with transparent background, optimized for web
document.getElementById('productImage').src = segmentedUrl;
```

### Example 5: Smart Format Selection in Workers
```typescript
export default {
  async fetch(request, env) {
    const imageUrl = 'https://origin.example.com/image.jpg';
    const accept = request.headers.get('accept') || '';
    
    let format = 'webp';
    if (/image\/avif/.test(accept)) {
      format = 'avif';
    } else if (!/image\/webp/.test(accept)) {
      format = 'jpeg';
    }
    
    return fetch(imageUrl, {
      cf: {
        image: {
          format: format,
          width: 800,
          height: 600,
          fit: 'cover',
          gravity: 'auto',
          quality: 85
        }
      }
    });
  }
};
```

### Example 6: Batch Image Transformation
```typescript
async function transformImages(env, imageUrls) {
  const transforms = imageUrls.map(async (url) => {
    const response = await fetch(url);
    
    const optimized = await env.IMAGES
      .input(response.body)
      .transform({ width: 800, quality: 75 })
      .output({ format: 'image/webp' })
      .response();
    
    return optimized;
  });
  
  return Promise.all(transforms);
}
```

---

## Pricing Model Breakdown (October 2025)

### Free Plan Economics
```
Scenario: E-commerce with 1,000 products, 5 thumbnail sizes
Transformations: 1,000 × 5 = 5,000 unique/month
Cost: $0 (all included in free tier)
```

### Paid Plan Examples

**Example 1: Small Product Catalog**
```
Products: 100
Variants per product: 3 (thumbnail, medium, large)
Monthly views: 10,000
Deliveries per view: 1 average image

Transformations: 100 × 3 = 300 unique
Delivered: 100 × 3 × 10,000 = 3,000,000
Cost: $0 (transformations) + $3.00 (deliveries) = $3.00
```

**Example 2: R2 + Images Combination**
```
Images stored: 5,000
Sizes per image: 1MB average
Variants per image: 3 (different sizes)
Monthly deliveries: 100,000

R2 Storage: 5,000 × 1MB = 5GB → $0.08/month (R2)
R2 Operations: 5,000 writes + 15,000 reads → ~$0.05 (R2)
Transformations: 5,000 × 3 = 15,000 → $5.00 (excess: 5,000+10,000)
Delivered: 100,000 images → $0.10
Total: ~$5.23/month
```

**Example 3: High-Volume Content Site**
```
Remote images optimized: 10,000 unique
Each image: 10 different transformations (sizes/formats)
Cost: (10,000 × 10 - 5,000 included) × $0.50/1,000 = $47.50/month
```

### Billing Timeline
- Free plan: Counts all 30 days of month
- Paid plan: 30-day rolling window (resets daily)
- Invoice: Generated monthly on regular billing date

---

## References

### Official Documentation (Most Current)

1. **Cloudflare Images Overview** - https://developers.cloudflare.com/images/ (Aug 6, 2025)
2. **Transform via URL** - https://developers.cloudflare.com/images/transform-images/transform-via-url/ (Aug 28, 2025)
3. **Transform via Workers** - https://developers.cloudflare.com/images/transform-images/transform-via-workers/ (Aug 28, 2025)
4. **Images Binding** - https://developers.cloudflare.com/images/transform-images/bindings/ (Jul 24, 2025)
5. **Draw Overlays & Watermarks** - https://developers.cloudflare.com/images/transform-images/draw-overlays/ (Apr 7, 2025)
6. **Pricing** - https://developers.cloudflare.com/images/pricing/ (Aug 7, 2025)
7. **Transform Overview** - https://developers.cloudflare.com/images/transform-images/ (Oct 2, 2025)
8. **Flexible Variants** - https://developers.cloudflare.com/images/manage-images/enable-flexible-variants/ (Sep 5, 2025)
9. **Preserve Content Credentials** - https://developers.cloudflare.com/images/transform-images/preserve-content-credentials/ (Feb 3, 2025)
10. **Sourcing Kit (Beta)** - https://developers.cloudflare.com/images/upload-images/sourcing-kit/ (Aug 15, 2024)
11. **Transform User-Uploaded Images to R2** - https://developers.cloudflare.com/images/tutorials/optimize-user-uploaded-image/ (Apr 28, 2025)
12. **Changelog** - https://developers.cloudflare.com/images/platform/changelog/ (Feb 13, 2025)
13. **Cloudflare Workers API** - https://developers.cloudflare.com/workers/runtime-apis/bindings/ (Aug 2025)
14. **Images API Reference** - https://developers.cloudflare.com/api/resources/images/

### Blog Posts & Announcements

1. **Image Optimization Merge** - https://blog.cloudflare.com/merging-images-and-image-resizing/ (Nov 15, 2023)
2. **Workers Tracing Beta** - https://blog.cloudflare.com/workers-tracing-now-in-open-beta/ (Oct 28, 2025)

### Community & Support

- **Community Forum**: https://community.cloudflare.com/c/developers/images/63
- **Discord**: discord.cloudflare.com
- **Closed Beta Programs**: Application forms for face cropping, Sourcing Kit

---

**Document Status**: Comprehensive research completed October 30, 2025  
**Confidence Level**: High (official documentation sourced)  
**Last Verified**: October 30, 2025  
**Maintenance**: Recommend quarterly review for new features and pricing updates
