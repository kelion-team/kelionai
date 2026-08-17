// ── KELION'S HANDS ON HIS OWN SETTINGS ─────────────────────────────────────
//
// Adrian, Jul 30: "the requirement was his autonomy and solving the settings
// problem for Revolut… **he should create the secrets and put them where they
// belong**, it's mine and I allow him full access."
//
// THAT WAS THE HOLE, and it was mine. All day I told him: "go to the portal,
// make an account, copy the key, go to GitHub → Settings → Secrets, paste it
// there, then run the workflow". Hours of his life, to do by hand exactly
// what a program does in two seconds. And when he asked me why Kelion doesn't
// set them, I answered that "I don't have a tool that writes secrets to
// GitHub" — true at the time, but that's a reason to BUILD the tool, not to
// send him.
//
// From here on Kelion sets his own keys: he writes them into GitHub Secrets
// (encrypted with the repo's public key, as GitHub requires), starts
// `vps-set-env` which carries them to the server and restarts the app, then
// VERIFIES they arrived. Without the human touching anything.
//
// ── WHAT NEVER HAPPENS HERE, WHOEVER ASKS ────────────────────────────────────
//
//   • A secret's VALUE never goes into any response, never enters any log,
//     never gets written into any repo file. The NAME and the LENGTH are
//     reported. (GitHub, for that matter, can't return the value either — by
//     construction. This rule keeps our side.)
//   • A card number does NOT pass through here. If the value looks like a
//     card (13-19 digits passing the Luhn test), it's refused. "He may do
//     anything" is about autonomy, not about letting a PAN leak through an
//     API.
//   • Names starting with `GITHUB_` are refused — GitHub reserves them, and a
//     silently rejected secret is a key written for nothing (the Jul 30 trap,
//     when `vps-set-env` had a fixed name list and the Revolut link fell
//     through).
import _sodium from 'libsodium-wrappers'
import { gh, ghToken, REPO } from './githubApi.js'

const FARA_TOKEN = JSON.stringify({
  error: 'github_token_missing',
  hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env (fin-granulat pe repo, Secrets: write + Actions: write) și repornește.',
})

/** Says EXACTLY what is missing, not just an error code.
 *
 *  An "HTTP 403" makes the human guess — and guessing on GitHub permissions is
 *  exactly how a day was lost on Jul 30 (I sent him to look for `Account:
 *  Read` at Stripe, which wasn't even the problem). Writing secrets requires
 *  the **Secrets: write** permission on the fine-grained token — our own
 *  documentation only mentioned `Actions: write`. So if a 403 comes, that's
 *  the first thing to check, and it's written here, not in my head. */
function lipsaPermisiune(status: number, ce: string): string {
  if (status === 403 || status === 404) {
    return (
      `${ce} (HTTP ${status}). Cel mai probabil tokenul (GITHUB_TOKEN) NU are ` +
      `permisiunea „Secrets: write" pe repo. Se dă din GitHub → Settings → ` +
      `Developer settings → Fine-grained tokens → tokenul kelionai → ` +
      `Repository permissions → Secrets: Read and write. NU e nevoie de nimic altceva.`
    )
  }
  return `${ce} (HTTP ${status}).`
}

/** Accepted names: UPPERCASE, digits and `_`, starting with a letter. */
export function numeSecretValid(nume: string): boolean {
  if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(nume)) return false
  return !nume.startsWith('GITHUB_') // reserved by GitHub — it would be rejected anyway
}

/** Looks like a card number? (13-19 digits + Luhn). See the rule above. */
export function pareCard(valoare: string): boolean {
  const cifre = valoare.replace(/[\s-]/g, '')
  if (!/^\d{13,19}$/.test(cifre)) return false
  let suma = 0
  let dubleaza = false
  for (let i = cifre.length - 1; i >= 0; i--) {
    let d = cifre.charCodeAt(i) - 48
    if (dubleaza) {
      d *= 2
      if (d > 9) d -= 9
    }
    suma += d
    dubleaza = !dubleaza
  }
  return suma % 10 === 0
}

