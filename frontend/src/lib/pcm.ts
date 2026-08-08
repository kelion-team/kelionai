// ── CONVERSIILE DE AUDIO — COD PUR, FĂRĂ BROWSER (7 aug 2026) ───────────────
//
// De ce există separat: `downsample` și conversia Float32→PCM16 trăiau în
// `micStream.ts`, care importă `audioIO.ts`, care atinge `window`/`AudioContext`
// la ÎNCĂRCAREA modulului. Deci nu se puteau proba fără browser — iar o
// conversie greșită nu „sună prost", sună a bruiaj, cu cauza imposibil de găsit
// cu urechea. Aici sunt funcții pure: intră numere, ies numere, se pot proba
// exact, la capetele scalei.
//
// Le folosesc ambele căi vocale: fraza pe WAV (`micStream.ts`) și fluxul
// continuu full-duplex (`vocalLive.ts`). O singură definiție → un singur
// comportament; două copii s-ar fi despărțit tăcut la prima reparație.

/** Rata pe care o cere creierul pentru audio de intrare (PCM16 mono). */
export const TARGET_RATE = 16000

/** Eșantionare liniară în jos (rata contextului → 16 kHz) — suficient pentru voce.
 *  Când rata coincide, întoarce ACEEAȘI referință: zero copiere pe calea critică. */
export function downsample(input: Float32Array, inRate: number): Float32Array {
  // (tipul rămâne larg aici: intrarea vine din Web Audio, care dă ArrayBufferLike)
  if (inRate === TARGET_RATE) return input
  const ratio = inRate / TARGET_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)]
  return out
}

/** Float32 [-1,1] → PCM16 little-endian. Valorile din afara scalei se TAIE, nu se
 *  lasă să depășească: fără limitare, 1.5 ar ieși negativ în int16 — adică un pocnet. */
export function float32ToPcm16(chunks: Float32Array[]): Int16Array<ArrayBuffer> {
  let total = 0
  for (const c of chunks) total += c.length
  const pcm = new Int16Array(total)
  let o = 0
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      pcm[o++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  return pcm
}

/** PCM16 little-endian → Float32 [-1,1], ce cere Web Audio la redare. Un octet
 *  impar la coadă (cadru tăiat pe rețea) se ignoră — NU se citește peste
 *  marginea bufferului, altfel redarea ar arunca RangeError. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const n = bytes.length >> 1
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 0x8000
  return out
}

/** base64 → octeți, caracter cu caracter. Fără spread cu zeci de mii de
 *  argumente: aruncă „Maximum call stack" pe unele motoare (lecție deja plătită). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
