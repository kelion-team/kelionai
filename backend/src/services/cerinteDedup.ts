// ── DEDUP FUZZY DE CERINȚE (Adrian, K16: „de ce sistemul nu monitorizează
// cerințele până la capăt? se ajung la dubluri, timp și bani") ────────────────
//
// `adaugaCerinta` deduplica DOAR pe text identic (`lower(text) = lower(...)`).
// Dar aceeași cerință spusă altfel — cu diacritice, punctuație sau altă ordine a
// cuvintelor („mută avatarul în stânga" vs „Muta avatarul la stanga.") — trecea
// ca rând NOU, iar bucla o re-analiza: dublură, timp și bani irosiți. Aici:
// normalizare + similaritate pe tokenii semnificativi, ca reformulările să cadă
// pe aceeași cerință.
//
// Pur și determinist — testat în cerinteDedup.test.ts. Fără import din db.ts
// (ca să nu introducem un ciclu: db.ts importă de AICI).

/** Formă canonică: litere mici, fără diacritice, fără punctuație, spații simple. */
export function normalizeaza(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // taie semnele diacritice
    .replace(/[^a-z0-9\s]/g, ' ') // punctuația devine spațiu
    .replace(/\s+/g, ' ')
    .trim()
}

// Cuvinte de legătură care nu poartă înțeles — scoase din comparație, ca ordinea
// și micile diferențe de exprimare să nu conteze.
const STOP = new Set([
  'sa', 'si', 'in', 'la', 'pe', 'de', 'cu', 'un', 'una', 'unu', 'o', 'al', 'ale', 'ai', 'ca',
  'e', 'ii', 'se', 'mai', 'din', 'ce', 'care', 'sau', 'nu', 'da', 'the', 'a', 'to', 'of', 'and',
  'for', 'it', 'is', 'be', 'me', 'lui', 'ei', 'ne', 'va', 'vor', 'prin', 'peste', 'catre', 'cand',
])

function tokeni(norm: string): Set<string> {
  return new Set(norm.split(' ').filter((w) => w.length > 2 && !STOP.has(w)))
}

/** Similaritate 0–1 (Jaccard pe tokenii semnificativi; 1 = normalizări egale). */
export function similaritate(a: string, b: string): number {
  const na = normalizeaza(a)
  const nb = normalizeaza(b)
  if (na === nb) return 1
  const ta = tokeni(na)
  const tb = tokeni(nb)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const w of ta) if (tb.has(w)) inter++
  const uni = ta.size + tb.size - inter
  return uni === 0 ? 0 : inter / uni
}

/** Aceeași cerință, spusă (poate) altfel? Pragul e sus (0.8) ca să nu unească
 *  două cereri diferite care doar împart câteva cuvinte. */
export function esteDuplicat(a: string, b: string, prag = 0.8): boolean {
  return similaritate(a, b) >= prag
}
