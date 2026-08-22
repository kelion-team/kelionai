// ── GURA OFFLINE ADEVĂRATĂ: Piper (voce masculină constantă) + BUZE ──────────
//
// Ordinul din 22 aug („la lipsa semnal nu are activate toate functiile de
// baza… auto download invizibil cu toate" + „aceeiasi voce masculina" +
// „animatia gurii… identice"): vocea browserului (voceBrowser.ts) rămâne DOAR
// ultima redută — timbrul ei diferă de la telefon la telefon și nu mișcă
// buzele. Aici e gura adevărată: modelul Piper `ro_RO-mihai-medium` (63 MB,
// masculin, singura voce RO din familia Piper — verificat pe HuggingFace,
// 22 aug), descărcat automat de kit (kitOffline.ts) și stocat în OPFS de
// bibliotecă; sunetul lui trece prin ACELAȘI mecanism care mișcă buzele
// online (alimenteazaNivelVoce) — gura avatarului se mișcă identic.
//
// Lecția căderii ONNX din 21 aug, mecanizată: versiuni FIXATE
// (onnxruntime-web@1.18.0, exact cea testată de piper-tts-web) și
// runtime-urile servite DE PE DOMENIUL NOSTRU (/ort/, /piper/ — copiate din
// node_modules la build de scripts/copiaza-active-offline.mjs), nu de pe
// CDN-uri străine care pot dispărea sau împinge altă versiune.
import { alimenteazaNivelVoce, getVoiceVolume } from './audioIO'
import { vorbesteLocal } from './voceBrowser'
import type { Lang } from './i18n'

// Vocile alese: RO = Mihai (verificat); restul limbilor cad pe vocea masculină
// EN (Ryan) — ID-uri pentru celelalte limbi se adaugă DOAR după verificarea
// lor pe HuggingFace (Legea #1: nu scriem nume de modele neprobate).
const VOCE_RO = 'ro_RO-mihai-medium'
const VOCE_REZERVA = 'en_US-ryan-medium'
export function voceaPentru(lang: Lang | string): string {
  return lang === 'ro' ? VOCE_RO : VOCE_REZERVA
}

// Nivelul buzelor din fereastra de sunet: RMS scalat în [0..1], aceeași
// magnitudine ca nivelul pe care îl produce analizorul căii online. PURĂ.
export function ferestreRms(canal: Float32Array, rata: number, fereastraMs = 30): number[] {
  const pas = Math.max(1, Math.round((rata * fereastraMs) / 1000))
  const niveluri: number[] = []
  for (let i = 0; i < canal.length; i += pas) {
    let suma = 0
    const sfarsit = Math.min(i + pas, canal.length)
    for (let j = i; j < sfarsit; j++) suma += canal[j] * canal[j]
    const rms = Math.sqrt(suma / Math.max(1, sfarsit - i))
    // Vocea vorbită are RMS tipic 0.05-0.3 — scalăm ca vârfurile să deschidă
    // gura vizibil (plafonat la 1). Factor static de percepție, nu valoare
    // afișată omului.
    niveluri.push(Math.min(1, rms * 4))
  }
  return niveluri
}

type SesiunePiper = { predict: (text: string) => Promise<Blob> }
const sesiuni = new Map<string, SesiunePiper>()
let ctxGura: AudioContext | null = null
let sursaVie: AudioBufferSourceNode | null = null
let ceasBuze: ReturnType<typeof setInterval> | null = null

async function sesiunea(voiceId: string): Promise<SesiunePiper> {
  const gata = sesiuni.get(voiceId)
  if (gata) return gata
  const tts = await import('@mintplex-labs/piper-tts-web')
  const s = (await tts.TtsSession.create({
    voiceId: voiceId as never,
    wasmPaths: {
      onnxWasm: '/ort/',
      piperData: '/piper/piper_phonemize.data',
      piperWasm: '/piper/piper_phonemize.wasm',
    },
  })) as unknown as SesiunePiper
  sesiuni.set(voiceId, s)
  return s
}

/** Modelul de voce e DEJA descărcat (în OPFS)? Fără rețea, fără descărcare. */
export async function guraOfflinePregatita(lang: Lang | string): Promise<boolean> {
  try {
    const tts = await import('@mintplex-labs/piper-tts-web')
    const stocate = await tts.stored()
    return stocate.includes(voceaPentru(lang) as never)
  } catch {
    return false
  }
}

/** Descarcă vocea (kitul o cheamă DOAR online, sub autoDescarcareaPermisa —
 *  invizibil, ca la creier). Best-effort: false = nu s-a putut. */
export async function descarcaGuraOffline(lang: Lang | string): Promise<boolean> {
  try {
    const tts = await import('@mintplex-labs/piper-tts-web')
    await tts.download(voceaPentru(lang) as never, () => {})
    return true
  } catch {
    return false
  }
}

/** Rostește cu Piper + mișcă buzele. `true` = chiar a pornit redarea;
 *  `false` = orice piedică (model nedescărcat, WASM picat) — apelantul cade
 *  pe vocea browserului. O singură gură: oprește redarea anterioară. */
export async function vorbestePiper(text: string, lang: Lang | string): Promise<boolean> {
  const curat = text.trim()
  if (!curat) return false
  try {
    if (!(await guraOfflinePregatita(lang))) return false
    const s = await sesiunea(voceaPentru(lang))
    const wav = await s.predict(curat)
    oprestePiper()
    ctxGura = ctxGura ?? new AudioContext()
    if (ctxGura.state !== 'running') await ctxGura.resume().catch(() => {})
    const buf = await ctxGura.decodeAudioData(await wav.arrayBuffer())
    const canal = buf.getChannelData(0)
    const niveluri = ferestreRms(canal, buf.sampleRate)
    const sursa = ctxGura.createBufferSource()
    sursa.buffer = buf
    const gain = ctxGura.createGain()
    gain.gain.value = getVoiceVolume()
    sursa.connect(gain)
    gain.connect(ctxGura.destination)
    const start = ctxGura.currentTime
    // Buzele: la fiecare ~30ms, nivelul ferestrei curente → avatar (același
    // canal ca vocea online). Se stinge singur la final.
    ceasBuze = setInterval(() => {
      if (!ctxGura) return
      const idx = Math.floor(((ctxGura.currentTime - start) * 1000) / 30)
      alimenteazaNivelVoce(idx >= 0 && idx < niveluri.length ? niveluri[idx] : 0)
    }, 30)
    sursa.onended = () => {
      if (sursaVie === sursa) oprestePiper()
    }
    sursaVie = sursa
    sursa.start()
    return true
  } catch {
    oprestePiper()
    return false
  }
}

/** Gura Piper redă chiar acum? (urechea offline aruncă frazele cât vorbește
 *  el — half-duplex local, aceeași filozofie ca pe drumul fără AEC.) */
export function piperVorbeste(): boolean {
  return sursaVie !== null
}

/** Taie gura Piper (barge-in / tură nouă / offline→online). Best-effort. */
export function oprestePiper(): void {
  if (ceasBuze) {
    clearInterval(ceasBuze)
    ceasBuze = null
  }
  try {
    sursaVie?.stop()
  } catch {
    /* deja oprită */
  }
  sursaVie = null
  alimenteazaNivelVoce(0)
}

/** GURA OFFLINE UNICĂ pentru apelanți: întâi Piper (voce constantă + buze);
 *  dacă nu poate, vocea browserului (ultima redută — se aude MEREU ceva). */
export async function vorbesteOffline(text: string, lang: Lang): Promise<void> {
  if (await vorbestePiper(text, lang)) return
  vorbesteLocal(text, lang)
}
