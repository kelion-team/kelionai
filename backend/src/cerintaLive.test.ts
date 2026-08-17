// ── LACĂT: VERDICTUL PROBEI PE LIVE AJUNGE LA OM (P4) ───────────────────────
// (owner, 15 aug — bucla închisă: „cerința #N e LIVE / a murit" în panou și pe
// telefon, nu doar o literă schimbată în coloana de stare.)
//
// verificaLivrata() (autonomie.ts) era singurul martor al verdictului: muta
// starea în tabel și atât — ownerul afla că o cerință a picat proba abia când
// se lovea de ea. Acum AMBELE tranziții anunță prin notifyAdmin, care duce
// mesajul și în panou (admin_notifications) și pe telefon (pushTelefon,
// cablat în notifyAdmin din #1158). Lacătul ține ambele verigi.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

describe('bucla închisă a cerințelor: verdictul se spune, nu doar se scrie', () => {
  it('VERIFICATĂ pe live → notifyAdmin(cerinta_live), lipit de trecerea pe „verificata"', () => {
    const autonomie = citeste('services/autonomie.ts')
    expect(autonomie).toMatch(
      /stare: 'verificata'[\s\S]{0,600}?notifyAdmin\('cerinta_live', `Cerința #\$\{c\.id\} e LIVE`/,
    )
  })

  it('proba PICATĂ → notifyAdmin(cerinta_picata), lipit de întoarcerea la lucru', () => {
    const autonomie = citeste('services/autonomie.ts')
    expect(autonomie).toMatch(
      /stare: 'analizata'[\s\S]{0,600}?notifyAdmin\('cerinta_picata', `Cerința #\$\{c\.id\} a picat proba pe live`/,
    )
  })

  it('tipurile noi există în uniunea notificărilor (altfel tsc tace și apelul moare la rulare)', () => {
    const tipuri = citeste('services/adminNotification.ts')
    expect(tipuri).toMatch(/\| 'cerinta_live'/)
    expect(tipuri).toMatch(/\| 'cerinta_picata'/)
  })
})
