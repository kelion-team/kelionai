import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { loadGeneratedMedia, loadKv, saveGeneratedMedia, saveKv } from '../db.js'
import { readResponseBufferLimited, readResponseTextLimited } from './httpBody.js'
import { MEDIA_LIMITS, mediaIdValid, normalizeMediaOwner } from './mediaPolicy.js'

export const KV_VIDEO_ULTIMA = 'video_ultima_incercare'
export const KV_VIDEO_PLATIT = 'video_platit'

function noteazaIncercarea(verdict: string, ok: boolean): void {
  void saveKv(KV_VIDEO_ULTIMA, JSON.stringify({
    la: new Date().toISOString(),
    ok,
    verdict: verdict.slice(0, 400),
  })).catch(() => undefined)
}

export function openAIVideoModel(): string {
  return config.videoModel
}

/** The current OpenAI Videos contract accepts 4, 8, or 12 seconds. */
export function secundeVideoValide(requested: number): 4 | 8 | 12 {
  const seconds = Number.isFinite(requested) ? requested : 8
  if (seconds <= 6) return 4
  if (seconds <= 10) return 8
  return 12
}

export function costVideoUsd(model: string, seconds: number): number | null {
  if (!model || model !== config.videoModel || !Number.isSafeInteger(config.videoPriceUsdMicrosPerSecond)) return null
  const micros = config.videoPriceUsdMicrosPerSecond * seconds
  return Math.round(micros) / 1_000_000
}

export function verdictVideoPlatit(
  kv: string | null,
  env: boolean,
): { pornit: boolean; sursa: 'buton' | 'env' | 'implicit' } {
  if (kv === '1') return { pornit: true, sursa: 'buton' }
  if (kv === '0') return { pornit: false, sursa: 'buton' }
  return env ? { pornit: true, sursa: 'env' } : { pornit: false, sursa: 'implicit' }
}

export async function videoPlatitPornit(): Promise<{ pornit: boolean; sursa: 'buton' | 'env' | 'implicit' }> {
  const kv = await loadKv(KV_VIDEO_PLATIT).catch(() => null)
  return verdictVideoPlatit(kv, config.videoAllowPaid)
}

export function motivRefuzVideo(opts: {
  cheie: string
  allowPaid: boolean
  model: string
  nowMs?: number
  shutdownAt?: number
} = {
  cheie: config.openai.key,
  allowPaid: config.videoAllowPaid,
  model: openAIVideoModel(),
}): string | null {
  if (!opts.cheie) return 'fara_cheie_openai'
  if (!opts.model) return 'video_model_neconfigurat'
  const shutdownAt = opts.shutdownAt ?? config.videoShutdownAt
  if ((opts.nowMs ?? Date.now()) >= shutdownAt) return 'video_openai_retras_de_furnizor'
  const cost = costVideoUsd(opts.model, 8)
  if (cost === null) return `model_fara_pret_cunoscut:${opts.model}`
  if (!opts.allowPaid) {
    return (
      `video_platit_neaprobat: modelul ${opts.model} costă aproximativ $${cost.toFixed(2)} pentru 8s. ` +
      'Adminul poate activa generarea programată; o cerere deja taxată a clientului este aprobată separat.'
    )
  }
  return null
}

interface StoredVideo {
  mime: 'video/mp4'
  buf: Buffer
}

export async function getVideo(id: string, ownerEmail: string): Promise<StoredVideo | null> {
  const owner = normalizeMediaOwner(ownerEmail)
  if (!owner || !mediaIdValid(id)) return null
  const row = await loadGeneratedMedia(id, owner, 'video')
  if (!row || row.mime !== 'video/mp4') return null
  return { mime: 'video/mp4', buf: row.data }
}

export type VideoResult =
  | { id: string; mime: string; costUsd: number; secunde: number; model: string }
  | { error: string }

interface VideoJob {
  id?: string
  status?: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  error?: { message?: string } | null
}

