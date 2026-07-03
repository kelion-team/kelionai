import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

// Primary + reserve Anthropic clients. The brain calls the PRIMARY key; if that
// account is unusable — out of credit, auth/billing failure, rate limit, server
// or connection error — the RESERVE key (a second billing account) takes over
// automatically. One account running dry never kills the brain: no single point
// of failure. The reserve is optional; unset means simply no fallback.
export const anthropic = new Anthropic({ apiKey: config.anthropicKey })
export const anthropicReserve = config.anthropicKeyReserve
  ? new Anthropic({ apiKey: config.anthropicKeyReserve })
  : null

// Whether to abandon the primary key for the reserve on this error. A malformed
// request (400) is our own fault — the reserve can't fix it, so don't burn it.
// Everything else (401/402/403/429/5xx, network) means the account or endpoint
// is the problem, so the reserve is worth trying.
export function shouldFailover(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  return status !== 400
}

// Run a non-streaming Anthropic call, transparently retrying on the reserve key
// if the primary fails over. Used by the memory + specialist agents.
export async function withAnthropicFallback<T>(
  run: (client: Anthropic) => Promise<T>,
): Promise<T> {
  try {
    return await run(anthropic)
  } catch (e) {
    if (anthropicReserve && shouldFailover(e)) return await run(anthropicReserve)
    throw e
  }
}

// Ping the brain models themselves (on the primary key): does Fable 5 actually
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
    'claude-fable-5': await ping('claude-fable-5'),
    'claude-opus-4-8': await ping('claude-opus-4-8'),
  }
}

// Ping both keys with a 1-token request to verify they authenticate and have
// credit. Reports a status per key WITHOUT ever exposing the key values:
// 'ok' | 'not_configured' | 'fail' | 'fail_<httpStatus>'.
export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  const ping = async (client: Anthropic): Promise<string> => {
    try {
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return 'ok'
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      return status ? `fail_${status}` : 'fail'
    }
  }
  const [primary, reserve] = await Promise.all([
    config.anthropicKey ? ping(anthropic) : Promise.resolve('not_configured'),
    anthropicReserve ? ping(anthropicReserve) : Promise.resolve('not_configured'),
  ])
  // Non-secret diagnostics to pinpoint a bad key without exposing its value:
  // length (a real key is ~108 chars), the public prefix, and whether the raw
  // env value carried surrounding whitespace (a common paste error).
  const rawP = process.env.ANTHROPIC_API_KEY ?? ''
  const rawR = process.env.ANTHROPIC_API_KEY_RESERVE ?? ''
  const diag = {
    primaryLen: config.anthropicKey.length,
    primaryPrefixOk: config.anthropicKey.startsWith('sk-ant-'),
    primaryRawHadWhitespace: rawP !== rawP.trim(),
    reserveLen: config.anthropicKeyReserve.length,
    reserveRawHadWhitespace: rawR !== rawR.trim(),
  }
  return { primary, reserve, diag }
}
