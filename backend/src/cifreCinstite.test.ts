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
    const tarife = citeste('services/tarife.ts')
    expect(tarife).toMatch(/if \(esteAdminKelion\(email\)\) return \{ ok: true, debitedMinor: 0, scazutGbp: 0/)
    expect(tarife).not.toMatch(/if \(_esteAdmin\)/)
  })
  it('voce live + chat: debitul este derivat numai din identitatea admin centrală', () => {
    const voce = citeste('routes/vocalLive.ts')
    expect(voce).toMatch(/const isAdminSession = esteAdminKelion\(user\.email\)/)
    expect(voce).toMatch(/const monetizedCustomer = !isAdminSession/)
    expect(voce).not.toMatch(/user\.role\s*[!=]==?\s*['"]admin['"]/)
    const chat = citeste('routes/chat.ts')
    expect(chat).toMatch(/const monetizedCustomer = !esteAdminKelion\(user\.email\)/)
    expect(chat).not.toMatch(/user\.role\s*[!=]==?\s*['"]admin['"]/)
  })
  it('panoul spune adevărul lângă cifra istorică (scutit), nu o ascunde', () => {
    const db = citeste('db.ts')
    expect(db).toMatch(/AS scutit/)
    expect(db).toMatch(/lower\(v\.user_email\)/)
    const panou = citeste('../../frontend/src/components/admin/AdminUtilizatori.tsx')
    expect(panou).toMatch(/scutit — sold istoric/)
  })

  it('balance API marchează scutit pe admin — wallet nu face paywall pe sold istoric', () => {
    const billing = citeste('routes/billing.ts')
    expect(billing).toMatch(/const scutit = esteAdminKelion\(user\.email\)[\s\S]*?if \(scutit\) \{[\s\S]*?credits: 0,[\s\S]*?percent: 100,[\s\S]*?debitMinor: 0/)
    const wallet = citeste('../../frontend/src/components/WalletButton.tsx')
    expect(wallet).toMatch(/!b\.scutit && b\.credits <= 0/)
  })
})

describe('Constructorul local nu pretinde cost sau task de furnizor cloud', () => {
  it('contractul public expune numai executorul local, coada și heartbeatul', () => {
    const worker = citeste('services/constructorWorker.ts')
    expect(worker).toContain("CONSTRUCTOR_EXECUTOR = 'OpenCode (motor configurat separat)'")
    expect(worker).toContain("CONSTRUCTOR_QUEUE = 'build_jobs'")
    expect(worker).not.toMatch(/internalCostUsd|taskUrl|openai-project-key|codex login/i)
  })
})
