import { config } from '../config.js'

export interface GoogleServiceAccount {
  project_id?: string
  client_email?: string
  [k: string]: unknown
}

/** The parsed GOOGLE_SERVICE_ACCOUNT_JSON — ONE place that parses it, shared
 *  by STT batch (asr.ts) and TTS (tts.ts),
 *  which used to JSON.parse the same string in 5 spots. Returns null when the
 *  account is not configured OR the JSON is invalid: the callers then report
 *  an honest error (nu mai există fallback OpenAI — extirpat, 3 aug) instead
 *  of throwing mid-request.
 *  Deliberately NOT cached: tests pin config fields per case, and each
 *  consumer memoizes its own client anyway. */
export function googleServiceAccount(): GoogleServiceAccount | null {
  const raw = config.googleServiceAccountJson
  if (!raw) return null
  try {
    return JSON.parse(raw) as GoogleServiceAccount
  } catch {
    return null
  }
}
