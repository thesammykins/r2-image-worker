import { Hono } from 'hono/quick'
import { cache } from 'hono/cache'
import { authMiddleware } from './middleware/auth'
import { handleUpload } from './handlers/upload'
import { handleServe } from './handlers/serve'
import { MAX_AGE } from './config'
import type { Bindings } from './handlers/types'

const app = new Hono<{ Bindings: Bindings }>()

app.put('/upload', authMiddleware, handleUpload)

app.get(
  '*',
  cache({
    cacheName: 'r2-media-worker',
    cacheControl: `public, max-age=${MAX_AGE}`
  })
)

app.get('/:type(images|videos|files)/:key', handleServe)

export default app
