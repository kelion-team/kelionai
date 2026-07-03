import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'

// In-memory store of generated images. The web service is single-instance, so a
// Map is enough; entries are ephemeral (cleared on redeploy), which is fine for
// on-screen display. Bounded so memory can't grow without limit.
interface StoredImage {
  mime: string
  buf: Buffer
  ts: number
}

const store = new Map<string, StoredImage>()
const MAX_IMAGES = 60

function put(mime: string, buf: Buffer): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  store.set(id, { mime, buf, ts: Date.now() })
  while (store.size > MAX_IMAGES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  return id
}

export function getImage(id: string): StoredImage | null {
  return store.get(id) ?? null
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
      return { id: put(mime, Buffer.from(data, 'base64')), mime }
    }
  }
  return { error: 'no_image' }
}
