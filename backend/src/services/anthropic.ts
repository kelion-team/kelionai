import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { MODEL_FAST, MODEL_TOP } from './modelRouter.js'

// UN SINGUR creier, pe UN SINGUR cont: cheia plătită de Adrian (ANTHROPIC_API_KEY).
// Regula absolută a lui Adrian (9 iul): NU există cheie de rezervă / al doilea cont
// de facturare — nimeni nu decide pe banii lui. Dacă cheia plătită pică, eroarea
// se raportează cinstit; nu se comută pe nimic în spate.
export const anthropic = new Anthropic({ apiKey: config.anthropicKey })

// Ping the brain models themselves (on the paid key): does Fable 5 actually
// serve this account right now, and does the Opus 4.8 reserve? Real 200s, not
// assumptions — this is how "what model is the brain on" gets verified live.
export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (model: string): Promise<string> => {
    try {
      const r = await anthropic.messages.create({
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
    [MODEL_FAST]: await ping(MODEL_FAST),
    [MODEL_TOP]: await ping(MODEL_TOP),
  }
}

// Ping the paid key with a 1-token request to verify it authenticates and has
// credit. Reports a status WITHOUT ever exposing the key value:
// 'ok' | 'not_configured' | 'fail' | 'fail_<httpStatus>'.
export async function verifyKeys(): Promise<{
  primary: string
  diag: Record<string, unknown>
}> {
  const ping = async (client: Anthropic): Promise<string> => {
    try {
      await client.messages.create({
        model: process.env.KELION_PING_MODEL || MODEL_FAST,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return 'ok'
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      return status ? `fail_${status}` : 'fail'
    }
  }
  const primary = config.anthropicKey ? await ping(anthropic) : 'not_configured'
  // Non-secret diagnostics to pinpoint a bad key without exposing its value:
  // length (a real key is ~108 chars), the public prefix, and whether the raw
  // env value carried surrounding whitespace (a common paste error).
  const rawP = process.env.ANTHROPIC_API_KEY ?? ''
  const diag = {
    primaryLen: config.anthropicKey.length,
    primaryPrefixOk: config.anthropicKey.startsWith('sk-ant-'),
    primaryRawHadWhitespace: rawP !== rawP.trim(),
  }
  return { primary, diag }
}
