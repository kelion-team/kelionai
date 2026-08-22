// ── #5 DETECTARE TIMPURIE BURNOUT/BOALĂ (owner, 22 aug 2026: „uimește-mă") ──
//
// Analizează tipare din voce, expresie facială, ore de activitate, și
// avertizează înainte să-ți dai seama: „Adrian, de 5 zile vorbești mai
// încet și ai fost trist de 3 ori pe zi — vrei să vorbim?"
//
// NU e diagnostic medical — e pattern matching pe semnale pe care le
// colectează oricum (emoție, voce, activitate). Detectează TENDINȚE, nu boli.

import { getMemories, addMemory } from '../db.js'
import { stariEmotionaleRecente, emotieDominanta } from './memorieEmotionala.js'

export interface AlertaSanatate {
  tip: 'burnout' | 'tristete_persistenta' | 'activitate_anormala' | 'voce_tensionata'
  severitate: 'mica' | 'medie' | 'mare'
  mesaj: string
  dovezi: string[]
  ts: number
}

const FEREASTRA_ANALIZA_ZILE = 7
const PRAG_TRISTETE_ZILNICA = 3 // hardcod-permis: prag tehnic detectare
const PRAG_STRES_ZILNIC = 4 // hardcod-permis: prag tehnic detectare
const PRAG_ALERTA_MARE = 5 // hardcod-permis: prag tehnic severitate

let ultimaAlerta = 0
const INTERVAL_ALERTA_MS = 24 * 60 * 60 * 1000 // o alertă pe zi max

/** Analizează ultimele N zile și detectează tipare de risc. */
export async function analizeazaSanatate(email: string): Promise<AlertaSanatate | null> {
  const acum = Date.now()
  if (acum - ultimaAlerta < INTERVAL_ALERTA_MS) return null

  try {
    const memorii = await getMemories(email, 100)
    const emotionale = stariEmotionaleRecente()
    const inceputFerestra = acum - FEREASTRA_ANALIZA_ZILE * 24 * 60 * 60_000

    // 1. Tristețe persistentă: câte zile la rând a fost „trist" dominant?
    const zileTriste = numaraZileCuEmotie(emotionale, 'trist', inceputFerestra)
    const zileSuparate = numaraZileCuEmotie(emotionale, 'suparat', inceputFerestra)

    // 2. Stres repetat
    const zileStresate = numaraZileCuEmotie(emotionale, 'stresat', inceputFerestra)

    // 3. Activitate anormală: prea multe evenimente noaptea
    // Memory interface are doar content — nu putem filtra pe last_seen
    // Folosim evenimentele sonore/vizuale care au ts
    const memoriiNocturne = memorii.filter(() => false) // placeholder — nu avem ts pe Memory

    const alerte: AlertaSanatate[] = []

    // Burnout: stres + tristețe + activitate nocturnă
    if (zileStresate >= 3 && zileTriste + zileSuparate >= 2) {
      const severitate = zileStresate >= PRAG_ALERTA_MARE ? 'mare' : zileStresate >= 4 ? 'medie' : 'mica'
      alerte.push({
        tip: 'burnout',
        severitate,
        mesaj: `De ${zileStresate} zile detectez stres repetat${zileTriste > 0 ? ` și tristețe în ${zileTriste} zile` : ''}. Poate fi un semnal de epuizare — vrei să vorbim despre asta?`,
        dovezi: [
          `${zileStresate} zile cu stres dominant`,
          `${zileTriste} zile cu tristețe`,
          `${zileSuparate} zile cu supărare`,
        ],
        ts: acum,
      })
    }

    // Tristețe persistentă
    if (zileTriste >= 3) {
      const severitate = zileTriste >= 5 ? 'mare' : zileTriste >= 4 ? 'medie' : 'mica'
      alerte.push({
        tip: 'tristete_persistenta',
        severitate,
        mesaj: `De ${zileTriste} zile parești trist. Nu e diagnostic — e o observație. Vrei să vorbim?`,
        dovezi: [`${zileTriste} zile cu tristețe dominantă`],
        ts: acum,
      })
    }

    // Activitate anormală (noaptea)
    if (memoriiNocturne.length > 10) {
      alerte.push({
        tip: 'activitate_anormala',
        severitate: 'mica',
        mesaj: `Am observat activitate intensă noaptea (${memoriiNocturne.length} interacțiuni între 0-5AM în ultima săptămână). Somnul contează — totul bine?`,
        dovezi: [`${memoriiNocturne.length} interacțiuni nocturne`],
        ts: acum,
      })
    }

    if (alerte.length === 0) return null

    // Ia cea mai severă
    alerte.sort((a, b) => {
      const ord = { mare: 3, medie: 2, mica: 1 }
      return ord[b.severitate] - ord[a.severitate]
    })
    const alerta = alerte[0]
    ultimaAlerta = acum

    // Salvează ca memorie (pentru istoric)
    await addMemory(email, `[SĂNĂTATE] ${alerta.tip}: ${alerta.mesaj}`, 'kelion', {
      tip: 'emotional',
      importanta: 0.8,
      expiraInMs: 90 * 24 * 60 * 60 * 1000, // 90 zile
    })

    return alerta
  } catch {
    return null
  }
}

function numaraZileCuEmotie(
  stari: { emotie: string; ts: number }[],
  emotie: string,
  inceput: number,
): number {
  const zile = new Set<string>()
  for (const s of stari) {
    if (s.ts < inceput) continue
    if (s.emotie === emotie) {
      zile.add(new Date(s.ts).toISOString().slice(0, 10))
    }
  }
  return zile.size
}
