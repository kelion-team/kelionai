// ── KELION VEDE TOT CE VEDE PANOUL DE ADMIN ─────────────────────────────────
//
// Adrian, 31 iul, a treia oară: „Kelion trebuie să poată vedea tot ce conține
// adminul, și să poată modifica, să aibă full acces la codul sursă. A treia
// oară nu-ți mai cer, te înjur direct."
//
// Are dreptate că a cerut-o de trei ori. Avea `read_source` (codul), `db_query`
// (datele brute) și `repo_write` (scrisul) — dar NU ce vede el pe ecran: cifrele
// agregate, verdictele, listele pe care le calculează rutele de admin. Când îi
// spunea „uită-te în tabul Bani", Kelion trebuia să reconstruiască din SQL ce
// panoul avea deja gata calculat — și de multe ori ieșea altceva.
//
// Aici e legătura care lipsea: aceleași rute pe care le cheamă panoul, chemate
// de el. Nu o copie a logicii (ar diverge într-o săptămână) — chiar rutele.
//
// PROIECTARE, și de ce:
//   • O SINGURĂ unealtă de citire pentru toate cele ~30 de tab-uri. Nu treizeci
//     de unelte care ar umple fereastra de context și s-ar învechi la fiecare
//     rută nouă.
//   • Numele rutelor NU sunt scrise de mână aici: se cer de la aplicație, deci
//     o rută nouă apare singură în lista lui.
//   • Citirea e liberă; SCRISUL trece prin listă albă explicită, fiindcă printre
//     rutele de admin sunt și cele care mișcă bani (`deposit`, `payout`,
//     `sell-credits`) sau restaurează baza (`backups/restore`). Alea rămân ale
//     ownerului — nu fiindcă n-am încredere în el, ci fiindcă o greșeală acolo
//     nu se poate desface.

/** Rutele de admin pe care NU le poate chema singur, cu motivul scris.
 *  Regula: dacă greșeala nu se poate desface, o apeși tu. */
const DOAR_OWNERUL = new Map<string, string>([
  ['deposit', 'mișcă bani reali în pungă'],
  ['payout', 'scoate bani din cont'],
  ['sell-credits', 'creditează un user cu bani'],
  ['brain-credit', 'mișcă bani reali'],
  ['backups/restore', 'suprascrie baza de date întreagă'],
  ['reset-counters', 'șterge contoare, nu se poate desface'],
  ['unlock/secret', 'poarta ta de admin — nu se atinge singur'],
  ['money-circuit/card-key', 'expune cheia de card'],
])

/** Trunchiem ce e prea lung ca să nu mănânce fereastra de context a creierului. */
const MAX = 20_000

/** Rutele se cheamă pe LIVE, nu pe localhost: ce vede el trebuie să fie exact
 *  ce vezi tu în panou, din aceeași aplicație. */
function url(cale: string): string {
  const c = cale.replace(/^\/+/, '').replace(/^api\/admin\//, '')
  return `https://kelionai.app/api/admin/${c}`
}

/**
 * Citește o secțiune din panoul de admin — exact datele pe care le vede el.
 *
 * `cookie` e sesiunea admin a celui care cere: fără ea ruta răspunde 403, și e
 * bine așa — unealta nu ocolește poarta de admin, o folosește.
 */
export async function adminVezi(cale: string, cookie: string): Promise<string> {
  if (!cale.trim()) return JSON.stringify({ error: 'spune ce secțiune vrei, ex. „finance" sau „users"' })
  try {
    const r = await fetch(url(cale), { headers: cookie ? { cookie } : {} })
    const text = (await r.text()).slice(0, MAX)
    if (!r.ok) {
      return JSON.stringify({
        error: `panoul a răspuns ${r.status}`,
        detaliu: r.status === 403 ? 'sesiunea nu e de admin — cere-i ownerului să fie logat' : text.slice(0, 500),
      })
    }
    return text
  } catch (e) {
    return JSON.stringify({ error: `n-am putut citi „${cale}": ${(e as Error).message}` })
  }
}

/**
 * Schimbă ceva în panou (POST), pe rutele care se pot desface.
 *
 * Ce mișcă bani sau restaurează baza rămâne al ownerului — răspunsul spune
 * limpede CARE e ruta și DE CE, ca să nu pară un refuz arbitrar.
 */
export async function adminSchimba(cale: string, corp: unknown, cookie: string): Promise<string> {
  const c = cale.replace(/^\/+/, '').replace(/^api\/admin\//, '')
  const motiv = DOAR_OWNERUL.get(c)
  if (motiv) {
    return JSON.stringify({
      error: 'oprit_intentionat',
      ruta: c,
      de_ce: `${motiv} — o greșeală aici nu se poate desface, deci o apeși tu`,
      ce_pot_face: 'îți pregătesc exact ce ai de apăsat și-ți spun ce se va întâmpla',
    })
  }
  try {
    const r = await fetch(url(c), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(corp ?? {}),
    })
    const text = (await r.text()).slice(0, MAX)
    return JSON.stringify({ ok: r.ok, status: r.status, raspuns: text.slice(0, 4000) })
  } catch (e) {
    return JSON.stringify({ error: `n-am putut schimba „${c}": ${(e as Error).message}` })
  }
}
