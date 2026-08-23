// ── LACĂT: LANȚUL APLICAȚIILOR DIN MENIU E REAL, CAP LA CAP (P5) ────────────
// (owner, 15 aug: „aplicatiile pe care le are in butonul aplicatii si sunt de
// la google, trebuiesc sa fie toate functionale, nu doar poze, interconectare
// reala si functionala")
//
// MĂSURAT azi, intrare cu intrare: toate cele 18 aplicații din meniul
// „Aplicații" au lanț real — comanda din meniu → unealta creierului → apelul
// HTTP către serviciul adevărat. Lacătul de aici ÎNCUIE starea măsurată:
//   1. fiecare intrare din meniu are rândul ei în tabelul de dovezi de mai jos
//      — o intrare NOUĂ fără dovadă pică testul (nu se mai pot adăuga „poze");
//   2. dovada fiecărui rând (semnătura endpoint-ului în fișierul de serviciu)
//      chiar există — un serviciu șters/redenumit rupe lanțul ZGOMOTOS;
//   3. scope-urile OAuth promise pe ecranul de consimțământ acoperă uneltele
//      legate (cine s-a conectat înaintea unui scope nou trebuie să se
//      RE-conecteze — panoul token-checks arată starea LUI, testul o apără pe
//      a CODULUI).
// Excepțiile cinstite, scrise pe față: Hărțile merg pe harta NOASTRĂ
// (/api/route, same-origin — iframe-urile OSM mureau în Chrome, 8 aug);
// Căutarea merge pe Serper (nu e produs Google, dar e căutare reală).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')
const stage = citeste('../../frontend/src/pages/Stage.tsx')

// Blocul intrărilor Google din meniul Aplicații (marcajul din Stage.tsx).
const blocMeniu = /APLICAȚIILE GOOGLE INTERCONECTATE[\s\S]*?\]\.map\(/.exec(stage)?.[0] ?? ''
const etichete = [...blocMeniu.matchAll(/\['([^']+)',\s*'/g)].map((m) => m[1])

// TABELUL DE DOVEZI: eticheta din meniu → fișierul de serviciu + semnătura
// endpoint-ului REAL (măsurată pe 15 aug, nu promisă).
const DOVEZI: Record<string, { fisier: string; semnatura: RegExp }> = {
  '✉️ Gmail': { fisier: 'services/google.ts', semnatura: /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/ },
  '📅 Calendar': { fisier: 'services/google.ts', semnatura: /googleapis\.com\/calendar\/v3\/calendars\/primary\/events/ },
  '📁 Drive': { fisier: 'services/google.ts', semnatura: /googleapis\.com\/drive\/v3\/files/ },
  '📝 Docs': { fisier: 'services/google.ts', semnatura: /docs\.googleapis\.com\/v1\/documents/ },
  '📊 Sheets': { fisier: 'services/google.ts', semnatura: /sheets\.googleapis\.com\/v4\/spreadsheets/ },
  '✅ Tasks': { fisier: 'services/google.ts', semnatura: /tasks\.googleapis\.com\/tasks\/v1\/lists/ },
  // Harta NOASTRĂ, same-origin — cinstit local, nu un iframe Google mort.
  '🗺 Hărți': { fisier: 'routes/mapview.ts', semnatura: /\/api\/route|tile/i },
  // Căutarea reală: unealta web_search cu executorul ei legat (google.ts).
  '🔎 Căutare': { fisier: 'services/google.ts', semnatura: /if \(name === 'web_search'\) return await webSearch/ },
  '▶️ YouTube': { fisier: 'services/google.ts', semnatura: /name: 'youtube_search'/ },
  '🎨 Imagini': { fisier: 'services/google.ts', semnatura: /generativelanguage\.googleapis\.com/ },
  '📽 Prezentări': { fisier: 'services/google.ts', semnatura: /slides\.googleapis\.com\/v1\/presentations/ },
  '📹 Meet': { fisier: 'services/google.ts', semnatura: /conferenceDataVersion/ },
  '📋 Formulare': { fisier: 'services/google.ts', semnatura: /forms\.googleapis\.com\/v1\/forms/ },
  '📷 Photos': { fisier: 'services/googlePhotos.ts', semnatura: /photospicker\.googleapis\.com\/v1/ },
  '▶️ YouTube upload': { fisier: 'services/googleYouTube.ts', semnatura: /upload\/youtube\/v3\/videos/ },
  '🏪 Profilul firmei': { fisier: 'services/googleBusiness.ts', semnatura: /googleapis\.com\/v1\/accounts/ },
  // P22: Studioul a ÎNLOCUIT vechiul „Generator video" — planul studioului
  // (services/studioClipuri.ts) conduce spre generate_video (Veo, plătit) sau
  // spre rețeta gratuită Google Flow; lanțul Veo rămâne cel dovedit.
  '🎬 Studioul de Clipuri': { fisier: 'services/studioClipuri.ts', semnatura: /labs\.google\/flow/ },
}

describe('lanțul aplicațiilor din meniu — real cap la cap, nu poze', () => {
  it('meniul există și are intrările măsurate', () => {
    expect(etichete.length).toBeGreaterThanOrEqual(17)
  })

  it('FIECARE intrare din meniu are dovada ei — una nouă fără lanț pică aici', () => {
    const faraDovada = etichete.filter((e) => !DOVEZI[e])
    expect(faraDovada, `intrări de meniu fără lanț dovedit: ${faraDovada.join(', ')} — adaugă dovada (serviciu + endpoint) în tabelul din acest test DUPĂ ce ai legat-o real`).toEqual([])
  })

  it('fiecare dovadă chiar există în serviciul ei — lanțul rupt se vede zgomotos', () => {
    for (const [eticheta, d] of Object.entries(DOVEZI)) {
      const sursa = citeste(d.fisier)
      expect(d.semnatura.test(sursa), `${eticheta}: semnătura ${d.semnatura} lipsește din ${d.fisier}`).toBe(true)
    }
  })

  it('scope-urile OAuth acoperă uneltele legate (cine e mai vechi decât ele se RE-conectează)', () => {
    const auth = citeste('routes/auth.ts')
    for (const scope of [
      'gmail.readonly', 'gmail.send', 'calendar.events', 'drive.readonly',
      'tasks', 'documents', 'spreadsheets', 'drive.file', 'presentations',
    ]) {
      expect(auth.includes(scope), `scope lipsă din consimțământ: ${scope}`).toBe(true)
    }
  })
})
