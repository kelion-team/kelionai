// ── OPUS PE VOCEA LIVE — PARTEA DE SERVER (owner, 12 aug: „fă Opus") ─────────
//
// Serverul stă între browser și OpenAI Realtime. Realtime folosește PCM pe
// conexiunea upstream, iar browserul poate folosi Opus pe legătura proprie.
// hopul browser↔server e AL NOSTRU — acolo comprimăm cu Opus (~10×), fix banda
// care doare pe 3G-ul omului.
//
// Ce face serverul:
//   - DECODE upload: pachet Opus 16 kHz de la browser → PCM 16 kHz.
//   - ENCODE download: PCM 24 kHz de la Realtime → pachete Opus 24 kHz.
//
// Opus lucrează pe cadre FIXE (20 ms). La 16 kHz = 320 mostre = 640 octeți; la
// 24 kHz = 480 mostre = 960 octeți. Fluxul upstream vine în bucăți de mărimi
// arbitrare, deci îl REÎNCADRĂM la 20 ms înainte de encode (restul se ține).
//
// SIGURANȚĂ: codecul (opusscript, pur-JS/WASM, fără build nativ) se încarcă LENE
// și cu plasă — dacă nu se încarcă, `creeazaOpusVoce` întoarce null și calea
// rămâne PCM. Nimic din asta nu pornește dacă `config.voiceOpus` e stins.

const RATA_SUS = 16_000 // microfon → Realtime
const RATA_JOS = 24_000 // Realtime → difuzor
const MS_CADRU = 20
export const MOSTRE_JOS = (RATA_JOS * MS_CADRU) / 1000 // 480
export const OCTETI_CADRU_JOS = MOSTRE_JOS * 2 // 960 (PCM16)

/** Taie (rest + bucata nouă) în cadre FIXE de `octetiCadru` octeți; întoarce
 *  cadrele întregi + restul neîncadrat (ținut pentru data viitoare). PURĂ, ca
 *  s-o putem proba fără codec. */
export function reincadreaza(rest: Buffer, bucata: Buffer, octetiCadru: number): { cadre: Buffer[]; rest: Buffer } {
  const tot = rest.length ? Buffer.concat([rest, bucata]) : bucata
  const cadre: Buffer[] = []
  let i = 0
  for (; i + octetiCadru <= tot.length; i += octetiCadru) {
    cadre.push(tot.subarray(i, i + octetiCadru))
  }
  return { cadre, rest: tot.subarray(i) }
}

interface OpusCodec {
  encode(buffer: Buffer, frameSize: number): Buffer
  decode(buffer: Buffer): Buffer
  delete(): void
}
type OpusCtor = new (rate: number, channels: number, app: number) => OpusCodec

let ctorCache: OpusCtor | null | undefined // undefined = neîncercat, null = eșuat
async function incarcaCtor(): Promise<OpusCtor | null> {
  if (ctorCache !== undefined) return ctorCache
  try {
    const mod = (await import('opusscript')) as unknown as { default: OpusCtor } | OpusCtor
    const ctor = (mod as { default?: OpusCtor }).default ?? (mod as OpusCtor)
    // VOIP = 2048 (optimizat pentru voce/latență mică).
    ctorCache = ctor
  } catch {
    ctorCache = null
  }
  return ctorCache
}

export class OpusVoce {
  private encJos: OpusCodec // 24 kHz, pentru download
  private decSus: OpusCodec // 16 kHz, pentru upload
  private restJos: Buffer = Buffer.alloc(0)

  private constructor(ctor: OpusCtor) {
    this.encJos = new ctor(RATA_JOS, 1, 2048)
    this.decSus = new ctor(RATA_SUS, 1, 2048)
  }

  static async creeaza(): Promise<OpusVoce | null> {
    const ctor = await incarcaCtor()
    if (!ctor) return null
    try {
      return new OpusVoce(ctor)
    } catch {
      return null
    }
  }

  /** Pachet Opus 16 kHz (de la microfon) → PCM16 16 kHz (spre Realtime). null la
   *  pachet corupt — cadrul se sare, nu se prăbușește sesiunea. */
  decodeUpload(pachet: Buffer): Buffer | null {
    if (!pachet.length) return null
    try {
      return this.decSus.decode(pachet)
    } catch {
      return null
    }
  }

  /** PCM16 24 kHz (de la Realtime) → pachete Opus 24 kHz (spre browser), pe cadre
   *  de 20 ms; restul neîncadrat se ține pentru apelul următor. */
  encodeDownload(pcm: Buffer): Buffer[] {
    const { cadre, rest } = reincadreaza(this.restJos, pcm, OCTETI_CADRU_JOS)
    this.restJos = rest
    const out: Buffer[] = []
    for (const cadru of cadre) {
      try {
        out.push(this.encJos.encode(cadru, MOSTRE_JOS))
      } catch {
        /* un cadru pierdut ≫ sesiune moartă */
      }
    }
    return out
  }

  /** Golește restul de download (la barge-in/tăiere): un cadru parțial din
   *  replica veche nu are ce căuta lipit de următoarea. */
  reseteazaDownload(): void {
    this.restJos = Buffer.alloc(0)
  }

  inchide(): void {
    try { this.encJos.delete() } catch { /* ignorat */ }
    try { this.decSus.delete() } catch { /* ignorat */ }
  }
}

/** Fabrica cu plasă: null când codecul nu se încarcă (calea rămâne PCM). */
export async function creeazaOpusVoce(): Promise<OpusVoce | null> {
  return OpusVoce.creeaza()
}
