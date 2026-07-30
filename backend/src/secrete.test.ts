// ── KELION ÎȘI PUNE SINGUR CHEILE — ce apără testul ăsta ─────────────────────
//
// Adrian, 30 iul: „să creeze secretele și să le pună unde trebuie, e al meu și
// îi permit full acces."
//
// „Full acces" e despre AUTONOMIE, nu despre neglijență. Trei lucruri nu au voie
// să se strice niciodată aici, și fiecare are un test:
//
//   1. VALOAREA nu iese înapoi. Nici în răspuns, nici pe jumătate, nici „primele
//      caractere". Ea intră criptată în GitHub și atât. Testul caută valoarea în
//      TOT răspunsul — dacă vreodată cineva o pune acolo „ca să se vadă că a
//      mers", pică roșu.
//   2. Un NUMĂR DE CARD nu trece pe aici. Regula ownerului din 30 iul e că
//      datele unui card nu se plimbă prin aplicație; un API care scrie „orice
//      text" ar fi exact locul prin care s-ar strecura.
//   3. Un NUME greșit se REFUZĂ, nu se scrie degeaba. Capcana din 30 iul:
//      `REVOLUT_PAY_LINK` scris corect în GitHub, dar căzut în gol fiindcă lista
//      din workflow nu-l conținea. O cheie „pusă" care nu ajunge nicăieri e mai
//      rea decât una lipsă: pare rezolvată.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import _sodium from 'libsodium-wrappers'

await _sodium.ready
const pereche = _sodium.crypto_box_keypair()
const CHEIE_PUBLICA = _sodium.to_base64(pereche.publicKey, _sodium.base64_variants.ORIGINAL)

interface Cerere {
  path: string
  method: string
  body: unknown
}
let cereri: Cerere[] = []
let token = 'ghp_test'
// Când e pornit, GitHub „refuză" — ca să probăm mesajul de permisiune lipsă.
let fortezaRefuz = false

