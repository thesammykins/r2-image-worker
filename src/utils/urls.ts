import type { Bindings } from '../handlers/types'

export function buildBaseUrl(protocol: string, isImage: boolean, env: Bindings): string {
  const imageHost = env.IMAGE_HOSTNAME || 'images.localhost'
  const filesHost = env.FILES_HOSTNAME || 'files.localhost'
  const targetHost = isImage ? imageHost : filesHost
  return `${protocol}//${targetHost}`
}

export function buildDirectUrl(baseUrl: string, r2Key: string): string {
  return `${baseUrl}/${r2Key}`
}

export function buildTransformedUrl(baseUrl: string, r2Key: string, params: string): string {
  const sourceImageUrl = `${baseUrl}/${r2Key}`
  return `${baseUrl}/cdn-cgi/image/${params}/${sourceImageUrl}`
}
