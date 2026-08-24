import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_UPLOAD_LIMITS,
  documentUploadMaxBytes,
} from '../../backend/src/shared/documentUploadPolicy'

describe('document upload contract shared with the backend', () => {
  it('uses the bounded server limits for browser preflight', () => {
    expect(documentUploadMaxBytes('report.pdf')).toBe(20 * 1024 * 1024)
    expect(documentUploadMaxBytes('report.txt')).toBe(20 * 1024 * 1024)
    expect(documentUploadMaxBytes('report.docx')).toBe(10 * 1024 * 1024)
    expect(documentUploadMaxBytes('report.xlsx')).toBe(10 * 1024 * 1024)
    expect(documentUploadMaxBytes('report.exe')).toBeNull()
    expect(DOCUMENT_UPLOAD_LIMITS.requestBodyBytes).toBe(30_000_000)
  })
})
