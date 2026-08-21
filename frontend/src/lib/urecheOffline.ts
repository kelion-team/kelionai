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
      const tf = await import('@huggingface/transformers')
      // OFFLINE REAL: onnxruntime-web își ia runtime-ul .wasm LOCAL, de la /ort/ (copiat
      // la build din node_modules, servit + cache-uit de SW), NU de pe CDN — care e
      // blocat offline + de CSP. Modelul vine de la Hugging Face o dată (cu net), apoi
      // rămâne în cache-ul browserului și merge fără net.
      try {
        const env = (tf as unknown as { env?: { backends?: { onnx?: { wasm?: { wasmPaths?: string } } } } }).env
        if (env?.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/'
      } catch {
        /* dacă structura env diferă între versiuni, transformers.js cade pe implicit */
      }
      const { pipeline } = tf
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

// Reeșantionare liniară simplă la 16 kHz (Whisper vrea 16 kHz). Dacă AudioContext-ul
// chiar dă 16 kHz (Chrome/Firefox onorează cererea), e no-op.
function la16k(input: Float32Array, rataIn: number): Float32Array {
  if (rataIn === 16000 || input.length === 0) return input
  const raport = 16000 / rataIn
  const nOut = Math.max(1, Math.round(input.length * raport))
  const out = new Float32Array(nOut)
  for (let i = 0; i < nOut; i++) {
    const poz = i / raport
    const j = Math.floor(poz)
    const frac = poz - j
    out[i] = (input[j] ?? 0) * (1 - frac) + (input[j + 1] ?? input[j] ?? 0) * frac
  }
  return out
}

export interface ControlAscultare {
  /** Oprește microfonul și întoarce transcrierea (offline, prin Whisper). */
  opreste(): Promise<string>
  /** Renunță fără transcriere (eliberează microfonul). */
  anuleaza(): void
}

/** Ascultă la microfon (offline) și, la `opreste()`, transcrie ce s-a spus prin Whisper
 *  local. Întoarce null dacă urechea nu-i pregătită sau nu e microfon. O singură gură/
 *  ureche — apelantul oprește vocea offline înainte, ca să nu se-audă pe el. */
export async function ascultaOffline(lang?: string): Promise<ControlAscultare | null> {
  if (stare !== 'gata') return null
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    return null
  }
  const AC =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop())
    return null
  }
  // Cerem direct 16 kHz (Chrome/Firefox reeșantionează microfonul); dacă browserul
  // ignoră cererea, `la16k` corectează la oprire.
  let ctx: AudioContext
  try {
    ctx = new AC({ sampleRate: 16000 })
  } catch {
    ctx = new AC()
  }
  void ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const bucati: Float32Array[] = []
  proc.onaudioprocess = (e) => {
    // copie (bufferul e reutilizat de browser) — nu scriem outputBuffer → tăcere, fără ecou.
    bucati.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  source.connect(proc)
  proc.connect(ctx.destination) // în unele browsere callback-ul pornește doar conectat
  const curata = (): void => {
    try {
      proc.disconnect()
      source.disconnect()
    } catch {
      /* deja deconectat */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }
  return {
    async opreste(): Promise<string> {
      const rata = ctx.sampleRate
      curata()
      const total = bucati.reduce((n, b) => n + b.length, 0)
      if (total === 0) return ''
      const brut = new Float32Array(total)
      let off = 0
      for (const b of bucati) {
        brut.set(b, off)
        off += b.length
      }
      return transcrieOffline(la16k(brut, rata), lang)
    },
    anuleaza(): void {
      curata()
    },
  }
}
