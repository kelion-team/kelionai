import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { documentToMarkdown } from '../services/markitdown.js'
import { DOCUMENT_UPLOAD_LIMITS, documentUploadMaxBytes } from '../shared/documentUploadPolicy.js'

const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024 // hardcod-permis: plafon anti zip-bomb
const MAX_ZIP_ENTRIES = 2_000 // hardcod-permis: plafon anti zip-bomb
const MAX_COMPRESSION_RATIO = 200 // hardcod-permis: plafon anti zip-bomb

type DocumentValid = { ok: true; bytes: Buffer; filename: string } | { ok: false; error: string }

function inspecteazaOoxml(bytes: Buffer, ext: string): boolean {
  if (bytes.length < 22) return false
  const start = Math.max(0, bytes.length - 65_557)
  let eocd = -1
  for (let i = bytes.length - 22; i >= start; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) return false
  const entries = bytes.readUInt16LE(eocd + 10)
  const centralSize = bytes.readUInt32LE(eocd + 12)
  const centralOffset = bytes.readUInt32LE(eocd + 16)
  if (!entries || entries > MAX_ZIP_ENTRIES || centralOffset + centralSize > bytes.length) return false
  let offset = centralOffset
  let totalUncompressed = 0
  let hasContentTypes = false
  let hasAppFolder = false
  const folder = ext === '.docx' ? 'word/' : ext === '.xlsx' ? 'xl/' : 'ppt/'
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) return false
    const flags = bytes.readUInt16LE(offset + 8)
    const method = bytes.readUInt16LE(offset + 10)
    const compressed = bytes.readUInt32LE(offset + 20)
    const uncompressed = bytes.readUInt32LE(offset + 24)
    const nameLen = bytes.readUInt16LE(offset + 28)
    const extraLen = bytes.readUInt16LE(offset + 30)
    const commentLen = bytes.readUInt16LE(offset + 32)
    const end = offset + 46 + nameLen + extraLen + commentLen
    if (end > bytes.length || compressed === 0xffffffff || uncompressed === 0xffffffff || (flags & 1) !== 0 || ![0, 8].includes(method)) return false
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString('utf8').replace(/\\/g, '/')
    if (!name || name.includes('\0') || name.startsWith('/') || name.split('/').includes('..')) return false
    if (name === '[Content_Types].xml') hasContentTypes = true
    if (name.startsWith(folder)) hasAppFolder = true
    totalUncompressed += uncompressed
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) return false
    if (uncompressed > 0 && compressed === 0) return false
    if (compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO) return false
    offset = end
  }
  return hasContentTypes && hasAppFolder
}

export function decodeDocumentUpload(data: unknown, filenameRaw: unknown): DocumentValid {
  if (typeof data !== 'string' || !data) return { ok: false, error: 'no_file' }
  if (typeof filenameRaw !== 'string') return { ok: false, error: 'filename_invalid' }
  const filename = filenameRaw.trim()
  if (!filename || filename.length > 120 || filename.includes('\0') || /[\\/]/.test(filename)) return { ok: false, error: 'filename_invalid' }
  const ext = /\.[a-z0-9]+$/i.exec(filename)?.[0].toLowerCase() ?? ''
  const maxBytes = documentUploadMaxBytes(filename)
  if (maxBytes === null) return { ok: false, error: 'tip_neacceptat' }
  let b64 = data
  if (data.startsWith('data:')) {
    const match = /^data:(?:application\/(?:pdf|vnd\.openxmlformats-officedocument\.[a-z.-]+)|text\/(?:plain|markdown|csv));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(data)
    if (!match) return { ok: false, error: 'base64_invalid' }
    b64 = match[1]
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) return { ok: false, error: 'base64_invalid' }
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length < 8 || bytes.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) return { ok: false, error: 'base64_invalid' }
  if (bytes.length > maxBytes) return { ok: false, error: 'fisier_prea_mare' }
  if (ext === '.pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') return { ok: false, error: 'continut_invalid' }
  if (['.docx', '.xlsx', '.pptx'].includes(ext) && !inspecteazaOoxml(bytes, ext)) return { ok: false, error: 'arhiva_invalida' }
  if (['.txt', '.md', '.csv'].includes(ext) && bytes.includes(0)) return { ok: false, error: 'continut_invalid' }
  return { ok: true, bytes, filename }
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { filename?: string; data?: string } }>('/api/ingest', {
    bodyLimit: DOCUMENT_UPLOAD_LIMITS.requestBodyBytes,
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const validare = decodeDocumentUpload(req.body?.data, req.body?.filename)
    if (!validare.ok) return reply.code(validare.error === 'fisier_prea_mare' ? 413 : 400).send({ error: validare.error })
    try {
      const markdown = await documentToMarkdown(validare.bytes, validare.filename)
      return reply.send({ markdown: markdown.slice(0, 120_000) })
    } catch (error) {
      req.log.warn({ err: error instanceof Error ? error.message.slice(0, 200) : 'failed' }, 'document conversion failed')
      return reply.code(502).send({ error: 'convert_failed' })
    }
  })
}