vi.mock('./services/githubApi.js', () => ({
  REPO: 'kelion-team/kelionai',
  ghToken: () => token,
  gh: async (path: string, init?: RequestInit) => {
    cereri.push({
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    if (fortezaRefuz) return new Response('', { status: 403 })
    if (path === '/actions/secrets/public-key') {
      return new Response(JSON.stringify({ key: CHEIE_PUBLICA, key_id: '568250167242549743' }), { status: 200 })
    }
    if (path.startsWith('/actions/secrets/')) return new Response('', { status: 201 })
    if (path === '/actions/secrets?per_page=100') {
      return new Response(
        JSON.stringify({ total_count: 1, secrets: [{ name: 'REVOLUT_PAY_LINK', updated_at: '2026-07-30T10:00:00Z' }] }),
        { status: 200 },
      )
    }
    if (path.endsWith('/dispatches')) return new Response(null, { status: 204 })
    return new Response('', { status: 599 })
  },
}))

const { seteazaSecret, listeazaSecrete, publicaCheile, numeSecretValid, pareCard } = await import('./services/secrete.js')

const VALOARE = 'rk_live_9f3ac21b7de44c8ea5' // o „cheie" inventată, doar pentru test

beforeEach(() => {
  cereri = []
  token = 'ghp_test'
  fortezaRefuz = false
})

describe('Kelion își pune singur cheile', () => {
  it('numele: MAJUSCULE cu _, fără prefixul rezervat GITHUB_', () => {
    expect(numeSecretValid('REVOLUT_API_KEY')).toBe(true)
    expect(numeSecretValid('revolut_api_key')).toBe(false)
    expect(numeSecretValid('GITHUB_TOKEN')).toBe(false) // GitHub îl refuză oricum
    expect(numeSecretValid('AB')).toBe(false)
    expect(numeSecretValid('2FA_KEY')).toBe(false) // nu poate începe cu cifră
  })

  it('scrie cheia criptat și raportează NUMELE și LUNGIMEA — niciodată valoarea', async () => {
    const raspuns = await seteazaSecret('revolut_api_key', VALOARE)
    const j = JSON.parse(raspuns)
    expect(j.ok).toBe(true)
    expect(j.nume).toBe('REVOLUT_API_KEY') // normalizat la MAJUSCULE
    expect(j.lungime).toBe(VALOARE.length)
    // REGULA DE FIER: valoarea nu apare NICĂIERI în răspuns, nici măcar un ciot.
    expect(raspuns).not.toContain(VALOARE)
    expect(raspuns).not.toContain(VALOARE.slice(0, 8))

    // Și pe sârmă a plecat criptată, nu în clar.
    const scriere = cereri.find((c) => c.method === 'PUT')!
    const trimis = JSON.stringify(scriere.body)
    expect(trimis).not.toContain(VALOARE)
    expect((scriere.body as { encrypted_value: string }).encrypted_value.length).toBeGreaterThan(20)
    // Plicul chiar se poate deschide cu perechea de chei — deci e sealed box valid.
    const desfacut = _sodium.crypto_box_seal_open(
      _sodium.from_base64((scriere.body as { encrypted_value: string }).encrypted_value, _sodium.base64_variants.ORIGINAL),
      pereche.publicKey,
      pereche.privateKey,
    )
    expect(_sodium.to_string(desfacut)).toBe(VALOARE)
  })

  it('un număr de card NU trece pe aici, oricine ar cere-o', async () => {
    const j = JSON.parse(await seteazaSecret('CARD_TEST', '4242424242424242'))
    expect(j.error).toBe('arata_a_card')
    expect(cereri).toHaveLength(0) // nici măcar n-a atins GitHub
    expect(pareCard('4242 4242 4242 4242')).toBe(true)
    expect(pareCard(VALOARE)).toBe(false)
  })

  it('nume invalid → refuzat, nu scris degeaba', async () => {
    const j = JSON.parse(await seteazaSecret('cheie mea', 'x'))
    expect(j.error).toBe('nume_invalid')
    expect(cereri).toHaveLength(0)
  })

  it('fără token nu se preface că a mers', async () => {
    token = ''
    expect(JSON.parse(await seteazaSecret('REVOLUT_API_KEY', VALOARE)).error).toBe('github_token_missing')
    expect(JSON.parse(await listeazaSecrete()).error).toBe('github_token_missing')
    expect(JSON.parse(await publicaCheile()).error).toBe('github_token_missing')
  })

  it('un 403 spune EXACT ce permisiune lipsește — nu-l pune pe om să ghicească', async () => {
    // Lecția din 30 iul: l-am trimis pe owner să caute o permisiune Stripe care
    // nici măcar nu era problema. Un cod de eroare gol e o vânătoare de comori.
    token = 'ghp_fara_drepturi'
    fortezaRefuz = true
    const j = JSON.parse(await seteazaSecret('REVOLUT_API_KEY', VALOARE))
    expect(j.error).toContain('Secrets: write')
    expect(j.error).toContain('Fine-grained tokens')
    // Și tot NU scapă valoarea în mesajul de eroare.
    expect(JSON.stringify(j)).not.toContain(VALOARE)
    fortezaRefuz = false
  })

  it('lista dă doar NUMELE — GitHub nu întoarce valori nimănui', async () => {
    const j = JSON.parse(await listeazaSecrete())
    expect(j.secrete).toEqual([{ nume: 'REVOLUT_PAY_LINK', actualizat: '2026-07-30T10:00:00Z' }])
  })

  it('publicarea pornește vps-set-env pe master, cu repornire', async () => {
    const j = JSON.parse(await publicaCheile())
    expect(j.ok).toBe(true)
    const d = cereri.find((c) => c.path.endsWith('/dispatches'))!
    expect(d.path).toContain('vps-set-env.yml')
    expect(d.body).toEqual({ ref: 'master', inputs: { restart: true } })
  })
})
