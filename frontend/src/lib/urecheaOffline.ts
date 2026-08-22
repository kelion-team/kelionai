// ── URECHEA OFFLINE — puntea către lucrătorul Whisper ────────────────────────
// Interfața subțire pe firul UI: pornește lucrătorul, cere pregătirea
// (descarcă modelul DOAR când kitul o cere — online, invizibil) și transcrie
// fraze PCM 16 kHz (exact ce produce micStream la onPhrase). Best-effort:
// nicio cădere de aici nu are voie să dărâme aplicația.
import type { Lang } from './i18n'

let lucrator: Worker | null = null
let gata = false
let pregatire: Promise<boolean> | null = null
let idUrmator = 1
const asteptari = new Map<number, (text: string | null) => void>()

function porneste(): Worker {
  if (lucrator) return lucrator
  lucrator = new Worker(new URL('./urecheaOffline.worker.ts', import.meta.url), { type: 'module' })
  lucrator.onmessage = (ev: MessageEvent<{ tip: string; id?: number; text?: string; motiv?: string }>) => {
    const m = ev.data
    if (m.tip === 'gata') gata = true
    if ((m.tip === 'text' || m.tip === 'eroare') && m.id != null) {
      const rezolva = asteptari.get(m.id)
      asteptari.delete(m.id)
      rezolva?.(m.tip === 'text' ? (m.text ?? '') : null)
    }
  }
  lucrator.onerror = () => {
    // Lucrătorul a murit — urechea nu e disponibilă; nu aruncăm nimic.
    gata = false
  }
  return lucrator
}

/** Urechea e gata de folosit (modelul încărcat în lucrător)? Sincron. */
export function urecheaOfflineGata(): boolean {
  return gata
}

/** Pregătește urechea: pornește lucrătorul + încarcă (și, la nevoie, descarcă)
 *  modelul. Kitul o cheamă ONLINE (download invizibil); la pornirea modului
 *  offline o cheamă din nou — atunci modelul vine din cache, fără rețea. */
export function pregatesteUrecheaOffline(): Promise<boolean> {
  if (gata) return Promise.resolve(true)
  pregatire =
    pregatire ??
    new Promise<boolean>((rezolva) => {
      try {
        const w = porneste()
        const veghe = (ev: MessageEvent<{ tip: string }>) => {
          if (ev.data?.tip === 'gata') {
            w.removeEventListener('message', veghe as EventListener)
            rezolva(true)
          }
          if (ev.data?.tip === 'eroare') {
            w.removeEventListener('message', veghe as EventListener)
            pregatire = null
            rezolva(false)
          }
        }
        w.addEventListener('message', veghe as EventListener)
        w.postMessage({ tip: 'pregateste' })
      } catch {
        pregatire = null
        rezolva(false)
      }
    })
  return pregatire
}

/** WAV 16-bit mono base64 (exact ce dă micStream la onPhrase) → Float32Array
 *  PCM pentru Whisper. PURĂ — testabilă fără browser. Header-ul WAV standard
 *  are 44 de octeți; nu validăm agresiv (sursa e a noastră). */
export function wavBase64LaFloat32(b64: string): Float32Array {
  const brut = atob(b64)
  const octeti = new Uint8Array(brut.length)
  for (let i = 0; i < brut.length; i++) octeti[i] = brut.charCodeAt(i)
  const date = new DataView(octeti.buffer)
  const mostre = Math.max(0, Math.floor((octeti.length - 44) / 2))
  const iesire = new Float32Array(mostre)
  for (let i = 0; i < mostre; i++) iesire[i] = date.getInt16(44 + i * 2, true) / 32768
  return iesire
}

// Limba noastră → eticheta whisper (nume întregi englezești).
const LIMBA_WHISPER: Record<string, string> = {
  ro: 'romanian', en: 'english', es: 'spanish', fr: 'french',
  de: 'german', it: 'italian', pt: 'portuguese',
}

/** Transcrie o frază PCM mono 16 kHz. `null` = urechea n-a putut (apelantul
 *  NU inventează text — fraza se pierde onest, cu jurnal). */
export function transcrieOffline(audio: Float32Array, lang: Lang | string): Promise<string | null> {
  if (!gata || !lucrator) return Promise.resolve(null)
  const id = idUrmator++
  return new Promise((rezolva) => {
    asteptari.set(id, rezolva)
    try {
      lucrator?.postMessage({ tip: 'transcrie', audio, limba: LIMBA_WHISPER[lang] ?? 'romanian', id })
    } catch {
      asteptari.delete(id)
      rezolva(null)
    }
    // Plasa: o transcriere care nu se întoarce în 60s nu ține fraza captivă.
    setTimeout(() => {
      if (asteptari.has(id)) {
        asteptari.delete(id)
        rezolva(null)
      }
    }, 60_000)
  })
}
