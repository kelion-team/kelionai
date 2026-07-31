import fs from 'node:fs/promises'
import { cpus } from 'node:os'

// ── RESURSELE GAZDEI: MEMORIE + ÎNCĂRCARE ───────────────────────────────────
//
// Adrian, 31 iul: „prietene dar eu am acolo" / „ce nu e ok cu asta?" — despre
// a mai lua un VPS pentru al doilea agent, în loc să-l folosim pe cel existent.
// Apoi: „nu mai bine faci tot pe VPS actual și vedem după, dacă nu duce mărim
// ramul?" — planul lui, mai bun decât al meu. Și: „se poate măsura încărcarea
// pe server, e ușor" — da, și e cealaltă jumătate a răspunsului.
//
// Îi răspunsesem „n-aș pune-o pe același VPS". Când m-a întrebat de ce, m-am
// uitat în cod: discul era măsurat în două locuri (health.ts, ops.ts), memoria
// și încărcarea în NICIUNUL. Deci nu era un răspuns, era o părere dată ca
// verdict — exact ce n-am voie (regula 1).
//
// Cele două măsoară lucruri diferite, și amândouă sunt necesare:
//   MEMORIA     → ÎNCAPE? Plină, kernelul omoară procese (OOM), fără eroare,
//                 fără avertisment. Containerul moare, sentinela îl repornește,
//                 iar în jurnal rămâne „a repornit" și niciun „de ce".
//   ÎNCĂRCAREA  → DUCE? Saturat, nimic nu moare — totul devine încet. Chatul
//                 care trebuie să răspundă sub o secundă răspunde în cinci.
//
// De ce /proc și nu os.freemem(): în container, /proc arată GAZDA — exact ce
// trebuie ca să răspunzi „mai încape un agent pe mașina asta?".

export interface ResurseGazda {
  /** Memoria totală a gazdei, GB. */
  totalGb: number
  /** Memorie disponibilă real (liber + cache recuperabil), GB. */
  liberGb: number
  /** Procent liber din total. Sub PRAG_MEMORIE_PCT = OOM e o chestiune de timp. */
  liberPct: number
  procesoare: number
  /** Media de încărcare la 1 / 5 / 15 minute, brută (ca `uptime`). */
  incarcare: [number, number, number]
  /**
   * Încărcarea la 15 min raportată la numărul de procesoare, în procente.
   * 100% = exact atâtea procese care așteaptă câte nuclee sunt. Peste = coadă.
   */
  incarcarePct: number
}

/** Sub atât la sută memorie liberă, kernelul începe să omoare procese. */
export const PRAG_MEMORIE_PCT = 10

/**
 * Peste atât la sută încărcare susținută (media pe 15 min), mașina e în coadă.
 * 100% ar fi „exact la capacitate" — pragul e mai sus ca să nu țipe la vârfuri
 * normale (un build, un deploy). 200% = fiecare nucleu are un proces care
 * așteaptă după el; atunci chiar e strâmt.
 */
export const PRAG_INCARCARE_PCT = 200

interface Memorie {
  totalGb: number
  liberGb: number
  liberPct: number
}

/**
 * Parsează /proc/meminfo. Pură — de asta e separată: se testează cu text real,
 * fără să depindă de mașina pe care rulează testul.
 * Întoarce null dacă textul nu e /proc/meminfo (altă platformă, fișier gol).
 */
export function citesteMeminfo(text: string): Memorie | null {
  const kb = (camp: string): number => Number(new RegExp(`^${camp}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0)
  const total = kb('MemTotal')
  // MemAvailable, nu MemFree: MemFree exclude cache-ul, care e recuperabil pe
  // loc. Pe un server care rulează de o săptămână MemFree e mereu mic și ar
  // aprinde alarma în fiecare zi degeaba. MemAvailable e cifra reală.
  const liber = kb('MemAvailable')
  if (total <= 0) return null
  return {
    totalGb: total / 1024 / 1024,
    liberGb: liber / 1024 / 1024,
    liberPct: Math.round((liber / total) * 100),
  }
}

/** Parsează /proc/loadavg („0.13 0.23 0.17 1/111 26260"). Pură, ca mai sus. */
export function citesteLoadavg(text: string): [number, number, number] | null {
  const m = /^\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text)
  if (!m) return null
  const v: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return v.some((n) => !Number.isFinite(n)) ? null : v
}

/** Citește resursele gazdei. null pe orice altceva decât Linux — lipsă, nu zero. */
export async function resurseGazda(): Promise<ResurseGazda | null> {
  const citeste = async (cale: string): Promise<string | null> => {
    try {
      return await fs.readFile(cale, 'utf8')
    } catch {
      return null // fără /proc — lipsă declarată, niciodată inventată ca 0
    }
  }
  const [mText, lText] = await Promise.all([citeste('/proc/meminfo'), citeste('/proc/loadavg')])
  const mem = mText === null ? null : citesteMeminfo(mText)
  const load = lText === null ? null : citesteLoadavg(lText)
  if (!mem || !load) return null
  const procesoare = cpus().length || 1
  return {
    ...mem,
    procesoare,
    incarcare: load,
    incarcarePct: Math.round((load[2] / procesoare) * 100),
  }
}

/** „3.1 GB liberi din 7.8 GB (40%), încărcare 17% din 4 procesoare (…)" */
export function descrieResurse(r: ResurseGazda): string {
  return (
    `${r.liberGb.toFixed(1)} GB liberi din ${r.totalGb.toFixed(1)} GB (${r.liberPct}%), ` +
    `încărcare ${r.incarcarePct}% din ${r.procesoare} procesoare ` +
    `(${r.incarcare.map((n) => n.toFixed(2)).join(' / ')} la 1/5/15 min)`
  )
}
