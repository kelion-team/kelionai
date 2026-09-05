import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')
const stage = citeste('../../frontend/src/pages/Stage.tsx')

const DOVEZI: Record<string, { fisier: string; semnatura: RegExp }> = {
  '✉️ Gmail': { fisier: 'services/google.ts', semnatura: /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/ },
  '📅 Calendar': { fisier: 'services/google.ts', semnatura: /googleapis\.com\/calendar\/v3\/calendars\/primary\/events/ },
  '📁 Drive': { fisier: 'services/google.ts', semnatura: /googleapis\.com\/drive\/v3\/files/ },
  '📝 Docs': { fisier: 'services/google.ts', semnatura: /docs\.googleapis\.com\/v1\/documents/ },
  '📊 Sheets': { fisier: 'services/google.ts', semnatura: /sheets\.googleapis\.com\/v4\/spreadsheets/ },
  '✅ Tasks': { fisier: 'services/google.ts', semnatura: /tasks\.googleapis\.com\/tasks\/v1\/lists/ },
  '🗺 Hărți': { fisier: 'routes/mapview.ts', semnatura: /\/api\/route|tile/i },
  '🔎 Căutare': { fisier: 'services/google.ts', semnatura: /name: 'web_search'/ },
  '▶️ YouTube': { fisier: 'services/google.ts', semnatura: /name: 'youtube_search'/ },
  '🎨 Imagini': { fisier: 'services/image.ts', semnatura: /apiBaseUrl}\/images\/generations/ },
  '📽 Prezentări': { fisier: 'services/google.ts', semnatura: /slides\.googleapis\.com\/v1\/presentations/ },
  '📹 Meet': { fisier: 'services/google.ts', semnatura: /conferenceDataVersion/ },
  '📋 Formulare': { fisier: 'services/google.ts', semnatura: /forms\.googleapis\.com\/v1\/forms/ },
  '📷 Photos': { fisier: 'services/googlePhotos.ts', semnatura: /photospicker\.googleapis\.com\/v1/ },
  '▶️ YouTube upload': { fisier: 'services/googleYouTube.ts', semnatura: /upload\/youtube\/v3\/videos/ },
  '🏪 Profilul firmei': { fisier: 'services/googleBusiness.ts', semnatura: /mybusinessaccountmanagement\.googleapis\.com/ },
}

describe('lanțul aplicațiilor din meniu', () => {
  it('meniul retras nu mai expune vechile oferte', () => {
    expect(stage).not.toContain('apps-wrap')
  })

  it('fiecare integrare păstrează executorul real', () => {
    for (const [eticheta, dovada] of Object.entries(DOVEZI)) {
      const sursa = citeste(dovada.fisier)
      expect(
        dovada.semnatura.test(sursa),
        `${eticheta}: executorul lipsește din ${dovada.fisier}`,
      ).toBe(true)
    }
  })

  it('loginul cere doar identitate, iar capabilitățile cer consimțământ incremental', () => {
    const auth = citeste('routes/auth.ts')
    expect(auth).toContain("const IDENTITY_SCOPES = ['openid', 'email', 'profile']")
    for (const capability of [
      'gmail_read', 'gmail_send', 'calendar', 'drive', 'docs', 'sheets',
      'slides', 'forms', 'tasks', 'photos', 'youtube', 'business',
    ]) {
      expect(auth, `capabilitate OAuth lipsă: ${capability}`).toMatch(new RegExp(`\\b${capability}: \\[`))
    }
    expect(auth).toContain("capabilityScopes(String(req.query?.capability ?? ''))")
  })
})
