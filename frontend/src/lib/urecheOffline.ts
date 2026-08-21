// ── URECHEA OFFLINE (Faza 1 · M4): Kelion AUDE fără net ─────────────────────
// Owner (PROIECT-OFFLINE-FIRST §3, M4 = „munca grea"): STT on-device. Folosim
// Whisper prin `@huggingface/transformers` (transformers.js) — rulează ÎN BROWSER
// pe WASM/WebGPU (onnxruntime-WEB, nu Node), offline, GRATIS. Modelul se descarcă
// o dată (ca și creierul), apoi merge fără net.
//
// SECURITATE (onest): transformers.js aduce în arbore și `onnxruntime-node` + `sharp`
// (backend-uri de NODE, cu vulnerabilități) — dar acelea NU ajung în pachetul din
// browser (folosim doar calea WEB/WASM), deci ZERO expunere pentru user; e doar
// zgomot în `npm audit` pe partea de dezvoltare.
//
// Cinstit (regula #1): dacă modelul nu-i pregătit, spune, nu inventează transcriere.

export type StareUreche = 'neintrodus' | 'se_pregateste' | 'gata' | 'eroare'

// Model Whisper mic, multilingv (owner RO + userii pe 7 limbi), destul de mic cât
// să încapă pe telefon. Id REAL din Hugging Face (onnx-community/transformers.js).
// hardcod-permis: id de model client Whisper (capabilitate offline), nu valoare de afișat/tarifat.
const MODEL_URECHE = 'onnx-community/whisper-base'

let stare: StareUreche = 'neintrodus'
let motivEroare = ''
let progres = 0
// Pipeline-ul de recunoaștere, tipat lax (nu forțăm tipurile bibliotecii peste tot).
let recunoscator: ((audio: Float32Array, optiuni?: unknown) => Promise<{ text?: string }>) | null = null
let pregatire: Promise<boolean> | null = null

/** Starea + progresul urechii offline (fără să forțeze ceva). Pentru UI/decizii. */
export function stareUrecheOffline(): { stare: StareUreche; progres: number; motiv: string } {
  return { stare, progres, motiv: motivEroare }
}

/** Descarcă + încarcă modelul Whisper (o dată; idempotent). De chemat cât AI NET.
 *  `onProgress` primește 0..1. Întoarce dacă e gata. */
export async function pregatesteUrecheOffline(onProgress?: (p: number) => void): Promise<boolean> {
  if (stare === 'gata') return true
  if (pregatire) return pregatire
  stare = 'se_pregateste'
  progres = 0
  pregatire = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers')
      recunoscator = (await pipeline('automatic-speech-recognition', MODEL_URECHE, {
        // progresul descărcării fișierelor modelului (0..1), la fel ca la creier.
        progress_callback: (info: { status?: string; progress?: number }) => {
          if (typeof info?.progress === 'number') {
            progres = info.progress / 100
            onProgress?.(progres)
          }
        },
      })) as unknown as typeof recunoscator
      stare = 'gata'
      progres = 1
      return true
    } catch (e) {
      stare = 'eroare'
      motivEroare = e instanceof Error ? e.message.slice(0, 200) : String(e)
      recunoscator = null
      return false
    } finally {
      pregatire = null
    }
  })()
  return pregatire
}

/** Transcrie audio (mono Float32, 16 kHz) în text, offline. Cinstit: dacă nu-i
 *  pregătit, întoarce '' (nu inventează). `lang` orientează Whisper spre limbă. */
export async function transcrieOffline(audio: Float32Array, lang?: string): Promise<string> {
  if (stare !== 'gata' || !recunoscator) return ''
  try {
    const r = await recunoscator(audio, lang ? { language: lang, task: 'transcribe' } : { task: 'transcribe' })
    return (r?.text ?? '').trim()
  } catch {
    return ''
  }
}
