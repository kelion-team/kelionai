import { loadKv, saveKv } from '../db.js'

// ── L1h: ÎNVĂȚARE DIN FEEDBACK IMPLICIT („nu asta am cerut") ─────────────────
//
// Adrian, backlog L1h: „autoInvatare + memoria există; de legat semnalele («nu
// asta am cerut») de registru". `autoInvatare.ts` învață din TIMPI (cât durează
// fiecare tip de sarcină). Dar semnalul cel mai clar că a greșit — omul care-l
// CORECTEAZĂ imediat după un răspuns — nu ajungea nicăieri. Aici îl prindem.
//
// Cum: când o replică a omului e clar o RESPINGERE a răspunsului dinainte (nu
// orice negație — vezi tiparele), notăm reproșul (ce ceruse, ce a făcut Kelion,
// cum l-a corectat) într-un registru mic; ultimele intră în lecțiile pe care
// creierul le citește, ca să nu repete aceeași abordare greșită.
//
// PRINCIPIU (regula #1): detectăm doar tipare CLARE de corecție, ca să nu punem
// pe seama lui greșeli inexistente. Ce nu e clar un reproș NU se notează.

const CHEIE_KV = 'invatare:reprosuri'
const MAX_PASTRATE = 40
const CATE_IN_LECTII = 5

// Tipare de RESPINGERE a răspunsului precedent (RO + EN). Sunt intenționat
// SPECIFICE — „greșit" singur sau „wrong" singur ar prinde și „ce e greșit la
// asta?", deci cerem forma de corecție adresată lui.
const TIPARE: Array<{ re: RegExp; fel: string }> = [
  { re: /\bnu\s+(asta|aia|aceea|ce)\s+(am\s+)?(cerut|vrut|voiam|rugat|zis|spus|cer)/i, fel: 'nu-asta' },
  { re: /\bnu\s+(asta|aia)\b(?!\s*(bun|rău|e\s+problema))/i, fel: 'nu-asta' },
  { re: /\bnu\s+(ți|ti)-am\s+(cerut|zis|spus|cerut\s+asta)/i, fel: 'nu-asta' },
  { re: /\bai\s+(înțeles|inteles|făcut|facut)\s+(greșit|gresit|aiurea|prost)/i, fel: 'gresit' },
  { re: /\b(greșit|gresit)\b.*\b(ce\s+ai|ai\s+făcut|ai\s+facut|răspuns|raspuns)/i, fel: 'gresit' },
  { re: /\bnu\s+(e|este)\s+(asta|aia|bine|corect|ce\s+am\s+cerut)/i, fel: 'nu-corect' },
  { re: /\bnu\s+(așa|asa)\b/i, fel: 'nu-asa' },
  { re: /\bde\s+fapt\s+(voiam|vroiam|ceream|am\s+cerut|te-am\s+rugat)/i, fel: 'de-fapt' },
  { re: /\bnu\s+(am\s+)?(cerut|zis|spus)\s+asta/i, fel: 'nu-asta' },
  { re: /\bnot\s+what\s+i\s+(asked|meant|wanted)/i, fel: 'nu-asta' },
  { re: /\b(that'?s|thats|this\s+is)\s+(not\s+)?(wrong|not\s+right|not\s+what)/i, fel: 'gresit' },
  { re: /\byou\s+(got\s+it\s+wrong|misunderstood)/i, fel: 'gresit' },
]

/** E replica omului o RESPINGERE clară a răspunsului dinainte? PURĂ, testabilă. */
export function esteNemultumire(text: string): { da: boolean; fel: string } {
  const t = (text ?? '').trim()
  if (t.length < 3 || t.length > 400) return { da: false, fel: '' } // un roman întreg nu-i un reproș scurt
  for (const { re, fel } of TIPARE) {
    if (re.test(t)) return { da: true, fel }
  }
  return { da: false, fel: '' }
}

interface Repros {
  t: string // ISO scurt
  cerere: string // ce ceruse omul înainte
  raspuns: string // ce făcuse Kelion (scurt)
  corectie: string // cum l-a corectat
  fel: string
}

// Cache în memorie pentru citire fără latență (creierul le vrea pe drumul cald).
let cache: Repros[] = []

/** Încarcă registrul la boot (o dată). Fără DB → cache gol, nimic nu se rupe. */
export async function incarcaReprosuri(): Promise<void> {
  try {
    const raw = await loadKv(CHEIE_KV)
    if (raw) cache = (JSON.parse(raw) as Repros[]).slice(-MAX_PASTRATE)
  } catch {
    cache = []
  }
}

/** Notează un reproș: ce ceruse, ce a făcut, cum a fost corectat. Fire-and-forget
 *  (nu ține tura). Cache-ul se actualizează sincron ca lecția să fie imediat vie. */
export async function noteazaRepros(cerere: string, raspuns: string, corectie: string, fel: string, acumIso: string): Promise<void> {
  const r: Repros = {
    t: acumIso.slice(0, 16),
    cerere: (cerere ?? '').slice(0, 200),
    raspuns: (raspuns ?? '').slice(0, 200),
    corectie: (corectie ?? '').slice(0, 200),
    fel,
  }
  cache = [...cache, r].slice(-MAX_PASTRATE)
  try {
    await saveKv(CHEIE_KV, JSON.stringify(cache))
  } catch {
    /* persistă data viitoare — cache-ul rămâne viu în sesiune */
  }
}

/** Lecțiile din reproșuri, pentru contextul creierului: ultimele câteva corecții,
 *  ca să nu repete aceeași abordare respinsă. PURĂ (pe cache). */
export function lectiiReprosuri(): string[] {
  return cache
    .slice(-CATE_IN_LECTII)
    .map((r) =>
      r.cerere
        ? `Când omul a cerut «${r.cerere}», ce ai făcut a fost RESPINS («${r.corectie}») — nu relua aceeași abordare, întreabă/țintește altfel.`
        : `Omul te-a corectat («${r.corectie}») — ține minte și nu repeta.`,
    )
}

/** Doar pentru teste: golește cache-ul între cazuri. */
export function _reseteazaCache(): void {
  cache = []
}
