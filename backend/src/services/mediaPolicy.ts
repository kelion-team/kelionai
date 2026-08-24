export type GeneratedMediaKind = 'image' | 'video'

// Technical safety limits, not commercial settings. They are deliberately
// fixed and tested so an environment change cannot silently raise memory use.
export const MEDIA_LIMITS = Object.freeze({
  promptChars: 4_000,
  imageBytes: 24 * 1024 * 1024,
  imageResponseBytes: 34 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  providerJsonBytes: 64 * 1024,
})

const MIMES: Readonly<Record<GeneratedMediaKind, ReadonlySet<string>>> = {
  image: new Set(['image/png', 'image/jpeg', 'image/webp']),
  video: new Set(['video/mp4']),
}

export function mediaMimeAllowed(kind: GeneratedMediaKind, mime: string): boolean {
  return MIMES[kind].has(mime.toLowerCase())
}

export function mediaByteLimit(kind: GeneratedMediaKind): number {
  return kind === 'image' ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes
}

export function mediaIdValid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

export function normalizeMediaOwner(email: string): string {
  const owner = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) ? owner : ''
}
