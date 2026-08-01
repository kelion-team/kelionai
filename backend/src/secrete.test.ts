// ── KELION PUTS ITS OWN KEYS — what this test guards ─────────────────────
//
// Adrian, Jul 30: "let it create the secrets and put them where they belong,
// it's mine and I allow it full access."
//
// "Full access" is about AUTONOMY, not about negligence. Three things are
// never allowed to break here, and each has a test:
//
//   1. The VALUE never comes back out. Not in the response, not half of it,
//      not "the first characters". It goes encrypted into GitHub and that's
//      all. The test searches the value in the WHOLE response — if someone
//      ever puts it there "so you can see it worked", it goes red.
//   2. A CARD NUMBER does not pass through here. The owner's rule from Jul 30
//      is that card data doesn't travel through the app; an API that writes
//      "any text" would be exactly the place it would sneak through.
//   3. A wrong NAME gets REFUSED, not written for nothing. The Jul 30 trap:
//      `REVOLUT_PAY_LINK` written correctly in GitHub, but fallen into the
//      void because the workflow's list didn't contain it. A "placed" key that
//      reaches nowhere is worse than a missing one: it looks solved.
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
// When turned on, GitHub "refuses" — so we can prove the missing-permission message.
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

const VALOARE = 'rk_live_9f3ac21b7de44c8ea5' // an invented "key", only for the test

beforeEach(() => {
  cereri = []
  token = 'ghp_test'
  fortezaRefuz = false
})

describe('Kelion își pune singur cheile', () => {
  it('numele: MAJUSCULE cu _, fără prefixul rezervat GITHUB_', () => {
    expect(numeSecretValid('REVOLUT_API_KEY')).toBe(true)
    expect(numeSecretValid('revolut_api_key')).toBe(false)
    expect(numeSecretValid('GITHUB_TOKEN')).toBe(false) // GitHub refuses it anyway
    expect(numeSecretValid('AB')).toBe(false)
    expect(numeSecretValid('2FA_KEY')).toBe(false) // can't start with a digit
  })

  it('scrie cheia criptat și raportează NUMELE și LUNGIMEA — niciodată valoarea', async () => {
    const raspuns = await seteazaSecret('revolut_api_key', VALOARE)
    const j = JSON.parse(raspuns)
    expect(j.ok).toBe(true)
    expect(j.nume).toBe('REVOLUT_API_KEY') // normalized to UPPERCASE
    expect(j.lungime).toBe(VALOARE.length)
    // THE IRON RULE: the value appears NOWHERE in the response, not even a stump.
    expect(raspuns).not.toContain(VALOARE)
    expect(raspuns).not.toContain(VALOARE.slice(0, 8))

    // And on the wire it left encrypted, not in the clear.
    const scriere = cereri.find((c) => c.method === 'PUT')!
    const trimis = JSON.stringify(scriere.body)
    expect(trimis).not.toContain(VALOARE)
    expect((scriere.body as { encrypted_value: string }).encrypted_value.length).toBeGreaterThan(20)
    // The envelope really can be opened with the keypair — so it's a valid sealed box.
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
    expect(cereri).toHaveLength(0) // it didn't even touch GitHub
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
    // The lesson from Jul 30: I sent the owner hunting for a Stripe permission
    // that wasn't even the problem. An empty error code is a treasure hunt.
    token = 'ghp_fara_drepturi'
    fortezaRefuz = true
    const j = JSON.parse(await seteazaSecret('REVOLUT_API_KEY', VALOARE))
    expect(j.error).toContain('Secrets: write')
    expect(j.error).toContain('Fine-grained tokens')
    // And still the value does NOT leak into the error message.
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
