import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

// CREIERUL — Kimi (primar) → GLM (rezervă). Anthropic/Max a fost SCOS complet
// (ordinul lui Adrian, 12 iul: „renunț la Anthropic, rămâne Kimi și GLM").
// Ambele endpoint-uri sunt compatibile Anthropic-API, deci refolosim SDK-ul
// oficial doar cu `baseURL` + cheie schimbate — niciun apel nu mai pleacă spre
// api.anthropic.com. Numele fișierului rămâne `anthropic.ts` doar pentru a nu
// atinge zecile de importuri din restul codului.
export const KIMI_BASE = 'https://api.kimi.com/coding/'
export const GLM_BASE = 'https://api.z.ai/api/anthropic'

// Kimi: primar. GLM: rezervă (folosit la eșecul lui Kimi — vezi failover-ul din
// routes/chat.ts). Fără cheie, clientul respectiv dă eroare la primul apel, care
// e raportată cinstit (nu se comută pe nimic Anthropic — nu mai există).
export const kimi = new Anthropic({ apiKey: config.kimiKey, baseURL: KIMI_BASE })
export const glm = new Anthropic({ apiKey: config.glmKey, baseURL: GLM_BASE })
// Clientul implicit al creierului = Kimi (primar). Restul codului importă
// `anthropic` — acum e Kimi, nu Anthropic.
export const anthropic = kimi

// Ping the brain tiers on their real endpoints: does Kimi serve, and does GLM
// (the reserve)? Real 200s, not assumptions — this is how "what model is the
// brain on" gets verified live.
export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (client: Anthropic, model: string): Promise<string> => {
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      })
      return `ok (served by ${r.model})`
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      return status ? `fail_${status}` : 'fail'
    }
  }
  return {
    'kimi-k2-thinking': await ping(kimi, 'kimi-k2-thinking'),
    'glm-4.6': await ping(glm, 'glm-4.6'),
  }
}

// Ping each brain key with a 1-token request to verify it authenticates and has
// credit. Reports a status WITHOUT ever exposing the key value:
// 'ok' | 'not_configured' | 'fail' | 'fail_<httpStatus>'.
export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  const ping = async (client: Anthropic, model: string): Promise<string> => {
    try {
      await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return 'ok'
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      return status ? `fail_${status}` : 'fail'
    }
  }
  const primary = config.kimiKey ? await ping(kimi, 'kimi-k2-thinking') : 'not_configured'
  const reserve = config.glmKey ? await ping(glm, 'glm-4.6') : 'not_configured'
  // Non-secret diagnostics to pinpoint a bad key without exposing its value:
  // length + whether the raw env value carried surrounding whitespace.
  const rawK = process.env.KIMI_API_KEY ?? process.env.KIMI_KEY ?? ''
  const rawG = process.env.GLM_API_KEY ?? process.env.GLM_KEY ?? ''
  const diag = {
    kimiLen: config.kimiKey.length,
    glmLen: config.glmKey.length,
    kimiRawHadWhitespace: rawK !== rawK.trim(),
    glmRawHadWhitespace: rawG !== rawG.trim(),
  }
  return { primary, reserve, diag }
}
