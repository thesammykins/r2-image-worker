import { createHash } from 'node:crypto'

export async function sha256Hash(data: Uint8Array): Promise<string> {
  const hash = createHash('sha256')
  hash.update(data)
  return hash.digest('hex')
}
