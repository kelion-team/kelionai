// ── JURNALUL EPISOADELOR PROMO (Adrian, 11 aug: „el trebuie să-și știe ce a
// filmat în fiecare videoclip ep1, 2… ca să știe unde a rămas") ──────────────
// Clipurile promo sunt o SERIE. La fiecare clip pregătit (prepare_promo_clip),
// se salvează un episod cu subiectul + un rezumat al scriptului + durata + data,
// auto-numerotat. Kelion citește jurnalul (unealta episoade_promo) ca să știe
// unde a rămas și să CONTINUE seria de la episodul următor.
//
// Stocare: kv_state, cheie `promo_episoade:{email}` → JSON. Logica de listă e
// PURĂ (se probează fără DB); citirea/scrierea sunt învelișuri subțiri peste kv.

import { loadKv, saveKv } from '../db.js'

export interface EpisodPromo {
  ep: number
  subiect: string
  rezumat: string
  durata: number
  data: string
}

const cheie = (email: string): string => `promo_episoade:${email}`

/** PURĂ: adaugă un episod cu NUMĂRUL următor (max + 1), păstrând ultimele 100. */
export function adaugaEpisodInLista(lista: EpisodPromo[], ep: Omit<EpisodPromo, 'ep'>): EpisodPromo[] {
  const bune = Array.isArray(lista) ? lista.filter((e) => e && Number.isFinite(e.ep)) : []
  const urm = bune.reduce((m, e) => Math.max(m, e.ep), 0) + 1
  return [...bune, { ep: urm, ...ep }].slice(-100)
}

/** PURĂ: rezumatul pe care îl primește creierul — unde a rămas + lista scurtă. */
export function rezumaEpisoade(lista: EpisodPromo[]): string {
  const bune = Array.isArray(lista) ? lista.filter((e) => e && Number.isFinite(e.ep)) : []
  if (!bune.length) return 'Niciun episod filmat încă — următorul e ep1.'
  const ultim = bune[bune.length - 1]
  const randuri = bune
    .map((e) => `ep${e.ep} (${e.data}, ${e.durata}s): ${e.subiect}${e.rezumat ? ` — ${e.rezumat}` : ''}`.slice(0, 300))
    .join('\n')
  return `Ai filmat ${bune.length} episod(oade). Ai rămas la ep${ultim.ep} („${ultim.subiect}"). Următorul: ep${ultim.ep + 1}.\n${randuri}`
}

export async function citesteEpisoade(email: string): Promise<EpisodPromo[]> {
  try {
    const raw = await loadKv(cheie(email))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? (arr as EpisodPromo[]) : []
  } catch {
    return []
  }
}

/** Adaugă un episod și îl salvează; întoarce episodul creat (cu numărul lui). */
export async function adaugaEpisod(email: string, ep: Omit<EpisodPromo, 'ep'>): Promise<EpisodPromo> {
  const noua = adaugaEpisodInLista(await citesteEpisoade(email), ep)
  await saveKv(cheie(email), JSON.stringify(noua))
  return noua[noua.length - 1]
}
