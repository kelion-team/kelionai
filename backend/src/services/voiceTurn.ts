import { transcribe } from './asr.js'
import { synthesize } from './tts.js'

// Audio-to-audio turn logic (full-duplex voice): PCM in → STT → brain → TTS → WAV out.
// Extracted from backend/src/routes/bridge.ts so the pipeline can be unit-tested
// without spinning up Fastify or the bridge queue.

export interface VoiceTurnDeps {
  // Mirrors bridgeAskStream: returns the final brain text (or null) and feeds
  // chunks through onChunk. The caller (bridge.ts) wires this to the real
  // bridgeAskStream; tests inject a fake.
  askBrain: (
    prompt: string,
    visitor: string,
    onChunk: (text: string) => void,
  ) => Promise<string | null>
}

export type VoiceTurnResult =
  | { ok: false; stage: string; error: string }
  | { ok: true; transcript: string; reply: string; skip: true }
  | {
      ok: true
      transcript: string
      reply: string
      lang: string
      sampleRate: number
      wav: string
      ttsError?: string
    }

const BRIDGE_STALL = '__BRIDGE_STALL__'

/**
 * Run one audio-to-audio turn.
 *
 * @param pcmBase64 base64-encoded mono LINEAR16 PCM
 * @param sampleRate PCM sample rate (Hz)
 * @param langHint optional language hint for the recogniser
 * @param visitor visitor/session identity passed to the bridge
 * @param deps injected dependencies (askBrain)
 */
export async function runVoiceTurn(
  pcmBase64: string,
  sampleRate: number,
  langHint: string,
  visitor: string,
  deps: VoiceTurnDeps,
): Promise<VoiceTurnResult> {
  const pcm = String(pcmBase64 ?? '').trim()
  if (!pcm) {
    return { ok: false, stage: 'input', error: 'bad_request: pcm (base64 LINEAR16) required' }
  }
  const rate = Number(sampleRate) || 48000

  // 1) STT — PCM brut LINEAR16 (nu container) → decodare explicită.
  const stt = await transcribe(pcm, { langHint, pcm: { sampleRateHertz: rate, channels: 1 } })
  if (!stt.ok) {
    return { ok: false, stage: 'stt', error: stt.error }
  }
  const transcript = stt.transcript.trim()
  const lang = stt.lang || langHint || ''
  // Liniște / zgomot → nimic de spus. Agentul sare peste (fără să răspundă).
  if (!transcript) {
    return { ok: true, transcript: '', reply: '', skip: true }
  }

  // 2) CREIERUL — persona PUBLICĂ (neutru Kelion, fără context privat), ton
  // vorbit scurt. Acumulăm bucățile și luăm textul final. Fără worker → linie
  // scurtă de rezervă ca vocea să nu moară în tăcere.
  const voicePrompt =
    `[VOCE] Utilizatorul ți-a spus prin microfon: "${transcript}". ` +
    `Răspunde ca Kelion, NATURAL și SCURT, ca într-o conversație vorbită (1–3 propoziții, fără liste, ` +
    `fără markdown, fără emoji). Răspunde în limba în care ți-a vorbit.`
  let acc = ''
  const brain = await deps.askBrain(voicePrompt, visitor, (t) => {
    acc += t
  })
  const reply2 = (brain && brain !== BRIDGE_STALL ? brain : acc).trim()
  const spoken = reply2 || 'Te ascult.'

  // 3) TTS — LINEAR16 la ACELAȘI sample rate ca LiveKit-ul agentului, ca
  // sample-urile să intre 1:1 în AudioSource (fără reeșantionare pe agent).
  const tts = await synthesize(spoken, lang || undefined, { encoding: 'LINEAR16', sampleRateHertz: rate })
  if (!tts.ok) {
    return {
      ok: true,
      transcript,
      reply: spoken,
      lang,
      sampleRate: rate,
      wav: '',
      ttsError: tts.error,
    }
  }
  return {
    ok: true,
    transcript,
    reply: spoken,
    lang,
    sampleRate: rate,
    // WAV (RIFF) base64 — agentul sare peste antetul de 44 de octeți și
    // împinge PCM-ul în cameră.
    wav: tts.audio.toString('base64'),
  }
}