const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${config.openai.key}` })

async function responseJson<T>(response: Response): Promise<T> {
  const body = await readResponseTextLimited(response, MEDIA_LIMITS.providerJsonBytes)
  return JSON.parse(body) as T
}

async function providerError(response: Response): Promise<string> {
  try { return (await readResponseTextLimited(response, MEDIA_LIMITS.providerJsonBytes)).slice(0, 300) }
  catch { return 'raspuns_invalid' }
}

export async function genereazaVideo(
  prompt: string,
  ownerEmail: string,
  secundeCerute = 8,
  platitDeClient = false,
  onPas?: (secundeScurse: number) => void,
): Promise<VideoResult> {
  const cleanPrompt = prompt.trim()
  const owner = normalizeMediaOwner(ownerEmail)
  if (!cleanPrompt) return { error: 'empty_prompt' }
  if (!owner) return { error: 'media_owner_invalid' }
  if (cleanPrompt.length > MEDIA_LIMITS.promptChars) return { error: 'prompt_too_large' }
  const model = openAIVideoModel()
  const switchState = await videoPlatitPornit()
  const refusal = motivRefuzVideo({
    cheie: config.openai.key,
    allowPaid: switchState.pornit || platitDeClient,
    model,
  })
  if (refusal) {
    noteazaIncercarea(refusal, false)
    return { error: refusal }
  }
  const seconds = secundeVideoValide(secundeCerute)
  const cost = costVideoUsd(model, seconds)
  if (cost === null) return { error: `model_fara_pret_cunoscut:${model}` }

  let job: VideoJob
  try {
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', cleanPrompt)
    form.append('size', '1280x720')
    form.append('seconds', String(seconds))
    const response = await fetch(`${config.openai.apiBaseUrl}/videos`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const error = `pornire_generare:${response.status}:${await providerError(response)}`
      noteazaIncercarea(error, false)
      return { error }
    }
    job = await responseJson<VideoJob>(response)
  } catch (error) {
    const message = `pornire_generare:${String(error).slice(0, 200)}`
    noteazaIncercarea(message, false)
    return { error: message }
  }
  if (!job.id || !/^[A-Za-z0-9_-]{1,128}$/.test(job.id)) {
    noteazaIncercarea('pornire_generare:id_invalid', false)
    return { error: 'pornire_generare:id_invalid' }
  }
  const jobId = job.id

  const start = Date.now()
  const deadline = start + 5 * 60_000
  while (job.status === 'queued' || job.status === 'in_progress' || !job.status) {
    if (Date.now() >= deadline) {
      noteazaIncercarea('generare:timeout_5min', false)
      return { error: 'generare:timeout_5min' }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    try { onPas?.(Math.round((Date.now() - start) / 1000)) } catch { /* progress is advisory */ }
    try {
      const response = await fetch(`${config.openai.apiBaseUrl}/videos/${encodeURIComponent(jobId)}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) job = await responseJson<VideoJob>(response)
      else await providerError(response)
    } catch {
      // A transient status failure is retried until the bounded deadline.
    }
  }
  if (job.status !== 'completed') {
    const error = `generare:${job.status ?? 'unknown'}:${String(job.error?.message ?? '').slice(0, 200)}`
    noteazaIncercarea(error, false)
    return { error }
  }

  try {
    const response = await fetch(`${config.openai.apiBaseUrl}/videos/${encodeURIComponent(jobId)}/content`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const detail = await providerError(response)
      noteazaIncercarea(`descarcare:${response.status}:${detail}`, false)
      return { error: `descarcare:${response.status}` }
    }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (mime !== 'video/mp4') return { error: 'descarcare:mime_invalid' }
    const buf = await readResponseBufferLimited(response, MEDIA_LIMITS.videoBytes)
    if (!buf.length) return { error: 'descarcare:fisier_gol' }
    const id = randomUUID()
    await saveGeneratedMedia({ id, ownerEmail: owner, kind: 'video', mime: 'video/mp4', data: buf })
    noteazaIncercarea(`REUȘIT: clip ${seconds}s pe ${model} ($${cost.toFixed(2)})`, true)
    return { id, mime: 'video/mp4', costUsd: cost, secunde: seconds, model }
  } catch (error) {
    const message = `descarcare:${String(error).slice(0, 200)}`
    noteazaIncercarea(message, false)
    return { error: message }
  }
}
