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

/** Eșantionare în jos (rata contextului → 16 kHz) CU filtru anti-alias.
 *  Când rata coincide, întoarce ACEEAȘI referință: zero copiere pe calea critică.
 *
 *  DE CE media, nu eșantionarea-punct (owner, 13 aug: „tot ce trimit audio =
 *  varză", „primul cuvânt nu-l aude corect" — MĂSURAT pe vocea lui: „Kelion" →
 *  „Kelemen"): la 48 kHz → 16 kHz, Nyquist-ul noii rate e 8 kHz. Vechiul cod lua
 *  `input[floor(i*ratio)]` — un eșantion din 3, FĂRĂ să taie nimic peste 8 kHz.
 *  Orice energie de peste 8 kHz (sâsâitul consoanelor, zgomotul de fond, hârâitul
 *  microfonului) se PLIAZĂ (aliasing) înapoi peste voce, ca frecvențe false care
 *  nu erau acolo — exact „bruiajul cu cauza imposibil de găsit cu urechea" din
 *  antetul fișierului, și exact ce aude Google când transcrie: silabe stâlcite.
 *  Media pe o fereastră proporțională cu factorul de decimare (`win ≈ ratio`) e
 *  un filtru trece-jos simplu (FIR box) care atenuează banda de peste ~8 kHz
 *  ÎNAINTE de decimare, deci nu se mai pliază. Nu e brick-wall, dar ține banda
 *  vocii (sub 8 kHz) și scoate aliasing-ul — dovada e în pcm.test.ts: un ton de
 *  15 kHz iese ca alias puternic pe calea veche și atenuat pe asta. Fereastra
 *  se calculează pe `ratio` real, deci merge și pe rate ne-întregi (44.1→16). */
export function downsample(input: Float32Array, inRate: number): Float32Array {
  // (tipul rămâne larg aici: intrarea vine din Web Audio, care dă ArrayBufferLike)
  if (inRate === TARGET_RATE) return input
  const ratio = inRate / TARGET_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  // La upsampling (ratio < 1, rar — un context sub 16 kHz) media n-ar avea sens:
  // fereastra e 1, deci se reduce la eșantionare, fără să strice nimic.
  const win = Math.max(1, Math.round(ratio))
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio)
    let suma = 0
    let n = 0
    for (let k = 0; k < win && start + k < input.length; k++) {
      suma += input[start + k]
      n++
    }
    out[i] = n ? suma / n : 0
  }
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
