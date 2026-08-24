import { config } from '../config.js'
import { rationeazaMesaje } from './creierRationament.js'
import type { OrMessage } from './brainContract.js'

export const VEDE_VIDEO_MAX_S = Math.max(60, Number(process.env.VEDE_VIDEO_MAX_S || 600))

export function eLinkYoutube(url: string): boolean {
  let parsed: URL
  try { parsed = new URL(String(url ?? '').trim()) } catch { return false }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'youtu.be') return /^\/[\w-]{5,}/.test(parsed.pathname)
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const id = parsed.searchParams.get('v')
    if (id && /^[\w-]{5,}$/.test(id)) return true
    return /^\/(shorts|live|embed)\/[\w-]{5,}/.test(parsed.pathname)
  }
  return false
}

function youtubeId(url: string): string | null {
  if (!eLinkYoutube(url)) return null
  const parsed = new URL(url)
  if (parsed.hostname.toLowerCase() === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] ?? null
  return parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1] ?? null
}

export interface FisaVideo {
  titlu: string
  idei: string[]
  informatii: string[]
  momente: { la: string; ce: string }[]
  ton: string
  tokeni: number
  costUsd?: number
  plafonAtins: boolean
}

interface CaptionTrack { baseUrl?: string; languageCode?: string; name?: { simpleText?: string } }

function jsonArrayAfter(source: string, marker: string): unknown[] | null {
  const at = source.indexOf(marker)
  if (at < 0) return null
  const start = source.indexOf('[', at + marker.length)
  if (start < 0) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)) as unknown[] } catch { return null }
    }
  }
  return null
}

function isTrustedCaptionUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && (
      host === 'youtube.com' || host.endsWith('.youtube.com') ||
      host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
    )
  } catch { return false }
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
}

interface TranscriptResult { text: string; clipped: boolean }

async function youtubeTranscript(url: string): Promise<TranscriptResult | { error: string }> {
  let page: Response
  try {
    page = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KelionAI/1.0)' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    })
  } catch (error) {
    return { error: `vede_video pagina: ${String(error).slice(0, 120)}` }
  }
  if (!page.ok) return { error: `vede_video pagina ${page.status}` }
  const html = (await page.text()).slice(0, 4_000_000)
  const tracks = jsonArrayAfter(html, '"captionTracks":') as CaptionTrack[] | null
  const track = tracks?.find((item) => item.languageCode === 'ro') ?? tracks?.find((item) => item.languageCode === 'en') ?? tracks?.[0]
  if (!track?.baseUrl || !isTrustedCaptionUrl(track.baseUrl)) return { error: 'vede_video_fara_transcript' }
  const captionUrl = new URL(track.baseUrl)
  captionUrl.searchParams.set('fmt', 'json3')
  let response: Response
  try {
    response = await fetch(captionUrl, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  } catch (error) {
    return { error: `vede_video transcript: ${String(error).slice(0, 120)}` }
  }
  if (!response.ok) return { error: `vede_video transcript ${response.status}` }
  const raw = await response.text()
  try {
    const json = JSON.parse(raw) as { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> }
    const lines: string[] = []
    let clipped = false
    for (const event of json.events ?? []) {
      const second = Number(event.tStartMs ?? 0) / 1000
      if (second > VEDE_VIDEO_MAX_S) { clipped = true; break }
      const text = plainText((event.segs ?? []).map((segment) => segment.utf8 ?? '').join(''))
      if (text) lines.push(`[${Math.floor(second / 60)}:${String(Math.floor(second % 60)).padStart(2, '0')}] ${text}`)
    }
    if (lines.length) return { text: lines.join('\n').slice(0, 120_000), clipped }
  } catch {
    // Some caption endpoints ignore fmt=json3; parse the XML form below.
  }
  const lines = [...raw.matchAll(/<text\s+start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
  const selected: string[] = []
  let clipped = false
  for (const match of lines) {
    const second = Number(match[1])
    if (second > VEDE_VIDEO_MAX_S) { clipped = true; break }
    const text = plainText(match[2])
    if (text) selected.push(`[${Math.floor(second / 60)}:${String(Math.floor(second % 60)).padStart(2, '0')}] ${text}`)
  }
  return selected.length ? { text: selected.join('\n').slice(0, 120_000), clipped } : { error: 'vede_video_transcript_gol' }
}

const PROMPT_FISA =
  'Întoarce STRICT JSON cu forma {"titlu":string,"idei":string[],"informatii":string[],' +
  '"momente":[{"la":string,"ce":string}],"ton":string}. Scrie în română. ' +
  'Folosește numai transcriptul și miniatura furnizate; nu inventa scene sau fapte nevăzute.'

function parseJsonObject(text: string): Partial<FisaVideo> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) as Partial<FisaVideo> } catch { return null }
}

