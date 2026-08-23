// ── REZILIENȚA CREIERULUI (owner, 22 aug 2026: „acționează real") ─────────────
//
// Cascade: device (Ollama pe laptop/telefon) → VPS (Ollama pe server) → Gemini.
// Device prioritar — dacă Ollama rulează pe device-ul utilizatorului, îl folosim
// pe el (zero latență rețea, zero cost cloud). Dacă nu, încercăm VPS. Dacă nici
// VPS, Gemini cloud.
//
// Backend-ul monitorizează Gemini + VPS direct. Starea device-ului e raportată
// de frontend prin POST /api/ollama/local-status (device-ul știe singur dacă
// Ollama e instalat + modelul e tras).
//
// NU înlocuiește scara cu 4 trepte — o EXTINDE: când Gemini e viu, scara merge
// pe Gemini (flash → Pro → ultra). Când Gemini pică complet, se adaugă Ollama
// ca treaptă finală de rezervă (device → VPS).

export interface StareRezilinta {
  geminiDisponibil: boolean
  ollamaVpsDisponibil: boolean
  ollamaDeviceDisponibil: boolean // raportat de frontend
  furnizorActiv: 'device' | 'vps' | 'gemini' | 'niciunul'
  ultimaVerificare: number
  ultimulMotiv: string
}

let stare: StareRezilinta = {
  geminiDisponibil: true,
  ollamaVpsDisponibil: false,
  ollamaDeviceDisponibil: false,
  furnizorActiv: 'gemini',
  ultimaVerificare: 0,
  ultimulMotiv: 'initializare',
}

let ultimaRaportareDevice = 0
const TIMEOUT_RAPORTARE_DEVICE_MS = 5 * 60_000 // dacă frontend-ul nu raportează 5 min, considerăm device-ul absent

const INTERVAL_VERIFICARE_MS = 60_000 // verifică la fiecare minut

/** Frontend-ul raportează starea Ollama de pe device. */
export function raporteazaStareDevice(disponibil: boolean): void {
  stare.ollamaDeviceDisponibil = disponibil
  ultimaRaportareDevice = Date.now()
}

/** Verifică dacă Ollama de pe VPS e disponibil. */
async function verificaOllamaVps(): Promise<boolean> {
  try {
    const { probaOllamaLocal } = await import('./constructorLocal.js')
    const r = await probaOllamaLocal()
    return r.ok
  } catch {
    return false
  }
}

/** Verifică dacă Gemini e disponibil. */
async function verificaGemini(): Promise<boolean> {
  try {
    const { verifyKeys } = await import('./brain.js')
    const r = await verifyKeys()
    return r.primary === 'ok'
  } catch {
    return false
  }
}

/** Device-ul mai e considerat viu? (raportare recentă) */
function deviceViu(): boolean {
  if (!stare.ollamaDeviceDisponibil) return false
  return Date.now() - ultimaRaportareDevice < TIMEOUT_RAPORTARE_DEVICE_MS
}

/** Actualizează starea rezilienței. Apelat periodic din index.ts. */
export async function verificaRezilinta(): Promise<StareRezilinta> {
  const acum = Date.now()
  stare.ultimaVerificare = acum
  const [gemini, ollamaVps] = await Promise.all([verificaGemini(), verificaOllamaVps()])
  stare.geminiDisponibil = gemini
  stare.ollamaVpsDisponibil = ollamaVps
  // Cascade: device → VPS → Gemini
  if (deviceViu()) {
    stare.furnizorActiv = 'device'
    stare.ultimulMotiv = 'ollama pe device-ul utilizatorului — zero latență rețea'
  } else if (ollamaVps) {
    stare.furnizorActiv = 'vps'
    stare.ultimulMotiv = 'ollama pe VPS — rezerva de pe server'
  } else if (gemini) {
    stare.furnizorActiv = 'gemini'
    stare.ultimulMotiv = 'gemini cloud — calea principală'
  } else {
    stare.furnizorActiv = 'niciunul'
    stare.ultimulMotiv = 'ATENȚIE: nici device, nici VPS, nici gemini nu sunt disponibile'
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

/** Dacă Ollama VPS e disponibil ca fallback. */
function ollamaDisponibil(): boolean {
  return stare.ollamaVpsDisponibil
}

/** Pornește monitorizarea periodică a rezilienței. */
export function pornesteMonitorizareaRezilientei(): void {
  void verificaRezilinta()
  setInterval(() => { void verificaRezilinta().catch(() => {}) }, INTERVAL_VERIFICARE_MS)
}