/** The encryption GitHub requires: sealed box (libsodium) with the repo's public key. */
async function cripteaza(valoare: string, cheiePublicaB64: string): Promise<string> {
  await _sodium.ready
  const sodium = _sodium
  const cheie = sodium.from_base64(cheiePublicaB64, sodium.base64_variants.ORIGINAL)
  const plic = sodium.crypto_box_seal(sodium.from_string(valoare), cheie)
  return sodium.to_base64(plic, sodium.base64_variants.ORIGINAL)
}

/** PUTS a secret into the repo. Returns JSON — with the name and the length, NEVER the value. */
export async function seteazaSecret(nume: string, valoare: string): Promise<string> {
  if (!ghToken()) return FARA_TOKEN
  const n = nume.trim().toUpperCase()
  if (!numeSecretValid(n)) {
    return JSON.stringify({ error: 'nume_invalid', hint: 'MAJUSCULE, cifre și _, minim 3 caractere, fără prefixul GITHUB_.' })
  }
  if (!valoare) return JSON.stringify({ error: 'valoare_goala' })
  if (pareCard(valoare)) {
    return JSON.stringify({
      error: 'arata_a_card',
      hint: 'Datele unui card nu trec pe aici, niciodată. Dacă e într-adevăr o cheie și nu un card, ea nu are formă de card.',
    })
  }

  const rk = await gh('/actions/secrets/public-key')
  if (!rk.ok) return JSON.stringify({ error: lipsaPermisiune(rk.status, 'nu pot lua cheia publică a repo-ului') })
  const { key, key_id } = (await rk.json()) as { key: string; key_id: string }

  const encrypted_value = await cripteaza(valoare, key)
  const r = await gh(`/actions/secrets/${n}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value, key_id }),
  })
  if (!r.ok) return JSON.stringify({ error: lipsaPermisiune(r.status, 'GitHub a refuzat scrierea'), nume: n })
  // 201 = created now, 204 = updated.
  console.log(`[SECRETE] ${n}: scris (${valoare.length} caractere) — valoarea NU se afișează`)
  return JSON.stringify({
    ok: true,
    nume: n,
    lungime: valoare.length,
    creat: r.status === 201,
    urmatorul_pas: 'publica_cheile — le duce pe server și repornește aplicația',
  })
}

/** WHICH secrets exist (only the NAMES and the date — GitHub gives the values to nobody). */
export async function listeazaSecrete(): Promise<string> {
  if (!ghToken()) return FARA_TOKEN
  const r = await gh('/actions/secrets?per_page=100')
  if (!r.ok) return JSON.stringify({ error: `nu pot citi lista (HTTP ${r.status})` })
  const j = (await r.json()) as { total_count: number; secrets: { name: string; updated_at: string }[] }
  return JSON.stringify({
    total: j.total_count,
    secrete: (j.secrets ?? []).map((s) => ({ nume: s.name, actualizat: s.updated_at })),
    nota: 'GitHub nu întoarce VALORILE, prin construcție. Aici sunt doar numele.',
  })
}

/** CARRIES the keys to the server: starts `vps-set-env` (writes the env + restarts the app). */
export async function publicaCheile(): Promise<string> {
  if (!ghToken()) return FARA_TOKEN
  const r = await gh('/actions/workflows/vps-set-env.yml/dispatches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'master', inputs: { restart: true } }),
  })
  if (!r.ok) return JSON.stringify({ error: `nu pot porni vps-set-env (HTTP ${r.status})` })
  return JSON.stringify({
    ok: true,
    pornit: 'vps-set-env',
    unde: `https://github.com/${REPO}/actions/workflows/vps-set-env.yml`,
    nota: 'Scrie pe server DOAR secretele care există, apoi repornește aplicația. În jurnal apare numele și câte caractere are — niciodată valoarea.',
  })
}
