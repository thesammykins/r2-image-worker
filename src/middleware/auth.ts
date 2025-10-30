import type { Context, Next } from 'hono'
import { AuthenticationError } from '../errors/AppError'
import type { Bindings } from '../handlers/types'

export async function authMiddleware(c: Context<{ Bindings: Bindings }>, next: Next): Promise<Response | void> {
  const providedKey = c.req.header('X-Auth-Key')
  const expectedKey = c.env.AUTH_KEY

  if (!providedKey || providedKey !== expectedKey) {
    const error = new AuthenticationError()
    return c.text(error.message, error.statusCode)
  }

  await next()
}
