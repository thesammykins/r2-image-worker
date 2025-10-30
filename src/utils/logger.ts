export function logUpload(r2Key: string, isDuplicate: boolean, urlType: string): void {
  const duplicateStatus = isDuplicate ? 'duplicate' : 'new upload'
  console.log(`Returning ${urlType} (${duplicateStatus}): ${r2Key}`)
}

export function logError(error: Error, context: string): void {
  console.error(`Error in ${context}:`, error.message)
}
