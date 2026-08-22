// ── OPUS PE VOCEA LIVE — PARTEA DIN BROWSER (owner, 12 aug: „fă Opus") ───────
//
// Comprimă hopul browser↔server cu Opus (~10×), fix banda care doare pe 3G.
// Folosim WebCodecs (`AudioEncoder`/`AudioDecoder`), care e NATIV în Chromium
// (telefonul/APK-ul owner-ului) — zero dependență, zero WASM de descărcat. Pe
// browserele fără WebCodecs, `esteSuportat()` întoarce false și sesiunea rămâne
// pe PCM (calea de azi). Orice excepție cade tot pe PCM — vocea nu se rupe.
//
//   - encode: microfon PCM 16 kHz (cadre de 20 ms = 320 mostre) → pachete Opus.
//   - decode: pachete Opus 24 kHz de la server → PCM (Float32) → difuzor.

const RATA_SUS = 16_000
const RATA_JOS = 24_000
const MOSTRE_SUS = (RATA_SUS * 20) / 1000 // 320 mostre / cadru (20 ms)

/** WebCodecs + tipurile Opus există în browserul ăsta? */
export function esteSuportat(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof EncodedAudioChunk !== 'undefined'
  )
}

/** Reîncadrează un flux Float32 la cadre FIXE de `n` mostre; întoarce cadrele
 *  întregi + restul (ținut pentru data viitoare). PURĂ — testabilă fără browser. */
export function reincadreazaF32(rest: Float32Array, nou: Float32Array, n: number): { cadre: Float32Array[]; rest: Float32Array } {
  const tot = rest.length ? concatF32(rest, nou) : nou
  const cadre: Float32Array[] = []
  let i = 0
  for (; i + n <= tot.length; i += n) cadre.push(tot.subarray(i, i + n))
  return { cadre, rest: tot.slice(i) }
}
function concatF32(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export class OpusVoceClient {
  private enc: AudioEncoder
  private dec: AudioDecoder
  private restEnc: Float32Array = new Float32Array(0)
  private tsEnc = 0 // microsecunde, cerute continue de encoder
  private tsDec = 0

  private constructor(enc: AudioEncoder, dec: AudioDecoder) {
    this.enc = enc
    this.dec = dec
  }

  /** Creează codecul; null dacă browserul nu poate (→ sesiunea rămâne pe PCM).
   *  `laPachet` primește octeții Opus de microfon (spre server); `laPcm` primește
   *  PCM decodat (Float32 @24 kHz) de redat. `laMoarte` (registrul frontend,
   *  lot C): un codec care MOARE ÎN ZBOR trebuie anunțat — înainte, error-ul de
   *  decoder era înghițit gol și difuzorul rămânea PERMANENT mut cât serverul
   *  continua să trimită Opus (comentariul vechi „serverul o simte" MINȚEA:
   *  serverul nu simțea nimic). Apelantul cade pe PCM și spune serverului. */
  static async creeaza(
    laPachet: (octeti: Uint8Array) => void,
    laPcm: (pcm: Float32Array) => void,
    laMoarte?: (sens: 'encoder' | 'decoder') => void,
  ): Promise<OpusVoceClient | null> {
    if (!esteSuportat()) return null
    try {
      const cfgEnc: AudioEncoderConfig = { codec: 'opus', sampleRate: RATA_SUS, numberOfChannels: 1, bitrate: 24_000 }
      const cfgDec: AudioDecoderConfig = { codec: 'opus', sampleRate: RATA_JOS, numberOfChannels: 1 }
      // Dacă browserul spune clar că nu suportă configul, cădem pe PCM.
      const [okE, okD] = await Promise.all([
        AudioEncoder.isConfigSupported(cfgEnc).then((r) => !!r.supported).catch(() => false),
        AudioDecoder.isConfigSupported(cfgDec).then((r) => !!r.supported).catch(() => false),
      ])
      if (!okE || !okD) return null

      // Moartea se anunță O dată (encoderul și decoderul pot pica împreună).
      let moarteAnuntata = false
      const anuntaMoartea = (sens: 'encoder' | 'decoder'): void => {
        if (moarteAnuntata) return
        moarteAnuntata = true
        try {
          laMoarte?.(sens)
        } catch {
          /* apelantul picat — sesiunea se curăță pe drumul ei */
        }
      }

      const enc = new AudioEncoder({
        output: (chunk) => {
          try {
            const buf = new Uint8Array(chunk.byteLength)
            chunk.copyTo(buf)
            laPachet(buf)
          } catch {
            /* un pachet pierdut ≫ sesiune moartă */
          }
        },
        error: () => anuntaMoartea('encoder'),
      })
      enc.configure(cfgEnc)

      const dec = new AudioDecoder({
        output: (data) => {
          try {
            const f32 = new Float32Array(data.numberOfFrames)
            data.copyTo(f32, { planeIndex: 0, format: 'f32-planar' })
            laPcm(f32)
          } catch {
            /* cadru nedecodat — se sare */
          } finally {
            data.close()
          }
        },
        error: () => anuntaMoartea('decoder'),
      })
      dec.configure(cfgDec)

      return new OpusVoceClient(enc, dec)
    } catch {
      return null
    }
  }

  /** Microfon: acumulează la cadre de 20 ms și le trimite encoderului. Întoarce
   *  false dacă nu s-a putut (apelantul trimite PCM pe cadrul ăla). */
  incarcaMic(f32: Float32Array): boolean {
    try {
      const { cadre, rest } = reincadreazaF32(this.restEnc, f32, MOSTRE_SUS)
      this.restEnc = rest
      for (const cadru of cadre) {
        const data = new AudioData({
          format: 'f32-planar',
          sampleRate: RATA_SUS,
          numberOfFrames: MOSTRE_SUS,
          numberOfChannels: 1,
          timestamp: this.tsEnc,
          data: cadru.slice(), // copie proprie (encode citește async)
        })
        this.tsEnc += 20_000 // 20 ms în microsecunde
        this.enc.encode(data)
        data.close()
      }
      return true
    } catch {
      return false
    }
  }

  /** Pachet Opus 24 kHz de la server → decoder (ieșirea pleacă prin `laPcm`). */
  incarcaOpusJos(octeti: Uint8Array): void {
    try {
      const chunk = new EncodedAudioChunk({ type: 'key', timestamp: this.tsDec, duration: 20_000, data: octeti })
      this.tsDec += 20_000
      this.dec.decode(chunk)
    } catch {
      /* pachet corupt — se sare, difuzorul nu moare */
    }
  }

  /** Golește coada decoderului — redă cadrele Opus rămase în buffer. Fără
   *  asta, finalul fiecărei fraze se poate tăia (WebCodecs nu le scoase pe toate
   *  dacă nu primește flush la final de stream). */
  async flush(): Promise<void> {
    try { await this.dec.flush() } catch { /* nimic de făcut */ }
  }

  inchide(): void {
    try { this.enc.close() } catch { /* ignorat */ }
    try { this.dec.close() } catch { /* ignorat */ }
  }
}
