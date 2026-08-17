// ── LACĂT: UN SINGUR RÂND PE ADRESĂ + DEVICE-URILE DEDESUBT (P6) ────────────
// (owner, 15 aug: „nu se afiseaza de mai multe ori, daca intra cu aceiasi
// adresa de user, se pastreaza unica si se adauga doar device cu care intra
// cu datele aferente")
//
// MĂSURAT înainte: gruparea era pe `user_email` sensibil la MAJUSCULE (aceeași
// adresă scrisă altfel = rânduri separate; dovada că baza chiar are cazuri
// amestecate: căutarea de apel folosise deja lower() peste tot), iar sub listă
// stătea o listă PLATĂ de sesiuni care repeta același om de N ori — exact
// dublarea din captura ownerului. Lacătul ține forma nouă.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

describe('utilizatori unici pe email, cu device-urile lor', () => {
  it('agregarea pe user e pe lower(email) — majusculele nu mai fac dubluri', () => {
    const db = citeste('db.ts')
    expect(db).toMatch(/GROUP BY lower\(v\.user_email\)/)
    // și subinterogările (blocat/sold/consum) compară tot pe lower — altfel un
    // email cu majusculă pierde soldul/blocarea lui.
    expect(db).toMatch(/lower\(w\.user_email\) = MIN\(lower\(v\.user_email\)\)/)
    expect(db).toMatch(/lower\(b\.email\) = MIN\(lower\(v\.user_email\)\)/)
  })

  it('device-urile se agregă pe (adresă, device, browser) și se atașează userului', () => {
    const db = citeste('db.ts')
    expect(db).toMatch(/GROUP BY lower\(user_email\), device, browser/)
    expect(db).toMatch(/u\.devices = peEmail\.get\(u\.email\) \?\? \[\]/)
  })

  it('lista PLATĂ de sesiuni (același om de N ori) NU mai există', () => {
    const db = citeste('db.ts')
    expect(db).not.toMatch(/ORDER BY started_at DESC LIMIT 100/)
    const panou = citeste('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).not.toMatch(/activityData\.sessions/)
    // în locul ei: device-urile sub fiecare user
    expect(panou).toMatch(/u\.devices \?\? \[\]/)
  })
})
