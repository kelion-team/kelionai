import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { documentFramePolicy, embedPolicy } from './lib/workspace'

const aici = dirname(fileURLToPath(import.meta.url))

describe('workspace iframe allowlist', () => {
  it('allows only the fixed same-origin application surfaces', () => {
    expect(embedPolicy('/api/route?punct=44,26', 'map')?.src).toContain('/api/route')
    expect(embedPolicy('/api/tranzactii', 'tranzactii')?.src).toBe('/api/tranzactii')
    expect(embedPolicy('/api/admin', 'web')).toBeNull()
    expect(embedPolicy('/api/route', 'web')).toBeNull()
  })

  it('normalizes and allows known external embed endpoints', () => {
    expect(embedPolicy('https://youtu.be/dQw4w9WgXcQ', 'youtube')?.src).toContain(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
    expect(embedPolicy('https://embed.waze.com/iframe?zoom=13', 'map')).not.toBeNull()
    expect(embedPolicy('https://embed.windy.com/embed2.html?lat=44', 'weather')).not.toBeNull()
    expect(
      embedPolicy('https://www.openstreetmap.org/export/embed.html?bbox=1,2,3,4', 'map'),
    ).not.toBeNull()
  })

  it('rejects arbitrary, misleading and active-content URLs', () => {
    expect(embedPolicy('https://example.com', 'web')).toBeNull()
    expect(embedPolicy('https://youtube.com.evil.test/embed/dQw4w9WgXcQ', 'youtube')).toBeNull()
    expect(embedPolicy('https://www.youtube.com.evil.test/embed/dQw4w9WgXcQ', 'youtube')).toBeNull()
    expect(embedPolicy('javascript:alert(1)', 'web')).toBeNull()
    expect(embedPolicy('data:text/html,<script>alert(1)</script>', 'web')).toBeNull()
  })
})

describe('workspace document iframe policy', () => {
  const base = 'https://kelionai.app'

  it('permite PDF local fără capabilități de script', () => {
    expect(documentFramePolicy('/fisiere/raport.pdf', 'pdf', base)).toEqual({
      src: '/fisiere/raport.pdf',
      sandbox: '',
    })
  })

  it('refuză un URL extern deghizat ca PDF', () => {
    expect(documentFramePolicy('https://evil.test/fisier.pdf', 'pdf', base)).toBeNull()
    expect(documentFramePolicy('https://kelionai.app/fisier.html?x=.pdf', 'pdf', base)).toBeNull()
  })

  it('nu divulgă documentele Office unui viewer extern', () => {
    expect(documentFramePolicy('https://kelionai.app/fisiere/cv.docx', 'office', base)).toBeNull()
    expect(documentFramePolicy('https://evil.test/cv.docx', 'office', base)).toBeNull()
    expect(documentFramePolicy('http://kelionai.app/cv.docx', 'office', base)).toBeNull()
  })
})

describe('server-side page reader contract', () => {
  it('sends the target URL only in a POST JSON body', () => {
    const stage = readFileSync(join(aici, 'pages/Stage.tsx'), 'utf8')
    expect(stage).toContain("apiFetch('/api/citeste-pagina', {")
    expect(stage).toMatch(/method: 'POST'[\s\S]{0,160}Content-Type': 'application\/json'[\s\S]{0,160}JSON\.stringify\(\{ url \}\)/)
    expect(stage).not.toMatch(/citeste-pagina\?url|encodeURIComponent\(url\)/)
  })
})
