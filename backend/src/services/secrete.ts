// ── MÂINILE LUI KELION PE PROPRIILE LUI SETĂRI ───────────────────────────────
//
// Adrian, 30 iul: „cerința a fost autonomia lui și să rezolve problema cu
// setările pentru Revolut… **să creeze secretele și să le pună unde trebuie**,
// e al meu și îi permit full acces."
//
// ASTA ERA GAURA, și era a mea. Toată ziua i-am spus: „intră pe portal, fă un
// cont, copiază cheia, du-te în GitHub → Settings → Secrets, lipește-o acolo,
// apoi rulează workflow-ul". Ore din viața lui, ca să facă de mână exact ce un
// program face în două secunde. Iar când m-a întrebat de ce nu le pune Kelion,
// i-am răspuns că „nu am unealtă care să scrie secrete în GitHub" — adevărat
// atunci, dar ăsta e un motiv să CONSTRUIESC unealta, nu să-l trimit pe el.
//
// De aici încolo Kelion își pune singur cheile: le scrie în GitHub Secrets
// (criptate cu cheia publică a repo-ului, cum cere GitHub), pornește
// `vps-set-env` care le duce pe server și repornește aplicația, apoi VERIFICĂ
// că au ajuns. Fără ca omul să atingă nimic.
//
// ── CE NU SE ÎNTÂMPLĂ NICIODATĂ AICI, ORICINE AR CERE ────────────────────────
//
//   • VALOAREA unui secret nu se întoarce în niciun răspuns, nu intră în
//     niciun jurnal, nu se scrie în niciun fișier din repo. Se raportează
//     NUMELE și LUNGIMEA. (GitHub, de altfel, nici nu poate da valoarea înapoi
//     — prin construcție. Regula asta o ține partea noastră.)
//   • Un număr de card NU trece pe aici. Dacă valoarea arată a card (13-19
//     cifre care trec testul Luhn), se refuză. „Are voie orice" e despre
//     autonomie, nu despre a lăsa un PAN să curgă printr-un API.
//   • Numele care încep cu `GITHUB_` se refuză — GitHub le rezervă, iar un
//     secret respins tăcut e o cheie scrisă degeaba (capcana din 30 iul, când
//     `vps-set-env` avea o listă fixă de nume și linkul Revolut cădea în gol).
import _sodium from 'libsodium-wrappers'
import { gh, ghToken, REPO } from './githubApi.js'

const FARA_TOKEN = JSON.stringify({
  error: 'github_token_missing',
  hint: 'pune GITHUB_TOKEN în /root/kelion/kelionai.env (fin-granulat pe repo, Secrets: write + Actions: write) și repornește.',
})

/** Numele acceptate: MAJUSCULE, cifre și `_`, începând cu o literă. */
export function numeSecretValid(nume: string): boolean {
  if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(nume)) return false
  return !nume.startsWith('GITHUB_') // rezervat de GitHub — ar fi respins oricum
}

/** Arată a număr de card? (13-19 cifre + Luhn). Vezi regula de sus. */
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

/** Criptarea cerută de GitHub: sealed box (libsodium) cu cheia publică a repo-ului. */
async function cripteaza(valoare: string, cheiePublicaB64: string): Promise<string> {
  await _sodium.ready
  const sodium = _sodium
  const cheie = sodium.from_base64(cheiePublicaB64, sodium.base64_variants.ORIGINAL)
  const plic = sodium.crypto_box_seal(sodium.from_string(valoare), cheie)
  return sodium.to_base64(plic, sodium.base64_variants.ORIGINAL)
}

/** PUNE un secret în repo. Întoarce JSON — cu numele și lungimea, NU cu valoarea. */
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
  if (!rk.ok) return JSON.stringify({ error: `nu pot lua cheia publică a repo-ului (HTTP ${rk.status})` })
  const { key, key_id } = (await rk.json()) as { key: string; key_id: string }

  const encrypted_value = await cripteaza(valoare, key)
  const r = await gh(`/actions/secrets/${n}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value, key_id }),
  })
  if (!r.ok) return JSON.stringify({ error: `GitHub a refuzat (HTTP ${r.status})`, nume: n })
  // 201 = creat acum, 204 = actualizat.
  console.log(`[SECRETE] ${n}: scris (${valoare.length} caractere) — valoarea NU se afișează`)
  return JSON.stringify({
    ok: true,
    nume: n,
    lungime: valoare.length,
    creat: r.status === 201,
    urmatorul_pas: 'publica_cheile — le duce pe server și repornește aplicația',
  })
}

/** CE secrete există (doar NUMELE și data — GitHub nu dă valorile nimănui). */
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

/** DUCE cheile pe server: pornește `vps-set-env` (scrie env-ul + repornește app-ul). */
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
