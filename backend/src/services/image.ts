import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { saveGeneratedImage, loadGeneratedImage } from '../db.js'

// Generated images are now persistent (stored in DB). The ephemeral Map
// is kept only as a 1st-level cache for performance on high-load,
// but survival through redeployments is guaranteed by Postgres.
interface StoredImage {
  mime: string
  buf: Buffer
  ts: number
}

const cache = new Map<string, StoredImage>()
const MAX_CACHE = 60

async function put(mime: string, buf: Buffer): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  // 1. Save to DB (Permanent)
  await saveGeneratedImage(id, mime, buf)
  // 2. Cache locally
  cache.set(id, { mime, buf, ts: Date.now() })
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return id
}

export async function getImage(id: string): Promise<StoredImage | null> {
  // Check cache
  const hit = cache.get(id)
  if (hit) return hit
  // Check DB
  const row = await loadGeneratedImage(id)
  if (row) {
    const img = { mime: row.mime, buf: row.data, ts: Date.now() }
    cache.set(id, img) // Populate cache
    return img
  }
  return null
}

// Gemini's native image model. Returns inline image bytes via generateContent.
const IMAGE_MODEL = 'gemini-2.5-flash-image'

// Gemini image models are paid-tier only — the Gemini API KEY is on the free
// tier (image quota 0). The project's SERVICE ACCOUNT, however, bills the
// billing-enabled project, so we authenticate image generation with the service
// account (generative-language scope), which works. The google-auth-library
// client caches + refreshes the access token internally.
let saAuth: GoogleAuth | null = null
let saProject = ''
function serviceAccount(): GoogleAuth | null {
  if (saAuth) return saAuth
  if (!config.googleServiceAccountJson) return null
  try {
    const creds = JSON.parse(config.googleServiceAccountJson) as { project_id?: string }
    saProject = creds.project_id ?? ''
    saAuth = new GoogleAuth({
      credentials: creds as object,
      scopes: ['https://www.googleapis.com/auth/generative-language'],
    })
    return saAuth
  } catch {
    return null
  }
}

export type ImageResult = { id: string; mime: string } | { error: string }

export async function generateImage(prompt: string): Promise<ImageResult> {
  const p = prompt.trim()
  if (!p) return { error: 'empty_prompt' }
  const auth = serviceAccount()
  if (!auth) return { error: 'image_not_configured' }

  let token: string | null | undefined
  try {
    token = (await (await auth.getClient()).getAccessToken()).token
  } catch {
    return { error: 'image_auth_failed' }
  }
  if (!token) return { error: 'image_auth_failed' }

  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': saProject,
        },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: p }] }] }),
      },
    )
  } catch {
    return { error: 'image_unavailable' }
  }
  if (res.status === 429) return { error: 'needs_billing' }
  if (!res.ok) return { error: `image_http_${res.status}` }

  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
  }
  for (const part of j.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data
    if (data) {
      const mime = part.inlineData?.mimeType ?? 'image/png'
      return { id: await put(mime, Buffer.from(data, 'base64')), mime }
    }
  }
  return { error: 'no_image' }
}
