// ── LACĂT: POZA VIZITATORULUI SE ȘI SCRIE, NU DOAR SE AFIȘEAZĂ (P3) ─────────
// (owner, 15 aug: „vizitatori nu au poza conform cerintei softului... de ce nu
// e legata de vizitator poza")
//
// MĂSURAT înainte de reparație: coloana `visits.photo_url` exista din 13 aug,
// panoul o afișa (visitor-thumb) — dar NICIUN drum de cod n-o scria vreodată.
// Un raport care promite poza și n-o alimentează e decorațiune, nu măsurare.
//
// Lanțul apărat aici, verigă cu verigă (consimțământul e temelia — ordinul din
// 13 aug: „cine va fi acolo va avea o poză cu acceptul lor"):
//   cameră ACORDATĂ (CameraView) → un cadru mic pe sesiune (vizita.ts)
//   → POST /api/visit/poza validat strict (demo.ts) → attachVisitPhoto scrie
//   DOAR peste gol (prima poză rămâne) → lista din admin leagă și poza
//   CONTULUI (faceprints) pentru vizitele logate. Boții nu pornesc camera —
//   rămân cinstit fără poză, prin construcție.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

describe('poza vizitatorului: lanțul întreg, verigă cu verigă', () => {
  it('attachVisitPhoto scrie DOAR peste gol — prima poză a vizitei rămâne', () => {
    const db = citeste('db.ts')
    expect(db).toMatch(/attachVisitPhoto[\s\S]{0,600}?UPDATE visits SET photo_url = \$3\s*\n\s*WHERE photo_url = ''/)
  })

  it('ruta publică validează strict: doar data-URL de imagine, plafonat', () => {
    const demo = citeste('routes/demo.ts')
    expect(demo).toMatch(/\/api\/visit\/poza/)
    expect(demo).toMatch(/data:image\\\/\(jpeg\|png\|webp\);base64,/)
    expect(demo).toMatch(/poza\.length > 200_000/)
  })

  it('lista din admin leagă poza CONTULUI (faceprints) pentru vizitele logate', () => {
    const db = citeste('db.ts')
    // P25 + auditul din 15 aug seara: poza contului vine prin LATERAL pe
    // emailul omului calculat CU lower() — faceprints e scris DOAR lowercase,
    // emailul vizitei intră verbatim de la Google; join-ul brut rata omul
    // (dispărea din raport, numărat fals la faraPoza).
    expect(db).toMatch(/SELECT f\.photo FROM faceprints f\s*\n\s*WHERE f\.user_email = l\.email_omului AND f\.photo <> '' LIMIT 1/)
    expect(db).toMatch(/COALESCE\(NULLIF\(lower\(o\.user_email\), ''\), o\.email_amprentei\) AS email_omului/)
  })

  it('cadrul pleacă DOAR după camera acordată (CameraView) și o dată pe sesiune (vizita.ts)', () => {
    const camera = citeste('../../frontend/src/components/CameraView.tsx')
    expect(camera).toMatch(/raporteazaPozaVizitei\(videoRef\.current\)/)
    const vizita = citeste('../../frontend/src/lib/vizita.ts')
    expect(vizita).toMatch(/kelion_vizita_poza/)
    expect(vizita).toMatch(/fetch\('\/api\/visit\/poza'/)
  })
})
