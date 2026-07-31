import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── „$0.00" NU ARE VOIE SĂ ÎNSEMNE „N-AM PUTUT CITI" ────────────────────────
//
// Adrian, 31 iul: pagina lui OpenRouter arăta $10,00. Bara aplicației arăta
// „OpenRouter $0.00", roșu intermitent, adică „depune bani!".
//
// Partea proastă nu e cifra. E că, cu câteva ore înainte, mă uitasem la
// FRONTEND (care chiar e corect: afișează „⚠ OpenRouter" când citirea pică) și
// îi spusesem că pilula NU minte, deci zeroul e o măsurătoare reușită. Nu m-am
// uitat și la cine produce `live`. Am certificat ca sănătos exact tiparul pe
// care-l reparam în altă parte în aceeași zi.
//
// Cauza, în getOpenRouterBalance: `ok: true` se punea imediat ce HTTP-ul era
// 200. Dar corpul trece prin `.catch(() => ({}))`, iar câmpurile prin `?? 0`.
// Corp neparsabil, `data` lipsă sau câmpuri redenumite la furnizor → 0 − 0 = 0,
// cu `ok: true`. O citire eșuată devenea „ai zero dolari", cu tot cu alarmă.
//
// Testul păzește regula, nu implementarea: dacă cifrele nu-s acolo unde le
// aștept, răspunsul e „nu pot citi", nu un zero credibil.
const sursa = readFileSync(
  fileURLToPath(new URL('./services/openrouter.ts', import.meta.url)),
  'utf8',
)

describe('soldul: lipsa se declară, nu se inventează', () => {
  it('`ok: true` cere ca AMBELE cifre să existe și să fie numere', () => {
    expect(sursa).toMatch(/!d \|\| !Number\.isFinite\(totalCredits\) \|\| !Number\.isFinite\(totalUsage\)/)
    expect(sursa).toContain('forma_neasteptata')
  })

  it('nu mai există `?? 0` pe cifrele soldului — acolo se năștea zeroul fals', () => {
    expect(sursa).not.toMatch(/total_credits\s*\?\?\s*0/)
    expect(sursa).not.toMatch(/total_usage\s*\?\?\s*0/)
  })

  it('HTTP nereușit rămâne raportat separat de forma greșită', () => {
    // Două cauze diferite, două erori diferite: „n-a răspuns serverul" nu e
    // același lucru cu „a răspuns, dar altfel decât mă așteptam".
    expect(sursa).toMatch(/if \(!r\.ok\) return \{ \.\.\.base, error: `http_\$\{r\.status\}` \}/)
  })

  it('eroarea spune CE a venit — numele câmpurilor, nicio valoare', () => {
    // Ca următorul care se uită să vadă din prima forma reală, nu să caute o zi.
    // Doar chei, niciodată valori: un sold e al ownerului, nu al jurnalului.
    expect(sursa).toMatch(/Object\.keys\(d \?\? j \?\? \{\}\)/)
    expect(sursa).not.toMatch(/JSON\.stringify\(j\)/)
  })

  it('starea de pornire e „nu știu", nu „zero" — dacă se iese devreme, iese onest', () => {
    expect(sursa).toMatch(/ok: false, balance: 0[\s\S]{0,120}low: true/)
  })
})

describe('bara arată lipsa ca lipsă (partea care era deja corectă)', () => {
  const bara = readFileSync(
    fileURLToPath(new URL('../../frontend/src/pages/Stage.tsx', import.meta.url)),
    'utf8',
  )

  it('cifra se scrie DOAR când citirea a reușit', () => {
    expect(bara).toMatch(/brainCredit\.openrouter\.live\s*\n?\s*\? `OpenRouter \$/)
    expect(bara).toContain("'⚠ OpenRouter'")
  })

  it('`live` vine din `ok`-ul măsurătorii, nu din altceva', () => {
    const ruta = readFileSync(fileURLToPath(new URL('./routes/admin.ts', import.meta.url)), 'utf8')
    expect(ruta).toMatch(/live: orBalance\.ok/)
  })
})
