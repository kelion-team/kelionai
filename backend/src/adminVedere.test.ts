import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adminVezi, adminSchimba } from './services/adminVedere.js'

// ── VEDEREA ADMIN A LUI KELION — pe BUCLA LOCALĂ, nu pe hairpin-ul public ────
// Owner, 13 aug: „Kelion e orb pe admin, îi sabotezi activitatea". Cauza,
// măsurată în codul propriu (rule #2): `admin_vezi` chema `https://kelionai.app`
// — VPS → internet public → înapoi la VPS. Când ies conexiunile VPS-ului (chiar
// în logurile lui: „[mailbox] poll failed"), fetch-ul pica → unealta murea.
// Testul PROBEAZĂ că acum se cheamă bucla (127.0.0.1:port), că poarta (cookie-ul)
// e dusă mai departe, că aliasul „alerte"→„notificari" merge și că fără secțiune
// (sau 404) primește CATALOGUL, ca să nu ghicească un nume care nu există.

describe('adminVezi — vedere admin pe bucla locală', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('cheamă bucla locală (127.0.0.1), NU domeniul public, și duce cookie-ul mai departe', async () => {
    await adminVezi('finance', 'sid=abc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [urlApelat, opt] = fetchMock.mock.calls[0]
    expect(String(urlApelat)).toContain('http://127.0.0.1:')
    expect(String(urlApelat)).not.toContain('kelionai.app')
    expect(String(urlApelat)).toContain('/api/admin/finance')
    expect((opt as RequestInit).headers).toMatchObject({ cookie: 'sid=abc' })
  })

  it('aliasul „alerte" → ruta reală „notificari"', async () => {
    await adminVezi('alerte', 'sid=abc')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/notificari')
  })

  it('fără secțiune → CATALOGUL secțiunilor, nu o eroare oarbă (fără fetch)', async () => {
    const r = JSON.parse(await adminVezi('', 'sid=abc'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(Array.isArray(r.sectiuni)).toBe(true)
    expect(r.sectiuni.map((s: { nume: string }) => s.nume)).toContain('erori')
  })

  it('secțiune inexistentă (404) → întoarce lista din care să aleagă', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }))
    const r = JSON.parse(await adminVezi('habarnam', 'sid=abc'))
    expect(r.error).toContain('nu există')
    expect(Array.isArray(r.alege_din)).toBe(true)
  })

  it('403 → spune clar că sesiunea nu e de admin', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    const r = JSON.parse(await adminVezi('users', ''))
    expect(r.error).toContain('403')
    expect(r.detaliu).toContain('admin')
  })
})

describe('adminSchimba — scrie pe bucla locală, dar owner-only rămâne oprit', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('o rută care mișcă bani (user) e OPRITĂ intenționat, fără fetch', async () => {
    const r = JSON.parse(await adminSchimba('user', { action: 'credit' }, 'sid=abc'))
    expect(r.error).toBe('oprit_intentionat')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('o rută reversibilă se scrie pe bucla locală', async () => {
    await adminSchimba('gestures', { disabled: [] }, 'sid=abc')
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://127.0.0.1:')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/gestures')
  })
})
