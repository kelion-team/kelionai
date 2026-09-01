import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const src = (p: string): string => fs.readFileSync(new URL(`./${p}`, import.meta.url), 'utf8')

// ── GARDURILE PE RUTE ────────────────────────────────────────────────────────
// Verdictul e probat mai sus pe cifre; aici se ține DRUMUL: ruta chiar citește
// pașii și chiar dă un status de eșec. Fără gardul ăsta, cineva poate reintroduce
// `return { ok: true }` fără să pice nimic.

describe('rutele care scriu nu mai răspund 2xx peste un eșec', () => {
  const admin = src('routes/admin.ts')
  const voiceprint = src('routes/voiceprint.ts')
  const tranzactii = src('routes/tranzactii.ts')

  /** Corpul unei rute, decupat din sursă.
   *
   *  PRIMA VARIANTĂ CĂUTA ȘIRUL ADRESEI — și l-a găsit unde nu trebuia: în
   *  `routes/tranzactii.ts` adresa apare ÎNTÂI în pagina HTML pe care o
   *  servește fișierul (un `fetch('/api/tranzactii/analiza')` scris în
   *  template), abia pe urmă în ruta reală. Deci testul citea pagina, nu
   *  handlerul, și pica pe cod corect. Al treilea gard de-al meu care se
   *  înșală (după cel tăiat la cuvântul „break" din comentariu) — de-aia acum
   *  se cere ÎNREGISTRAREA rutei, nu adresa singură. */
  const handler = (sursa: string, metoda: string, cale: string): string => {
    const inregistrare = new RegExp(`app\\.${metoda}\\s*(?:<[\\s\\S]{0,3000}?>)?\\s*\\(\\s*'${cale}'`)
    const m = inregistrare.exec(sursa)
    expect(m, `n-am găsit înregistrarea ${metoda.toUpperCase()} ${cale} — testul s-ar fi făcut că verifică`).toBeTruthy()
    // Până la începutul următoarei rute înregistrate, ca să nu citim din vecin.
    const rest = sursa.slice((m as RegExpExecArray).index + (m as RegExpExecArray)[0].length)
    const pana = rest.search(/\n {2}app\.(get|post|put|patch|delete)\b/)
    return pana === -1 ? rest : rest.slice(0, pana)
  }

  it('reset-counters dă 502 când ștergerea n-a avut loc', () => {
    const h = handler(admin, 'post', '/api/admin/reset-counters')
    expect(/if \(!r\.ok\)/.test(h), 'rezultatul ștergerii nu mai e verificat').toBe(true)
    expect(/reply\.code\(502\)/.test(h)).toBe(true)
  })

  it('revocarea voiceprint-ului șterge numai datele utilizatorului autentificat', () => {
    const h = handler(voiceprint, 'delete', '/api/voiceprint/me')
    expect(/getSessionUser\(req\)/.test(h)).toBe(true)
    expect(/deleteVoiceprint\(user\.email\)/.test(h)).toBe(true)
    expect(/reply\.send\(\{ ok: true, deleted \}\)/.test(h)).toBe(true)
  })

  it('analiza de piață nu mai întoarce 200 cu {error}', () => {
    const h = handler(tranzactii, 'post', '/api/tranzactii/analiza')
    expect(/reply\.code\(502\)/.test(h), 'piața necitibilă / agentul mut ieșeau cu 200').toBe(true)
    expect(/reply\.code\(503\)/.test(h), 'agentul lipsă din roster ieșea cu 200').toBe(true)
  })
})
