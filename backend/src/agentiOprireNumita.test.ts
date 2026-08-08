import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { verdictRunda } from './services/enterpriseCreate.js'

// ── UN REFUZ NU SE MAI RAPORTEAZĂ CA LINIȘTE (8 aug 2026) ───────────────────
//
// Adrian: „analizează și măsoară de ce nu funcționează creierea automată de
// agenți". Pagina arăta `Creați: 0 | existau: 12 | eșuați: 0` și un text vag
// despre „serverul continuă singur".
//
// MĂSURAT: rosterul din cod are 91 de agenți; cu 12 existenți, bucla avea 80 de
// creat. Deci „0 creați" NU însemna „n-a avut ce crea". Cauza, în cod:
//
//     if (rez.quota) { anunta(...); break }      // ← `rez` NU intra în `rezultate`
//
// La un 429 chiar de la primul agent, `rezultate` rămânea GOL, iar
// `socoteste([])` întorcea `{creati: 0, esuati: 0}` fără nicio primă eroare.
// Adică Google refuza la fiecare cerere, iar pagina raporta cifre liniștitoare
// și niciun motiv. Al treilea caz din aceeași familie, după „£0.00" și
// „Cardul Kelion AI: necreat": o operație REFUZATĂ prezentată ca fapt neutru.
//
// Gardul ăsta ține reparația: oprirea trebuie NUMITĂ, purtată în raport, luată
// în calcul la verdict, și ARĂTATĂ pe pagină.

const src = (p: string): string => fs.readFileSync(new URL(`./${p}`, import.meta.url), 'utf8')

describe('crearea agenților — oprirea din cotă se NUMEȘTE, nu se ascunde', () => {
  const serviciu = src('services/enterpriseCreate.ts')
  const pagina = src('routes/enterprise.ts')

  it('ramura de 429 înregistrează motivul, cu eroarea verbatim de la Google', () => {
    // Se taie la `break` ca INSTRUCȚIUNE (început de linie), nu la primul cuvânt
    // „break" — prima variantă tăia în comentariul care explică bugul, deci
    // dădea roșu pe cod corect. Un gard care se înșală e mai rău decât niciunul.
    const ramura = serviciu.slice(serviciu.indexOf('if (rez.quota) {'))
    const panaLaBreak = ramura.slice(0, ramura.search(/\n\s*break\b/))
    expect(
      /oprit = /.test(panaLaBreak),
      'ramura de 429 iese fără să scrie motivul — raportul va arăta iar „0 creați, 0 eșuați" fără cauză',
    ).toBe(true)
    expect(/rez\.err/.test(panaLaBreak), 'motivul nu poartă eroarea verbatim de la Google').toBe(true)
  })

  it('raportul are câmpurile care fac diferența între „gata" și „oprit"', () => {
    expect(/oprit\?: string/.test(serviciu), 'raportul n-are câmp pentru motivul opririi').toBe(true)
    expect(/ramasi\?: number/.test(serviciu), 'raportul nu spune câți RĂMÂN de creat').toBe(true)
  })

  it('verdictul e o funcție PURĂ, deci se poate proba — și ține cont de oprire', () => {
    // Verdictul a fost scos din mijlocul funcției de rețea exact ca să poată fi
    // rulat pe cifre reale (vezi al doilea grup de teste, mai jos).
    expect(/export function verdictRunda/.test(serviciu), 'verdictul nu mai e o funcție probabilă').toBe(true)
    const corp = serviciu.slice(serviciu.indexOf('export function verdictRunda'))
    expect(
      /!x\.oprit/.test(corp.slice(0, 600)),
      'o rundă oprită de Google ar raporta din nou „fără eșecuri" și ar părea sănătoasă',
    ).toBe(true)
  })

  it('pagina de admin arată motivul opririi, primul, nu textul vag', () => {
    expect(/j\.oprit/.test(pagina), 'pagina nu citește motivul opririi din raport').toBe(true)
    expect(/OPRIT DE GOOGLE/.test(pagina), 'pagina nu numește refuzul').toBe(true)
    expect(/RĂMAȘI de creat/.test(pagina), 'pagina nu arată câți mai sunt de creat').toBe(true)
  })
})

// ── DOVADA CĂ MERGE, nu doar că e scris (Adrian: „repari, măsori și dovedești") ──
// Verdictul e o funcție pură, deci se rulează pe cazul REAL din captura ownerului
// și se vede ce iese. Fără rețea, fără Google, fără presupuneri.

describe('verdictul rundei — probat pe cazul real din captura ownerului', () => {
  it('CAZUL RAPORTAT: 12 în consolă din 91, Google refuză cu 429 la primul → NU e „ok", și spune câți rămân', () => {
    // Exact cifrele de pe ecran: existau 12, creați 0, eșuați 0 (bucla a ieșit
    // pe `break` fără să înregistreze nimic). Înainte, `esuati === 0` făcea
    // verdictul să pară curat.
    const v = verdictRunda({ esuati: 0, oprit: 'Google a refuzat cu 429 (cotă epuizată)', inConsola: 12, inRoster: 91 })
    expect(v.ok, 'o rundă oprită de Google NU are voie să fie „ok"').toBe(false)
    expect(v.ramasi).toBe(79)
  })

  it('fără oprire, dar incomplet → tot nu e „ok" (nu se declară gata la jumătate)', () => {
    expect(verdictRunda({ esuati: 0, inConsola: 40, inRoster: 91 }).ok).toBe(false)
    expect(verdictRunda({ esuati: 0, inConsola: 40, inRoster: 91 }).ramasi).toBe(51)
  })

  it('toți în consolă, fără eșecuri, fără oprire → GATA', () => {
    const v = verdictRunda({ esuati: 0, inConsola: 91, inRoster: 91 })
    expect(v.ok).toBe(true)
    expect(v.ramasi).toBe(0)
  })

  it('toți în consolă dar cu eșecuri → NU e gata', () => {
    expect(verdictRunda({ esuati: 3, inConsola: 91, inRoster: 91 }).ok).toBe(false)
  })

  it('mai mulți în consolă decât în roster (owner a adăugat manual) → tot gata, fără număr negativ', () => {
    const v = verdictRunda({ esuati: 0, inConsola: 95, inRoster: 91 })
    expect(v.ok).toBe(true)
    expect(v.ramasi).toBe(0)
  })
})
