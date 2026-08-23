// ── #4 JURNAL AUTOMAT (owner, 22 aug 2026: „uimește-mă") ────────────────────
//
// Fiecare zi se scrie singură: ce ai discutat, ce decizii ai luat, ce emoții
// ai avut, ce evenimente s-au întâmplat în mediu. Nu e un log — e o narațiune
// coerentă, generată din memoria senzorială + conversații.
//
// Poți întreba „ce am făcut marți?" și primești rezumatul.
// Se generează automat la sfârșitul zilei (cron la 23:00).

import { getMemories, addMemory, searchMemories } from '../db.js'
import { stariEmotionaleRecente, emotieDominanta } from './memorieEmotionala.js'
import { observatiiRecente } from './vedereContinua.js'
import { evenimenteSonoreRecente } from './auzAmbiental.js'

interface IntrareJurnal {
  data: string // YYYY-MM-DD
  rezumat: string
  emotieDominanta: string
  nrInteractiuni: number
  evenimenteSonore: number
  observatiiVizuale: number
}

const JURNAL_AGENT = 'jurnal'

/** Generează jurnalul zilei curente. Apelat automat la 23:00 (cron). */
export async function genereazaJurnalZilei(email: string): Promise<IntrareJurnal | null> {
  const acum = new Date()
  const data = acum.toISOString().slice(0, 10)
  const inceputZi = new Date(acum)
  inceputZi.setHours(0, 0, 0, 0)
  const inceputMs = inceputZi.getTime()

  try {
    // Adună toate sursele
    const memorii = await getMemories(email, 80)
    // Memory interface are doar content — nu putem filtra pe last_seen
    const memoriiZi = memorii // luăm tot ce avem (cele mai recente 80)

    const emotionale = stariEmotionaleRecente().filter((e) => e.ts >= inceputMs)
    const dominanta = emotieDominanta(24 * 60) // ultimele 24 ore
    const sonore = evenimenteSonoreRecente().filter((e) => e.ts >= inceputMs)
    const vizuale = observatiiRecente().filter((o) => o.ts >= inceputMs)

    // Extrage teme din memorii (pe baza conținutului — Memory are doar content)
    const teme: string[] = []
    const episoade = memoriiZi.filter((m) => m.content.startsWith('[VIS]') || m.content.includes('episod'))
    const proiecte = memoriiZi.filter((m) => m.content.includes('proiect') || m.content.includes('lucru'))
    const fapte = memoriiZi.filter((m) => m.content.includes('fapt') || m.content.includes('nou'))

    if (proiecte.length > 0) teme.push(`ai lucrat la ${proiecte.length} proiect${proiecte.length > 1 ? 'e' : ''}`)
    if (episoade.length > 0) teme.push(`${episoade.length} episod${episoade.length > 1 ? 'e' : ''} notabil${episoade.length > 1 ? 'e' : ''}`)
    if (fapte.length > 0) teme.push(`am învățat ${fapte.length} lucru${fapte.length > 1 ? 'ri' : ''} nou${fapte.length > 1 ? 'i' : ''}`)

    // Construiește narațiunea
    const parti: string[] = []
    parti.push(`Jurnal ${data}`)
    if (teme.length > 0) {
      parti.push(`Astăzi ${teme.join(', ')}.`)
    } else {
      parti.push(`O zi liniștită, fără evenimente notabile.`)
    }
    if (dominanta && dominanta !== 'neutru') {
      parti.push(`Starea emoțională dominantă: ${dominanta}.`)
    }
    if (emotionale.length > 0) {
      const emotiiUnice = [...new Set(emotionale.map((e) => e.emotie))]
      parti.push(`Am detectat: ${emotiiUnice.join(', ')}.`)
    }
    if (sonore.length > 0) {
      const urgente = sonore.filter((s) => s.tip === 'alarma' || s.tip === 'spargere')
      if (urgente.length > 0) {
        parti.push(`ATENȚIE: ${urgente.length} eveniment${urgente.length > 1 ? 'e' : ''} sonor${urgente.length > 1 ? 'e' : ''} urgent${urgente.length > 1 ? 'e' : ''} (${urgente.map((u) => u.tip).join(', ')}).`)
      } else {
        parti.push(`${sonore.length} eveniment${sonore.length > 1 ? 'e' : ''} sonor${sonore.length > 1 ? 'e' : ''} în mediu.`)
      }
    }
    if (vizuale.length > 0) {
      parti.push(`${vizuale.length} observații vizuale.`)
    }

    const rezumat = parti.join(' ')

    // Salvează jurnalul ca memorie episodică (pentru recall viitor)
    await addMemory(email, rezumat, JURNAL_AGENT, {
      tip: 'episodic',
      importanta: 0.6,
      expiraInMs: 365 * 24 * 60 * 60 * 1000, // 1 an — jurnalul e durabil
    })

    return {
      data,
      rezumat,
      emotieDominanta: dominanta ?? 'neutru',
      nrInteractiuni: memoriiZi.length,
      evenimenteSonore: sonore.length,
      observatiiVizuale: vizuale.length,
    }
  } catch {
    return null
  }
}

/** Caută jurnalul unei zile specifice. */
export async function getJurnalPentruZi(email: string, data: string): Promise<string | null> {
  try {
    const memorii = await searchMemories(email, JURNAL_AGENT, [`Jurnal`, data])
    if (memorii.length === 0) return null
    return memorii[0]?.content ?? null
  } catch {
    return null
  }
}

/** Ultimele N jurnale (pentru „ce am făcut săptămâna asta?"). */
export async function getJurnaleRecente(email: string, limit = 7): Promise<string[]> {
  try {
    const memorii = await getMemories(email, limit, JURNAL_AGENT)
    return memorii.map((m) => m.content).filter((c) => c.startsWith('Jurnal '))
  } catch {
    return []
  }
}
