import { createHash, randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { config } from '../config.js'
import { requestInternalService } from './internalServiceRequest.js'

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BYTES = 2_100_000
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
})

/**
 * Converts an untrusted document only through the isolated, no-network worker.
 * The web process never writes the document to disk or starts a parser.
 */
export async function documentToMarkdown(bytes: Buffer, filename: string, requestId: string = randomUUID()): Promise<string> {
  const safeName = String(filename ?? '').replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 120)
  const extension = extname(safeName).toLowerCase()
  const mime = MIME_BY_EXTENSION[extension]
  if (!safeName || !mime) throw new Error('converter_type_rejected')
  const maxBytes = ['.docx', '.xlsx', '.pptx'].includes(extension) ? MAX_ARCHIVE_BYTES : MAX_DOCUMENT_BYTES
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maxBytes) throw new Error('converter_size_rejected')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('converter_request_id_invalid')
  }

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const response = await requestInternalService({
    socketPath: config.converterWorker.socket,
    secret: config.converterWorker.secret,
    path: '/v1/convert',
    body: bytes,
    timeoutMs: 35_000,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    headers: {
      'content-type': mime,
      'x-request-id': requestId,
      'x-filename': safeName,
      'x-content-sha256': contentHash,
    },
  })
  if (response.status !== 200) throw new Error(`converter_rejected:${response.status}`)
  let decoded: unknown
  try {
    decoded = JSON.parse(response.body.toString('utf8'))
  } catch {
    throw new Error('converter_response_invalid')
  }
  const markdown = (decoded as { markdown?: unknown } | null)?.markdown
  if (typeof markdown !== 'string' || markdown.length > MAX_RESPONSE_BYTES) throw new Error('converter_response_invalid')
  return markdown.trim()
}
