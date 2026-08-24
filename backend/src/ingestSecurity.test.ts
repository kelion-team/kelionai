import { describe, expect, it } from 'vitest'
import { decodeDocumentUpload } from './routes/ingest.js'

describe('validarea uploadului de documente', () => {
  it('respinge base64 tolerant/corupt, filename traversal și extensii nepermise', () => {
    expect(decodeDocumentUpload('%%%invalid%%%', 'a.pdf')).toMatchObject({ ok: false, error: 'base64_invalid' })
    expect(decodeDocumentUpload(Buffer.from('%PDF-x').toString('base64'), '../a.pdf')).toMatchObject({ ok: false, error: 'filename_invalid' })
    expect(decodeDocumentUpload(Buffer.from('12345678').toString('base64'), 'a.html')).toMatchObject({ ok: false, error: 'tip_neacceptat' })
  })

  it('verifică magic bytes, nu doar extensia declarată', () => {
    expect(decodeDocumentUpload(Buffer.from('not a pdf').toString('base64'), 'a.pdf')).toMatchObject({ ok: false, error: 'continut_invalid' })
    expect(decodeDocumentUpload(Buffer.from('PK\x03\x04fake').toString('base64'), 'a.docx')).toMatchObject({ ok: false, error: 'arhiva_invalida' })
  })

  it('acceptă PDF și text finite cu conținut compatibil', () => {
    const pdf = Buffer.from('%PDF-1.7\nbody')
    const text = Buffer.from('rând valid')
    expect(decodeDocumentUpload(pdf.toString('base64'), 'doc.pdf')).toMatchObject({ ok: true, filename: 'doc.pdf' })
    expect(decodeDocumentUpload(`data:text/plain;base64,${text.toString('base64')}`, 'doc.txt')).toMatchObject({ ok: true, filename: 'doc.txt' })
  })
})
