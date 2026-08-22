import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mochez DOAR `config` (hoistat de vitest ÎNAINTE de importuri, spre deosebire de
// stubEnv care ar rula după). Testul clientului nu are nevoie de config-ul real —
// doar de cheie (Bearer) + tokenul GitHub (secretul de acces la repo).
vi.mock('../config.js', () => ({ config: { devinKey: 'test-devin-key', githubToken: 'gh-test-token' } }))

import { creeazaSesiuneDevin, stareSesiuneDevin, devinDisponibil, asiguraTokenRepoLaDevin, probaDevin } from './devin.js'

function fetchCare(status: number, corp: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corp,
    text: async () => JSON.stringify(corp),
  })) as unknown as typeof fetch
}

describe('devin — clientul constructorului extern', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('devinDisponibil e true când cheia e în env', () => {
    expect(devinDisponibil()).toBe(true)
  })

  it('creeazaSesiuneDevin trimite Bearer + plafon de cost și întoarce sessionId', async () => {
    const spy = fetchCare(200, { session_id: 'sess-1', url: 'https://app.devin.ai/sessions/sess-1' })
    vi.stubGlobal('fetch', spy)
    const rez = await creeazaSesiuneDevin('repară X', { title: 'Job 1' })
    expect(rez.sessionId).toBe('sess-1')
    expect(rez.url).toBe('https://app.devin.ai/sessions/sess-1')
    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toMatch(/\/sessions$/)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-devin-key' })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.prompt).toBe('repară X')
    expect(body.idempotent).toBe(true)
    expect(typeof body.max_acu_limit).toBe('number') // plafon de cost REAL, din env, nu inventat
    expect(body.max_acu_limit).toBeGreaterThan(0)
  })

  it('creeazaSesiuneDevin aruncă eroare NUMITĂ pe HTTP ne-ok', async () => {
    vi.stubGlobal('fetch', fetchCare(402, { error: 'plan fără API' }))
    await expect(creeazaSesiuneDevin('x')).rejects.toThrow(/devin_creare_esuata: HTTP 402/)
  })

  it('stareSesiuneDevin: working → nu e gata, fără PR', async () => {
    vi.stubGlobal('fetch', fetchCare(200, { status_enum: 'working', acu_consumed: 3.2 }))
    const s = await stareSesiuneDevin('sess-1')
    expect(s.status).toBe('working')
    expect(s.gata).toBe(false)
    expect(s.prUrl).toBeNull()
    expect(s.acu).toBe(3.2) // ACU real pentru bara de progres, nu inventat
  })

  it('stareSesiuneDevin: finished → gata + extrage linkul PR', async () => {
    vi.stubGlobal('fetch', fetchCare(200, {
      status_enum: 'finished',
      pull_request: { url: 'https://github.com/kelion-team/kelionai/pull/1300' },
    }))
    const s = await stareSesiuneDevin('sess-1')
    expect(s.gata).toBe(true)
    expect(s.prUrl).toBe('https://github.com/kelion-team/kelionai/pull/1300')
  })

  it('extrage linkul PR și dintr-un payload nestructurat (ultimă instanță)', async () => {
    vi.stubGlobal('fetch', fetchCare(200, {
      status_enum: 'finished',
      messages: [{ text: 'am deschis https://github.com/kelion-team/kelionai/pull/1301 gata' }],
    }))
    const s = await stareSesiuneDevin('sess-1')
    expect(s.prUrl).toBe('https://github.com/kelion-team/kelionai/pull/1301')
  })

  it('asiguraTokenRepoLaDevin: pune secretul key-value cu sensitive=true, valoarea = tokenul', async () => {
    const spy = fetchCare(200, { id: 'secret-1' })
    vi.stubGlobal('fetch', spy)
    const r = await asiguraTokenRepoLaDevin()
    expect(r.ok).toBe(true)
    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toMatch(/\/secrets$/)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.type).toBe('key-value')
    expect(body.key).toBeTruthy()
    expect(body.value).toBe('gh-test-token')
    expect(body.sensitive).toBe(true) // Devin redactează tokenul în loguri
  })

  it('asiguraTokenRepoLaDevin: „există deja" (409) = OK, idempotent', async () => {
    vi.stubGlobal('fetch', fetchCare(409, { error: 'secret key already exists' }))
    const r = await asiguraTokenRepoLaDevin()
    expect(r.ok).toBe(true)
  })

  it('asiguraTokenRepoLaDevin: eroare reală = ok:false, cu motiv (fără tokenul în clar)', async () => {
    vi.stubGlobal('fetch', fetchCare(500, { error: 'boom' }))
    const r = await asiguraTokenRepoLaDevin()
    expect(r.ok).toBe(false)
    expect(r.motiv).toMatch(/devin_secret_esuat: HTTP 500/)
    expect(r.motiv).not.toContain('gh-test-token') // valoarea nu se scurge în eroare
  })

  // Proba VIE (regula #1): „Devin activ" se MĂSOARĂ pe API, nu se deduce din cheie.
  it('probaDevin: API-ul răspunde (GET sessions cu Bearer) → ok:true', async () => {
    const spy = fetchCare(200, { sessions: [] })
    vi.stubGlobal('fetch', spy)
    const r = await probaDevin()
    expect(r.ok).toBe(true)
    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toMatch(/\/sessions\?limit=1$/)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-devin-key' })
  })

  it('probaDevin: HTTP ne-ok → ok:false cu motiv NUMIT (nu o eroare înghițită)', async () => {
    vi.stubGlobal('fetch', fetchCare(401, { error: 'bad key' }))
    const r = await probaDevin()
    expect(r.ok).toBe(false)
    expect(r.motiv).toMatch(/devin_proba_esuata: HTTP 401/)
  })

  it('probaDevin: rețea picată → ok:false cu motiv, nu excepție', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch)
    const r = await probaDevin()
    expect(r.ok).toBe(false)
    expect(r.motiv).toMatch(/devin_proba_retea/)
  })
})
