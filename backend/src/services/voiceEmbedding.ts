// ── AMPRENTĂ VOCALĂ NEURALĂ (Adrian, 6 aug) ─────────────────────────────────
// „amprenta e ca ADN-ul, nu 9 numere; instalează soft de amprentă vocală
// specializat; el trebuie să recunoască userul după voce indiferent dacă e
// răgușit." — ordinul lui, verbatim.
//
// Înlocuiește vectorul HAND-CRAFTED de 9 dimensiuni (pitch/energie/zcr…,
// z-score per rostire — zgomotos, „derapa" pe aceeași persoană) cu un EMBEDDING
// NEURAL REAL de 256 de dimensiuni, produs de wespeaker ResNet34 (antrenat pe
// VoxCeleb), rulat LOCAL prin sherpa-onnx (Apache-2.0). Robust la răgușeală,
// zgomot, ton. Cost ZERO (rulează pe VPS, fără API), licență curată comercial.
//
// Modelul: backend/models/wespeaker_en_voxceleb_resnet34.onnx (26MB, bundle-uit
// în imagine). Extractorul se încarcă O SINGURĂ DATĂ (lazy singleton).
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { cosine } from './embeddings.js'

const require = createRequire(import.meta.url)

/** Dimensiunea embedding-ului neural (wespeaker ResNet34). Deosebit clar de
 *  vechiul vector de 9 — folosit ca să recunoaștem o amprentă VECHE incompatibilă
 *  (dimensiune ≠ 256 → re-înrolare). */
export const VOICE_EMBED_DIM = 256

const MODEL_PATH = fileURLToPath(new URL('../../models/wespeaker_en_voxceleb_resnet34.onnx', import.meta.url))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null
let incarcatEsuat = false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getExtractor(): any {
  if (extractor || incarcatEsuat) return extractor
  try {
    // sherpa-onnx-node e CommonJS — createRequire ca să meargă din ESM.
    const sherpa = require('sherpa-onnx-node') as {
      SpeakerEmbeddingExtractor: new (o: { model: string; numThreads: number; debug: boolean }) => unknown
    }
    extractor = new sherpa.SpeakerEmbeddingExtractor({ model: MODEL_PATH, numThreads: 1, debug: false })
  } catch (e) {
    // Fără model/binar (ex. build fără modelul bundle-uit) → NU crăpăm: întoarcem
    // null, iar apelantul cade grațios pe „nu pot verifica" (regula #1), nu pe o
    // stare inventată.
    incarcatEsuat = true
    console.error('[voice-embed] extractorul neural nu s-a încărcat:', String((e as Error)?.message).slice(0, 200))
  }
  return extractor
}

/** true dacă amprenta neurală e disponibilă (model + binar încărcate). */
export function amprentaNeuralaGata(): boolean {
  return !!getExtractor()
}

/**
 * Embedding-ul vocal (256 de valori) din PCM mono float32 la 16 kHz.
 * Întoarce `null` dacă audio-ul e prea scurt (<0.3s), modelul lipsește, sau
 * orice eroare — NICIODATĂ un vector inventat.
 */
export function voiceEmbedding(samples: Float32Array, sampleRate = 16000): number[] | null {
  const ext = getExtractor()
  if (!ext) return null
  if (!samples || samples.length < Math.floor(sampleRate * 0.3)) return null
  try {
    const stream = ext.createStream()
    stream.acceptWaveform({ samples, sampleRate })
    const emb = ext.compute(stream) as Float32Array
    if (!emb || emb.length !== VOICE_EMBED_DIM) return null
    return Array.from(emb)
  } catch (e) {
    console.error('[voice-embed] calcul embedding eșuat:', String((e as Error)?.message).slice(0, 200))
    return null
  }
}

/**
 * Decodează un data-URI WAV (PCM 16-bit mono, orice rate) → Float32 PCM 16 kHz.
 * Formatul e exact cel produs de client (lib/micStream.ts wavDataUri16k: RIFF/WAVE,
 * PCM, mono, 16-bit, 16k). Robustă: dacă rate ≠ 16k, reeșantionează liniar.
 * Întoarce null dacă nu e un WAV PCM valid.
 */
export function pcm16kDinWavDataUri(dataUri: string): Float32Array | null {
  try {
    const m = /^data:audio\/[^;]+;base64,(.+)$/.exec(dataUri)
    if (!m) return null
    const buf = Buffer.from(m[1], 'base64')
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
    // Parcurgem chunk-urile ca să găsim `fmt ` și `data` (nu presupunem offset fix).
    let fmtRate = 16000
    let fmtBits = 16
    let fmtCh = 1
    let dataOff = -1
    let dataLen = 0
    let p = 12
    while (p + 8 <= buf.length) {
      const id = buf.toString('ascii', p, p + 4)
      const sz = buf.readUInt32LE(p + 4)
      const body = p + 8
      if (id === 'fmt ' && body + 16 <= buf.length) {
        fmtCh = buf.readUInt16LE(body + 2)
        fmtRate = buf.readUInt32LE(body + 4)
        fmtBits = buf.readUInt16LE(body + 14)
      } else if (id === 'data') {
        dataOff = body
        dataLen = Math.min(sz, buf.length - body)
        break
      }
      p = body + sz + (sz & 1) // chunk-urile sunt aliniate la 2 octeți
    }
    if (dataOff < 0 || fmtBits !== 16) return null
    const nSamp = Math.floor(dataLen / 2 / Math.max(1, fmtCh))
    const raw = new Float32Array(nSamp)
    for (let i = 0; i < nSamp; i++) {
      // mono: primul canal; dacă ar fi stereo, luăm canalul 0.
      const s = buf.readInt16LE(dataOff + i * 2 * fmtCh)
      raw[i] = s < 0 ? s / 0x8000 : s / 0x7fff
    }
    if (fmtRate === 16000) return raw
    // reeșantionare liniară → 16k (suficient pentru embedding)
    const ratio = fmtRate / 16000
    const outLen = Math.floor(raw.length / ratio)
    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) out[i] = raw[Math.floor(i * ratio)]
    return out
  } catch {
    return null
  }
}

/** Similaritate cosinus [−1, 1] între două embedding-uri. Cu cât mai mare, cu
 *  atât mai aceeași voce (1 = identic). Întoarce -1 la intrări invalide. */
export function cosineSim(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return -1
  // Bucla trăiește O SINGURĂ dată, în embeddings.ts (`cosine`) — era copiată
  // aici identic. Ce rămâne aici e DOAR contractul propriu al vocii: lungimi
  // egale obligatoriu, iar „nu pot compara" se spune cu -1, nu cu 0 (0 e o
  // similaritate perfect validă — vectori perpendiculari). Suma pătratelor e 0
  // doar când toate valorile sunt 0, deci verificarea de mai jos e exact
  // condiția de normă zero din formulă, nu o aproximare.
  if (a.every((x) => x === 0) || b.every((x) => x === 0)) return -1
  return cosine(a, b)
}
