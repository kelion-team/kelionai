// ── VĂZUL OFFLINE (Faza 1 · M5): Kelion VEDE fără net ───────────────────────
// Owner (PROIECT-OFFLINE-FIRST §3, M5 = ultimul simț offline; „pornește m4 și 5"):
// „descrie scena" pe dispozitiv. Model de captioning (image-to-text) prin
// `@huggingface/transformers` — rulează ÎN BROWSER pe WASM (onnxruntime-WEB, nu Node),
// offline, GRATIS. Modelul se descarcă o dată (ca și creierul/urechea), apoi merge fără net.
//
// CUM VEDE creierul: modelele locale (Qwen/Gemma) sunt DOAR-text — nu pot „vedea"
// pixeli. Deci văzul produce o DESCRIERE SCURTĂ în text (o legendă a cadrului) care se
// injectează în contextul de sistem al creierului local (lângă semnalul feței + GPS din
// contextOffline). Kelion menționează ce vede, ca un om care observă — nu robotic.
//
// FĂRĂ LATENȚĂ pe tură: captioning-ul rulează ÎN FUNDAL (ca eșantionarea feței din
// faceprint.ts), la ~8s, și lasă ultima legendă într-un cache; tura offline o CITEȘTE
// instant (nu așteaptă nicio inferență).
//
// SECURITATE (onest, ca la ureche): transformers.js aduce în arbore și `onnxruntime-node`
// + `sharp` (backend-uri de NODE), dar acelea NU ajung în pachetul din browser (folosim
// doar calea WEB/WASM + OffscreenCanvas), deci ZERO expunere pentru user; doar zgomot în
// `npm audit` la dev.
//
// Cinstit (regula #1): dacă modelul nu-i pregătit, n-avem cadru, sau browserul n-are
// OffscreenCanvas (transformers.js îl cere la preprocesarea imaginii) → NU inventează o
// scenă, întoarce '' (gol = omis din context).

export type StareVaz = 'neintrodus' | 'se_pregateste' | 'gata' | 'eroare'

// Model REAL de captioning din Hugging Face (Xenova/transformers.js), implicitul
// pipeline-ului `image-to-text`. Rulează în browser pe WASM.
// hardcod-permis: id de model client de captioning (capabilitate offline), nu valoare de afișat/tarifat.
const MODEL_VAZ = 'Xenova/vit-gpt2-image-captioning'

let stare: StareVaz = 'neintrodus'
let motivEroare = ''
let progres = 0
// Pipeline-ul de captioning, tipat lax (nu forțăm tipurile bibliotecii peste tot).
let descriptor: ((image: string) => Promise<Array<{ generated_text?: string }> | { generated_text?: string }>) | null =
  null
let pregatire: Promise<boolean> | null = null

/** Starea + progresul văzului offline (fără să forțeze ceva). Pentru UI/decizii. */
export function stareVazOffline(): { stare: StareVaz; progres: number; motiv: string } {
  return { stare, progres, motiv: motivEroare }
}

/** Descarcă + încarcă modelul de captioning (o dată; idempotent). De chemat cât AI NET.
 *  `onProgress` primește 0..1. Întoarce dacă e gata. */
