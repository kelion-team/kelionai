// ── REZILIENȚA CREIERULUI (owner, 22 aug 2026: „acționează real") ─────────────
//
// Monitorizează disponibilitatea Gemini și, când pică complet (toate treptele
// scării returnează eroare), activează fallback-ul pe Ollama local. La revenire,
// comută înapoi automat.
//
// NU înlocuiește scara cu 4 trepte — o EXTINDE: când Gemini e viu, scara merge
// pe Gemini (flash → Pro → ultra). Când Gemini pică complet, se adaugă Ollama
// ca treaptă finală de rezervă.
//
// Starea e in-memory + expusă prin GET /api/creier/stare pentru monitoring.

export interface StareRezilinta {
  geminiDisponibil: boolean
  ollamaDisponibil: boolean
  furnizorActiv: 'gemini' | 'ollama' | 'niciunul'
  ultimaVerificare: number
  ultimulMotiv: string
}

let stare: StareRezilinta = {
  geminiDisponibil: true,
  ollamaDisponibil: false,
  furnizorActiv: 'gemini',
  ultimaVerificare: 0,
  ultimulMotiv: 'initializare',
}

const INTERVAL_VERIFICARE_MS = 60_000 // verifică la fiecare minut

/** Verifică dacă Ollama local e disponibil (deja există probaOllamaLocal). */
async function verificaOllama(): Promise<boolean> {
  try {
    const { probaOllamaLocal } = await import('./constructorLocal.js')
    const r = await probaOllamaLocal()
    return r.ok
  } catch {
    return false
  }
}

/** Verifică dacă Gemini e disponibil (ping prin geminiDirect). */
async function verificaGemini(): Promise<boolean> {
  try {
    const { verifyKeys } = await import('./brain.js')
    const r = await verifyKeys()
    return r.primary === 'ok'
  } catch {
    return false
  }
}

/** Actualizează starea rezilienței. Apelat periodic din index.ts. */
export async function verificaRezilinta(): Promise<StareRezilinta> {
  const acum = Date.now()
  stare.ultimaVerificare = acum
  const [gemini, ollama] = await Promise.all([verificaGemini(), verificaOllama()])
  stare.geminiDisponibil = gemini
  stare.ollamaDisponibil = ollama
  if (gemini) {
    stare.furnizorActiv = 'gemini'
    stare.ultimulMotiv = 'gemini disponibil'
  } else if (ollama) {
    stare.furnizorActiv = 'ollama'
    stare.ultimulMotiv = 'gemini indisponibil — fallback pe ollama local'
  } else {
    stare.furnizorActiv = 'niciunul'
    stare.ultimulMotiv = 'ATENȚIE: nici gemini nici ollama nu sunt disponibile'
  }
  return stare
}

/** Starea curentă a rezilienței (pentru monitoring). */
export function stareRezilinta(): StareRezilinta {
  return stare
}

/** Dacă Gemini e disponibil acum. */
export function geminiDisponibil(): boolean {
  return stare.geminiDisponibil
}

/** Dacă Ollama e disponibil ca fallback. */
export function ollamaDisponibil(): boolean {
  return stare.ollamaDisponibil
}

/** Pornește monitorizarea periodică a rezilienței. */
export function pornesteMonitorizareaRezilientei(): void {
  void verificaRezilinta()
  setInterval(() => { void verificaRezilinta().catch(() => {}) }, INTERVAL_VERIFICARE_MS)
}
