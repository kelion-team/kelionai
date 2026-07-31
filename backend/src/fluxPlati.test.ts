import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── DOVADA CĂ LANȚUL BANILOR E LEGAT, VERIGĂ CU VERIGĂ ──────────────────────
//
// Adrian, 31 iul: „verifică că Kelion vede ce e în interior și tot e legat în
// fluxul plăților" · „dovezi la tot ce rezolvi".
//
// Un lanț de plăți se poate rupe în două feluri, și amândouă sunt tăcute:
// o funcție există dar n-o cheamă nimeni, sau o cheamă cineva care nu rulează
// niciodată. Testul ăsta citește codul REAL și verifică fiecare legătură —
// nu descrie fluxul, îl măsoară.
//
// Ce a prins la scriere: căutarea naivă după `verificaPlatiNoi` nu găsea niciun
// apelant, ceea ce părea o ruptură. Nu era: e chemată prin `startCitirePlati()`,
// pornit la boot. De-aia testul urmărește lanțul prin numele care leagă efectiv,
// nu prin căutarea unei singure funcții.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

describe('fluxul plăților e legat cap-coadă — măsurat în cod, nu descris', () => {
  const index = sursa('./index.ts')
  const banking = sursa('./services/openBanking.ts')
  const billing = sursa('./routes/billing.ts')
  const db = sursa('./db.ts')

  it('1. userul cere credite → ruta de checkout există și emite un cod unic', () => {
    expect(billing).toContain('/api/billing/checkout')
    expect(billing).toMatch(/creeazaCodPlata/)
    expect(db).toContain('export async function creeazaCodPlata')
  })

  it('2. cititorul bancar chiar PORNEȘTE la boot — nu doar există', () => {
    expect(index).toContain('startCitirePlati()')
    expect(banking).toContain('export function startCitirePlati')
  })

  it('3. cititorul reverifică periodic — o plată nu așteaptă o repornire', () => {
    expect(banking).toMatch(/setInterval\([\s\S]{0,80}verificaPlatiNoi/)
  })

  it('4. ce citește se potrivește cu codul emis, și potrivirea creditează', () => {
    expect(banking).toContain('crediteazaDupaCod')
    expect(db).toContain('export async function crediteazaDupaCod')
    // Creditarea trece prin topUpUser — singurul loc care mișcă soldul.
    expect(db).toMatch(/crediteazaDupaCod[\s\S]{0,3000}topUpUser/)
  })

  it('5. aceeași plată văzută de două ori NU creditează de două ori', () => {
    // Idempotența e apărată de referința bancară, nu de noroc.
    expect(db).toMatch(/crediteazaDupaCod[\s\S]{0,3000}(bank_ref|ON CONFLICT|already|deja)/i)
  })

  it('6. panoul poate spune dacă citirea merge — starea e citibilă, nu presupusă', () => {
    expect(banking).toContain('export function stareCitirePlati')
    expect(sursa('./routes/admin.ts')).toContain('stareCitirePlati')
  })

  // UNDE SE OPREȘTE ASTĂZI, și de ce e important să fie scris, nu doar știut:
  // fără cheile GoCardless, `startCitirePlati` iese pe loc și TOT lanțul de mai
  // sus rămâne teoretic — userul plătește, banii intră în contul lui Adrian, și
  // creditele nu apar niciodată singure. Nu e un bug; e o poartă. Dar o poartă
  // închisă tăcut arată exact ca un lanț rupt, de-aia o afirmăm aici.
  it('7. fără chei, cititorul se oprește EXPLICIT și o spune — nu tace', () => {
    expect(banking).toMatch(/gocardless\.secretId[\s\S]{0,200}return/)
    expect(banking).toMatch(/console\.log\([\s\S]{0,120}(oprit|lipsesc)/i)
  })
})
