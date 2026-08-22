import { describe, it, expect, vi } from 'vitest'
import { verificaConexiuneReala, esteConectat } from './lib/conexiune'

// ── PREZENȚA ONLINE (mod companion, faza 0) ─────────────────────────────────
// Adevărul vine dintr-un PING real la /health, nu din `navigator.onLine` (care e
// true și pe router fără internet). Probăm exact asta: OK → online; eșec sau
// ne-2xx → offline, fără să inventeze „online" (regula #1).
describe('conexiune — online se decide pe ping REAL, nu pe navigator.onLine', () => {
  it('/health răspunde 200 → online', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
    expect(await verificaConexiuneReala()).toBe(true)
    expect(esteConectat()).toBe(true)
  })

  it('/health pică (fără net) → offline, NU „online" inventat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    expect(await verificaConexiuneReala()).toBe(false)
    expect(esteConectat()).toBe(false)
  })

  it('/health răspunde ne-2xx (portal captiv) → offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    expect(await verificaConexiuneReala()).toBe(false)
  })
})
