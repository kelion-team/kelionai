import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DOCUMENT_UPLOAD_LIMITS,
  documentUploadMaxBytes,
} from './shared/documentUploadPolicy.js'

const citeste = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

describe('plafonul unic de încărcare a documentelor', () => {
  it('limitează separat documentele și arhivele comprimate', () => {
    expect(documentUploadMaxBytes('contract.pdf')).toBe(DOCUMENT_UPLOAD_LIMITS.documentBytes)
    expect(documentUploadMaxBytes('date.csv')).toBe(DOCUMENT_UPLOAD_LIMITS.documentBytes)
    expect(documentUploadMaxBytes('raport.docx')).toBe(DOCUMENT_UPLOAD_LIMITS.archiveBytes)
    expect(documentUploadMaxBytes('executabil.exe')).toBeNull()
    expect(DOCUMENT_UPLOAD_LIMITS.archiveBytes).toBeLessThan(DOCUMENT_UPLOAD_LIMITS.documentBytes)
  })

  it('ruta folosește contractul comun și păstrează o limită de corp țintită', () => {
    const ingest = citeste('./routes/ingest.ts')
    expect(ingest).toContain("from '../shared/documentUploadPolicy.js'")
    expect(ingest).toContain('bodyLimit: DOCUMENT_UPLOAD_LIMITS.requestBodyBytes')
    expect(ingest).toContain('documentUploadMaxBytes(filename)')
  })

  it('browserul face preflight cu aceeași sursă înainte de FileReader', () => {
    const panel = citeste('../../frontend/src/components/ChatPanel.tsx')
    const inceput = panel.indexOf('async function addDocFiles')
    const fluxDocumente = panel.slice(inceput, panel.indexOf('\n  function ', inceput + 1))
    expect(panel).toContain("from '../../../backend/src/shared/documentUploadPolicy'")
    expect(inceput).toBeGreaterThanOrEqual(0)
    expect(fluxDocumente).toContain('documentUploadMaxBytes(name)')
    expect(fluxDocumente.indexOf('if (file.size > maxBytes)')).toBeLessThan(fluxDocumente.indexOf('const r = new FileReader()'))
  })
})
