// ── P10: CELE DOUĂ CIFRE SUSPECTE, LĂMURITE CU MĂSURĂTOARE ──────────────────
// (registrul P10: soldul £-1027.99 negativ la owner + plafonul „$0.00
// (măsurat)" — de unde vin și dacă citirea e reală sau o eroare-ca-fapt.)
//
// VERDICTUL MĂSURAT ÎN COD:
//   • Soldul negativ e REAL în tabel, dar ISTORIC: toate căile de debit de azi
//     îl scutesc pe owner (tarife.ts: „Ownerul e scutit peste tot";
//     vocalLive: role!=='admin'; chat: !isOwnerEmail) — deci datoria e
//     dinaintea scutirilor și nu se mai mișcă. Panoul o spune lângă cifră.
//   • Plafonul „$0.00 măsurat" avea DOUĂ găuri de regula #1: `catch → 0`
//     prezenta citirea PICATĂ drept măsurătoare, iar joburile fără cost
//     raportat (cost_usd NULL) făceau zeroul să pară „nu s-a cheltuit".
// Lacătele de aici țin reparațiile.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

describe('scutirea ownerului pe TOATE căile de debit — soldul lui nu se mai mișcă', () => {
  it('tarife: esteAdmin iese gratis înainte de orice debit', () => {
    expect(citeste('services/tarife.ts')).toMatch(/if \(esteAdmin\) return \{ ok: true, scazutGbp: 0/)
  })
  it('voce live + chat: debitul e gardat pe rol/owner', () => {
    expect(citeste('routes/vocalLive.ts')).toMatch(/if \(user\.role !== 'admin'\) void debitWallet/)
    const chat = citeste('routes/chat.ts')
    expect((chat.match(/!isOwnerEmail\(user\.email\)\) void debitWallet/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
  it('panoul spune adevărul lângă cifra istorică (scutit), nu o ascunde', () => {
    const db = citeste('db.ts')
    expect(db).toMatch(/AS scutit/)
    expect(db).toMatch(/lower\(v\.user_email\)/)
    const panou = citeste('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).toMatch(/scutit — sold istoric/)
  })
})

describe('plafonul: cifra vine cu contextul ei, nu ca „măsurat" pe necitit', () => {
  it('citirea nouă separă „nu pot citi" de zero și numără joburile fără cost', () => {
    const db = citeste('db.ts')
    expect(db).toMatch(/cheltuialaAziConstructor/)
    expect(db).toMatch(/COUNT\(\*\) FILTER \(WHERE cost_usd IS NULL\)/)
    expect(db).toMatch(/\{ citit: false, motiv: String/)
  })
  it('plafonConstructor duce contextul mai departe, iar panoul îl afișează', () => {
    expect(citeste('services/autonomie.ts')).toMatch(/cheltuitCitit: false, cheltuitMotiv: c\.motiv/)
    const panou = citeste('../../frontend/src/components/AdminPanel.tsx')
    expect(panou).toMatch(/NU POT CITI cheltuiala azi/)
    expect(panou).toMatch(/joburi fără cost raportat — cifra e minimul măsurat/)
  })
})
