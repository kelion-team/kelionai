// ── VERIFICATORUL DE ÎNCADRARE (P2; owner, 15 aug: „nu doar poze") ──────────
// Verdictul de înrămare se MĂSOARĂ din anteturile paginii, cu gardă SSRF la
// fiecare pas de redirect, iar „nu pot verifica" rămâne „nu pot verifica" —
// niciodată un refuz inventat (regula #1).
import { describe, expect, it, vi, beforeEach } from 'vitest'

// DNS-ul e mockuit: testele hotărăsc ele ce IP „are" fiecare nume — fără rețea.
let adrese: Record<string, string> = {}
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    const ip = adrese[host]
    if (!ip) throw new Error(`ENOTFOUND ${host}`)
    return [{ address: ip, family: 4 }]
  },
}))

// fetch mockuit: răspunsuri pe URL, în ordinea cerută.
type Rasp = { status: number; headers?: Record<string, string> }
let raspunsuri: Record<string, Rasp[]> = {}
const fetchFals = vi.fn(async (url: string | URL) => {
  const u = String(url)
  const coada = raspunsuri[u]
  if (!coada?.length) throw new Error(`fetch neasteptat: ${u}`)
  const r = coada.shift() as Rasp
  return {
    status: r.status,
    headers: new Headers(r.headers ?? {}),
    body: null,
  } as unknown as Response
})
vi.stubGlobal('fetch', fetchFals)

const { verificaIncadrarea } = await import('./routes/embedCheck.js')

beforeEach(() => {
  adrese = {}
  raspunsuri = {}
  fetchFals.mockClear()
})

describe('verificatorul de încadrare — verdicte măsurate din anteturi', () => {
  it('X-Frame-Options: DENY → refuz, cu antetul în motiv', async () => {
    adrese['deny.example.com'] = '93.184.216.34'
    raspunsuri['https://deny.example.com/'] = [{ status: 200, headers: { 'x-frame-options': 'DENY' } }]
    const v = await verificaIncadrarea('https://deny.example.com/')
    expect(v.incadrabil).toBe(false)
    expect(v.motiv).toContain('X-Frame-Options')
  })

  it("CSP frame-ancestors 'none' → refuz; frame-ancestors * → permis", async () => {
    adrese['csp.example.com'] = '93.184.216.34'
    raspunsuri['https://csp.example.com/'] = [
      { status: 200, headers: { 'content-security-policy': "frame-ancestors 'none'" } },
    ]
    expect((await verificaIncadrarea('https://csp.example.com/')).incadrabil).toBe(false)
    adrese['liber.example.com'] = '93.184.216.34'
    raspunsuri['https://liber.example.com/'] = [
      { status: 200, headers: { 'content-security-policy': 'frame-ancestors *' } },
    ]
    expect((await verificaIncadrarea('https://liber.example.com/')).incadrabil).toBe(true)
  })

  it('redirectul spre accounts.google.com = peretele de login — refuz spus pe nume', async () => {
    adrese['app.example.com'] = '93.184.216.34'
    adrese['accounts.google.com'] = '142.250.1.84'
    raspunsuri['https://app.example.com/dash'] = [
      { status: 302, headers: { location: 'https://accounts.google.com/signin' } },
    ]
    const v = await verificaIncadrarea('https://app.example.com/dash')
    expect(v.incadrabil).toBe(false)
    expect(v.motiv).toContain('login Google')
    expect(v.urlFinal).toContain('accounts.google.com')
  })

  it('pagină curată (200, fără anteturi de refuz) → încadrabilă', async () => {
    adrese['ok.example.com'] = '93.184.216.34'
    raspunsuri['https://ok.example.com/'] = [{ status: 200 }]
    const v = await verificaIncadrarea('https://ok.example.com/')
    expect(v.incadrabil).toBe(true)
  })

  it('SSRF: numele care se rezolvă într-o adresă privată e refuzat FĂRĂ fetch', async () => {
    adrese['intern.example.com'] = '10.0.0.5'
    const v = await verificaIncadrarea('https://intern.example.com/')
    expect(v.incadrabil).toBe(false)
    expect(v.motiv).toContain('privată')
    expect(fetchFals).not.toHaveBeenCalled()
  })

  it('SSRF prin redirect: 302 spre 169.254.169.254 e refuzat la pasul lui', async () => {
    adrese['sarit.example.com'] = '93.184.216.34'
    raspunsuri['https://sarit.example.com/'] = [
      { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } },
    ]
    const v = await verificaIncadrarea('https://sarit.example.com/')
    expect(v.incadrabil).toBe(false)
    expect(v.motiv).toContain('privată')
  })

  it('HEAD refuzat cu 405 → cade pe GET și citește anteturile de acolo', async () => {
    adrese['gets.example.com'] = '93.184.216.34'
    raspunsuri['https://gets.example.com/'] = [
      { status: 405 },
      { status: 200, headers: { 'x-frame-options': 'SAMEORIGIN' } },
    ]
    const v = await verificaIncadrarea('https://gets.example.com/')
    expect(v.incadrabil).toBe(false)
    expect(v.motiv).toContain('SAMEORIGIN')
  })

  it('rețea picată → „nu pot verifica" (null), NU un refuz inventat', async () => {
    adrese['mort.example.com'] = '93.184.216.34'
    // niciun răspuns pregătit → fetch aruncă
    const v = await verificaIncadrarea('https://mort.example.com/')
    expect(v.incadrabil).toBe(null)
    expect(v.motiv).toContain('nu pot verifica')
  })
})
