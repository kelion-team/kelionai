// ── #6 CLONARE VOCE (owner, 22 aug 2026: „uimește-mă") ──────────────────────
//
// La prima utilizare, Kelion înregistrează 30 secunde din vocea ta și le
// stochează. Apoi îți poate aminti lucruri în vocea TA.
//
// Implementare: înregistrează sample-uri audio (PCM 16kHz) și le trimite
// la backend pentru stocare. Pentru sinteză în vocea ta, backend-ul poate
// folosi un model TTS (ElevenLabs / Coqui / VITS) — aici facem doar
// capturarea + stocarea sample-urilor. Sinteza efectivă e un pas următor
// (necesită model TTS dedicat).

export interface SampleVoce {
  audioBase64: string // PCM 16kHz mono, base64
  durataMs: number
  ts: number
  textCitit: string // textul pe care l-a citit userul
}

const DURATA_INREGISTRARE_MS = 30_000 // 30 secunde
const TEXT_CITIRE = 'Bună. Asta este vocea mea. Kelion, reține cum vorbesc. Acum pot primi amintiri în vocea mea.'

let inregistrareInMers = false
let mediaRecorder: MediaRecorder | null = null
let chunkuri: Blob[] = []

/** Începe înregistrarea sample-ului de voce (30 secunde). */
export async function inregistreazaSampleVoce(): Promise<SampleVoce | null> {
  if (inregistrareInMers) return null
  inregistrareInMers = true

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    chunkuri = []
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunkuri.push(e.data)
    }

    return new Promise((resolve) => {
      const start = Date.now()
      mediaRecorder!.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunkuri, { type: 'audio/webm' })
        const audioBase64 = await blobToBase64(blob)
        inregistrareInMers = false
        resolve({
          audioBase64,
          durataMs: Date.now() - start,
          ts: Date.now(),
          textCitit: TEXT_CITIRE,
        })
      }
      mediaRecorder!.start()
      // Oprește automat după 30 secunde
      setTimeout(() => {
        if (mediaRecorder?.state === 'recording') {
          mediaRecorder.stop()
        }
      }, DURATA_INREGISTRARE_MS)
    })
  } catch {
    inregistrareInMers = false
    return null
  }
}

/** Trimite sample-ul la backend pentru stocare. */
export async function salveazaSampleVoce(sample: SampleVoce): Promise<boolean> {
  try {
    const r = await fetch('/api/voce/sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Verifică dacă userul are deja sample de voce stocat. */
export async function areSampleVoce(): Promise<boolean> {
  try {
    const r = await fetch('/api/voce/sample', { cache: 'no-store' })
    if (!r.ok) return false
    const j = (await r.json()) as { are: boolean }
    return j.are
  } catch {
    return false
  }
}

/** Textul pe care trebuie să-l citească userul. */
export function getTextCitire(): string {
  return TEXT_CITIRE
}

/** E înregistrare în curs? */
// export-permis: pentru integrarea viitoare în UI-ul studioului de clipuri
export function inregistrareVoceInMers(): boolean {
  return inregistrareInMers
}

// ── SINTEZĂ CU CLONA (owner, 23 aug 2026) ──────────────────────────────────
// Trimite text la /api/voce/sintetizeaza → primește audio WAV în vocea
// userului (sintetizat de Coqui TTS XTTS v2 pe VPS). Folosit pentru
// conversații de demo (studioul de clipuri): clona pune întrebări,
// Kelion răspunde cu vocea lui.

/** Sintetizează text în vocea clonată a userului. Returnează URL blob audio. */
// export-permis: pentru integrarea viitoare în UI-ul studioului de clipuri
export async function sintetizeazaCuClona(text: string, limba?: string): Promise<string | null> {
  try {
    const r = await fetch('/api/voce/sintetizeaza', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, limba }),
    })
    if (!r.ok) return null
    const blob = await r.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

/** Verifică dacă microserviciul Coqui e disponibil pe VPS. */
// export-permis: pentru integrarea viitoare în UI-ul studioului de clipuri
export async function coquiDisponibil(): Promise<boolean> {
  try {
    const r = await fetch('/api/voce/coqui-status', { cache: 'no-store' })
    if (!r.ok) return false
    const j = (await r.json()) as { ok?: boolean }
    return !!j.ok
  } catch {
    return false
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Elimină prefixul data:audio/webm;base64,
      const base64 = result.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.readAsDataURL(blob)
  })
}
