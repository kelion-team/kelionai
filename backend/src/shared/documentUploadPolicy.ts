export const DOCUMENT_UPLOAD_LIMITS = Object.freeze({
  requestBodyBytes: 30_000_000,
  documentBytes: 20 * 1024 * 1024,
  archiveBytes: 10 * 1024 * 1024,
})

const ARCHIVE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.csv'])

/** One upload-size contract shared by browser preflight and server validation. */
export function documentUploadMaxBytes(filename: string): number | null {
  const ext = /\.[a-z0-9]+$/i.exec(filename.trim())?.[0].toLowerCase() ?? ''
  if (ARCHIVE_EXTENSIONS.has(ext)) return DOCUMENT_UPLOAD_LIMITS.archiveBytes
  if (DOCUMENT_EXTENSIONS.has(ext)) return DOCUMENT_UPLOAD_LIMITS.documentBytes
  return null
}
