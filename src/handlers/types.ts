export type Bindings = {
  BUCKET: R2Bucket
  AUTH_KEY: string
  IMAGE_HOSTNAME?: string
  FILES_HOSTNAME?: string
  UPLOAD_HOSTNAME?: string
}

export interface FileMetadata {
  originalHash: string
  originalFilename: string
  uploadTimestamp: number
  mimeType: string
}

export interface UploadFormData {
  file?: File
  filename?: string
  url_preference?: string
}