/** Analyze a YouTube caption transcript plus its public thumbnail with Responses. */
export async function vedeVideoYoutube(url: string, userEmail = 'system'): Promise<FisaVideo | { error: string }> {
  const clean = String(url ?? '').trim()
  const id = youtubeId(clean)
  if (!id) return { error: 'link_nesuportat_inca: este acceptat doar un link YouTube valid' }
  if (!config.openai.key) return { error: 'fara_cheie_openai' }
  const transcript = await youtubeTranscript(clean)
  if ('error' in transcript) return transcript
  const messages: OrMessage[] = [{
    role: 'user',
    content: [
      { type: 'text', text: `${PROMPT_FISA}\n\nTRANSCRIPT CU TIMPI:\n${transcript.text}` },
      { type: 'image_url', image_url: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
    ],
  }]
  let response
  try {
    response = await rationeazaMesaje(messages, {
      ruta: 'service.vedeVideo',
      treapta: 'lucru',
      reasoning: 'medium',
      maxTokens: 4096,
      tools: [],
      usageContext: { userEmail, surface: 'video_transcript_analysis' },
    })
  } catch (error) {
    return { error: `vede_video creier: ${String(error).slice(0, 160)}` }
  }
  const parsed = parseJsonObject(response.text)
  if (!parsed || !Array.isArray(parsed.idei) || parsed.idei.length === 0) {
    return { error: 'vede_video: creierul a răspuns fără idei — fișa nu se inventează' }
  }
  return {
    titlu: String(parsed.titlu ?? '').slice(0, 200),
    idei: parsed.idei.map((item) => String(item).slice(0, 300)).slice(0, 10),
    informatii: (Array.isArray(parsed.informatii) ? parsed.informatii : []).map((item) => String(item).slice(0, 300)).slice(0, 15),
    momente: (Array.isArray(parsed.momente) ? parsed.momente : []).map((item) => ({
      la: String(item?.la ?? '').slice(0, 10),
      ce: String(item?.ce ?? '').slice(0, 200),
    })).slice(0, 12),
    ton: String(parsed.ton ?? '').slice(0, 200),
    tokeni: response.inputTokens + response.outputTokens,
    costUsd: response.costUsd,
    plafonAtins: transcript.clipped,
  }
}

export function fisaCaText(url: string, fisa: FisaVideo): string {
  const moments = fisa.momente.map((moment) => `  ${moment.la} — ${moment.ce}`).join('\n')
  return (
    `FIȘA CLIPULUI: ${fisa.titlu}\nSursa: ${url}\n\nIDEI PRINCIPALE:\n${fisa.idei.map((idea) => `  • ${idea}`).join('\n')}` +
    (fisa.informatii.length ? `\n\nINFORMAȚII CONCRETE:\n${fisa.informatii.map((info) => `  • ${info}`).join('\n')}` : '') +
    (moments ? `\n\nMOMENTE CHEIE:\n${moments}` : '') +
    (fisa.ton ? `\n\nTON: ${fisa.ton}` : '')
  )
}
