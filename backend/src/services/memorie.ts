import fs from 'node:fs/promises'
import { cpus } from 'node:os'

// ── MEMORIA GAZDEI ──────────────────────────────────────────────────────────
//
// Adrian, 31 iul: „prietene dar eu am acolo" / „ce nu e ok cu asta?" — despre
// pus un al doilea agent (OpenHands) pe VPS-ul care rulează deja aplicația.
//
// Îi răspunsesem „n-aș pune-o pe același VPS". Când m-a întrebat de ce, m-am
// uitat în cod: discul era măsurat în două locuri, memoria în NICIUNUL. Deci
// nu era un răspuns, era o părere îmbrăcată în verdict — fix ce n-am voie.
//
// Contează dincolo de întrebarea lui, și mai mult decât discul: discul plin dă
// erori pe care le vezi în jurnal, memoria plină nu dă nimic — kernelul alege o
// victimă și o omoară (OOM). Containerul moare, sentinela îl repornește, iar în
// jurnal rămâne „a repornit" fără niciun „de ce". De azi rămâne cauza scrisă.
//
// De ce /proc/meminfo și nu os.totalmem(): în container, /proc/meminfo arată
// memoria GAZDEI — exact ce ne trebuie ca să răspundem „încape încă un agent pe
// mașina asta?". Și de ce MemAvailable, nu MemFree: MemFree exclude cache-ul,
// care e recuperabil pe loc; pe un server care rulează de zile, MemFree e
// aproape mereu mic și ar declanșa alarme false. MemAvailable e cifra reală.

export interface MemorieGazda {
  totalGb: number
  liberGb: number
  liberPct: number
  procesoare: number
}

/** Pragul de alarmă, în procente libere. Sub el, OOM killer-ul e o chestiune de timp. */
export const PRAG_MEMORIE_PCT = 10

/**
 * Parsează textul /proc/meminfo. Pură — de asta e separată: se poate testa cu
 * un fișier real, fără să depindă de mașina pe care rulează testul.
 * Întoarce null dacă textul nu e /proc/meminfo (altă platformă, fișier gol).
 */
export function citesteMeminfo(text: string, procesoare = 0): MemorieGazda | null {
  const kb = (camp: string): number => Number(new RegExp(`^${camp}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0)
  const total = kb('MemTotal')
  const liber = kb('MemAvailable')
  if (total <= 0) return null
  return {
    totalGb: total / 1024 / 1024,
    liberGb: liber / 1024 / 1024,
    liberPct: Math.round((liber / total) * 100),
  procesoare,
  }
}

/** Citește memoria gazdei. null pe orice altceva decât Linux — lipsă, nu zero. */
export async function memorieGazda(): Promise<MemorieGazda | null> {
  try {
    return citesteMeminfo(await fs.readFile('/proc/meminfo', 'utf8'), cpus().length)
  } catch {
    return null
  }
}

/** „3.1 GB liberi din 7.8 GB (40%)" — aceeași frază peste tot unde se raportează. */
export function descrieMemoria(m: MemorieGazda): string {
  return `${m.liberGb.toFixed(1)} GB liberi din ${m.totalGb.toFixed(1)} GB (${m.liberPct}%)`
}
