import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  manualChrome,
  manualSectionsForAudience,
  resolveManualLanguage,
} from './lib/manualPolicy'

const here = dirname(fileURLToPath(import.meta.url))

describe('public manual audience and localisation', () => {
  const sections = [
    { title: 'Public help', paragraphs: ['safe'], audience: 'public' as const },
    { title: 'Worker setup', paragraphs: ['private'], audience: 'admin' as const },
    { title: '🔒 Doar admin — integrare retrasă', paragraphs: ['legacy'] },
  ]

  it('fails closed for admin chapters on the public route while preserving the admin view', () => {
    expect(manualSectionsForAudience(sections, false).map((s) => s.title)).toEqual([
      'Public help',
    ])
    expect(manualSectionsForAudience(sections, true)).toEqual(sections)
  })

  it('normalises the closed language list and localises every visible book control', () => {
    expect(resolveManualLanguage('RO')).toBe('ro')
    expect(resolveManualLanguage('unsupported')).toBe('en')
    expect(manualChrome('ro')).toMatchObject({
      searchLabel: 'Caută în manual',
      languageLabel: 'Limbă',
      download: 'Descarcă',
      previousPage: 'Pagina anterioară',
      nextPage: 'Pagina următoare',
    })
  })

  it('derives manual admin access only from the authenticated, online App session', () => {
    const app = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(app).toContain("<Manual isAdmin={!effectiveOffline && user?.role === 'admin'} />")
    expect(app).toContain('<Credits authenticated={!effectiveOffline && user !== null} />')
  })
})
