// ── URECHEA OFFLINE — lucrătorul Whisper (rulează în Worker, nu pe firul UI) ──
//
// Ordinul din 22 aug: toate funcțiile de bază la lipsă de semnal, cu download
// automat invizibil. Modelul: whisper-large-v3-turbo cuantizat q4f16 (~564 MB)
// — pe română, clasa „large" e singura serioasă (măsurători publicate RO-N3WS:
// 6-12% erori pe știri; varianta mică 27-32% — spusă cinstit, nu ascunsă).
// Rulează pe WebGPU, SECVENȚIAL cu creierul local (întâi aude, apoi gândește).
// transformers.js își cache-uiește modelul în Cache API sub 'transformers-cache'
// — cheie PROTEJATĂ de ștergerea la update (updateCheck.ts + sw.js, lângă
// webllm/*).
import { pipeline } from '@huggingface/transformers'

// hardcod-permis: numele modelului ASR local — alegere tehnică verificată (22
// aug, HF onnx-community), nu o stare afișată; se schimbă doar cu măsurători noi.
const MODEL_URECHE = 'onnx-community/whisper-large-v3-turbo'

type Cerere =
  | { tip: 'pregateste' }
  | { tip: 'transcrie'; audio: Float32Array; limba: string; id: number }

let asrViu: unknown | null = null
let pornire: Promise<unknown> | null = null

async function asigura(): Promise<unknown> {
  if (asrViu) return asrViu
  pornire =
    pornire ??
    pipeline('automatic-speech-recognition', MODEL_URECHE, {
      device: 'webgpu',
      dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
    } as never).then((p) => {
      asrViu = p
      return p
    })
  return pornire
}

self.onmessage = (ev: MessageEvent<Cerere>) => {
  const m = ev.data
  void (async () => {
    if (m.tip === 'pregateste') {
      try {
        await asigura()
        self.postMessage({ tip: 'gata' })
      } catch (e) {
        self.postMessage({ tip: 'eroare', motiv: String((e as Error)?.message ?? e).slice(0, 200) })
      }
      return
    }
    if (m.tip === 'transcrie') {
      try {
        const asr = (await asigura()) as (a: Float32Array, o: Record<string, unknown>) => Promise<{ text?: string }>
        const out = await asr(m.audio, { language: m.limba, task: 'transcribe' })
        self.postMessage({ tip: 'text', id: m.id, text: String(out?.text ?? '').trim() })
      } catch (e) {
        self.postMessage({ tip: 'eroare', id: m.id, motiv: String((e as Error)?.message ?? e).slice(0, 200) })
      }
    }
  })()
}
