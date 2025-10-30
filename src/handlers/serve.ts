import type { Context } from 'hono'
import type { Bindings } from './types'

export async function handleServe(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const type = c.req.param('type')
  const key = c.req.param('key')

  const r2Key = `${type}/${key}`

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
}