export async function pregatesteVazOffline(onProgress?: (p: number) => void): Promise<boolean> {
  if (stare === 'gata') return true
  if (pregatire) return pregatire
  stare = 'se_pregateste'
  progres = 0
  pregatire = (async () => {
    try {
      const tf = await import('@huggingface/transformers')
      // OFFLINE REAL: onnxruntime-web își ia runtime-ul .wasm LOCAL, de la /ort/ (copiat la
      // build din node_modules, servit + cache-uit de SW), NU de pe CDN (blocat offline + CSP).
      // Modelul vine de la Hugging Face o dată (cu net), apoi rămâne în cache-ul browserului.
      try {
        const env = (tf as unknown as { env?: { backends?: { onnx?: { wasm?: { wasmPaths?: string } } } } }).env
        if (env?.backends?.onnx?.wasm) env.backends.onnx.wasm.wasmPaths = '/ort/'
      } catch {
        /* dacă structura env diferă între versiuni, transformers.js cade pe implicit */
      }
      const { pipeline } = tf
      descriptor = (await pipeline('image-to-text', MODEL_VAZ, {
        // BUG REPARAT (probă LIVE owner 21 aug + REPRODUS și REPARAT în Chromium aici):
        // optimizatorul de graf ORT (nivel extins) pică pe modelul cuantizat q8 la
        // crearea sesiunii („TransposeDQWeightsForMatMulNBits Missing required scale").
        // Cu 'basic', transformarea buggy nu rulează → sesiunea se creează (măsurat: 5s),
        // modelul rămâne cel MIC (q8). Aceeași reparație ca la ureche.
        session_options: { graphOptimizationLevel: 'basic' },
        // progresul descărcării fișierelor modelului (0..1), la fel ca la creier/ureche.
        progress_callback: (info: { status?: string; progress?: number }) => {
          if (typeof info?.progress === 'number') {
            progres = info.progress / 100
            onProgress?.(progres)
          }
        },
      })) as unknown as typeof descriptor
      stare = 'gata'
      progres = 1
      return true
    } catch (e) {
      stare = 'eroare'
      motivEroare = e instanceof Error ? e.message.slice(0, 200) : String(e)
      descriptor = null
      return false
    } finally {
      pregatire = null
    }
  })()
  return pregatire
}

/** Curăță legenda modelului: normalizează spațiile, prima literă mare. '' rămâne ''. */
export function curataLegenda(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Descrie un cadru (data-URL JPEG de la cameră) în text, offline. Cinstit: '' dacă nu-i
 *  pregătit, n-avem cadru, sau modelul crapă (nu inventează). */
async function descrieScena(dataUrl: string): Promise<string> {
  if (stare !== 'gata' || !descriptor || !dataUrl) return ''
  try {
    const r = await descriptor(dataUrl)
    const text = Array.isArray(r) ? (r[0]?.generated_text ?? '') : (r?.generated_text ?? '')
    return curataLegenda(text)
  } catch {
    return ''
  }
}

// ── EȘANTIONARE ÎN FUNDAL (oglindă a faceprint.startFaceSampling) ────────────
const ESANTION_LA_MS = 8000 // o legendă la ~8s (captioning e mai greu decât detecția feței)
const PROASPAT_MS = 30000 // o legendă mai veche de atât e considerată expirată → nu se mai raportează

let ultima: { text: string; at: number } | null = null

/** Pornește captioning-ul de fundal din cadrele camerei. `getFrame` întoarce data-URL JPEG
 *  al cadrului curent (sau null). `esteActiv` (opțional) oprește inferența când e false
 *  (ex. cât suntem online — atunci vederea merge pe server, nu ardem bateria degeaba).
 *  NU blochează chatul; o legendă la ~8s, o singură inferență în zbor. Întoarce funcția de oprire. */
export function porneseteVazSampling(getFrame: () => string | null, esteActiv?: () => boolean): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inZbor = false
  const reprogrameaza = (): void => {
    if (!stopped) timer = setTimeout(() => void tick(), ESANTION_LA_MS)
  }
  const tick = async (): Promise<void> => {
    if (stopped) return
    // Sări dacă: modelul nu-i gata, o legendă e deja în lucru, tab-ul e ascuns (nimic de
    // văzut / economie), sau apelantul zice că nu-i activ (ex. suntem online).
    const inactiv =
      stare !== 'gata' ||
      inZbor ||
      (typeof document !== 'undefined' && document.hidden) ||
      (esteActiv ? !esteActiv() : false)
    if (inactiv) {
      reprogrameaza()
      return
    }
    const cadru = getFrame()
    if (cadru) {
      inZbor = true
      const text = await descrieScena(cadru)
      inZbor = false
      if (!stopped && text) ultima = { text, at: Date.now() }
    }
    reprogrameaza()
  }
  void tick()
  return () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    ultima = null // la oprirea camerei, nu mai raportăm o scenă veche
  }
}

/** Ultima descriere PROASPĂTĂ a scenei (sau '' dacă lipsă/expirată). Instant — nu declanșează
 *  nicio inferență, nu așteaptă nimic. De citit în tura offline, ca la getPendingFaceDescriptor. */
export function descriereVazOffline(): string {
  if (!ultima) return ''
  if (Date.now() - ultima.at > PROASPAT_MS) return ''
  return ultima.text
}
