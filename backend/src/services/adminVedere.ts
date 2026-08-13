// ── KELION SEES EVERYTHING THE ADMIN PANEL SEES ─────────────────────────────
//
// Adrian, 31 Jul, for the third time: "Kelion must be able to see everything
// the admin contains, and to modify it, to have full access to the source
// code. I won't ask you a third time, I'll just curse you."
//
// He is right that he asked three times. He had `read_source` (the code),
// `db_query` (raw data) and `repo_write` (writing) — but NOT what he sees on
// screen: the aggregated figures, the verdicts, the lists computed by the
// admin routes. When he told him "look in the Money tab", Kelion had to
// rebuild from SQL what the panel already had computed — and often came out
// with something else.
//
// Here is the missing link: the very same routes the panel calls, called by
// him. Not a copy of the logic (it would diverge within a week) — the actual
// routes.
//
// DESIGN, and why:
//   • ONE SINGLE read tool for all ~30 tabs. Not thirty tools that would fill
//     the context window and go stale with every new route.
//   • Route names are NOT hand-written here: they are requested from the app,
//     so a new route shows up in his list on its own.
//   • Reading is free; WRITING goes through an explicit allowlist, because
//     among the admin routes are also the ones that move money (`user` with
//     action credit, `brain-credit`) or destroy what cannot be brought back
//     (`user` with action delete, `backups/restore`). Those stay with the
//     owner — not because I don't trust him, but because a mistake there
//     cannot be undone.

import { config } from '../config.js'

/** The admin routes he may NOT call on his own, with the reason written down.
 *  The rule: if the mistake cannot be undone, you press it yourself.
 *
 *  KEEP THIS LIST TRUE: the Stripe-era entries (deposit / payout /
 *  sell-credits / money-circuit/card-key) were removed together with their
 *  routes (31 Jul) — guarding a route that no longer exists while the REAL
 *  money route (`/api/admin/user`: credit = money moved, delete = data gone
 *  forever) stayed open would have been a hole, not a guard. */
const DOAR_OWNERUL = new Map<string, string>([
  ['user', 'creditează cu bani reali sau șterge definitiv un user'],
  ['brain-credit', 'mișcă bani reali'],
  ['backups/restore', 'suprascrie baza de date întreagă'],
  ['reset-counters', 'șterge contoare, nu se poate desface'],
  ['unlock/secret', 'poarta ta de admin — nu se atinge singur'],
])

/** We truncate what is too long so it doesn't eat the brain's context window. */
const MAX = 20_000

// ALIASURI DE SECȚIUNE (owner, 13 aug: „alertele îi dau lui Kelion 404"). Datele
// de alerte pentru owner stau la /api/admin/notificari (cererile lui) și
// /api/admin/erori (erorile recente), dar creierul cerea firesc „alerte"/„alerts"
// → ruta nu există → 404. Mapăm numele firești pe rutele REALE, ca „arată-mi
// alertele" să meargă, în loc să ghicească o secțiune inexistentă.
const ALIAS_SECTIUNE: Record<string, string> = {
  alerte: 'notificari',
  alerts: 'notificari',
  notifications: 'notificari',
  notificari: 'notificari',
  erori: 'erori',
  errors: 'erori',
  greseli: 'erori',
}

// CATALOGUL SECȚIUNILOR pe care Kelion le poate CITI (owner, 13 aug: „nu știe
// unde sunt butoanele, nu are inventar"). Când `admin_vezi` e chemat fără
// secțiune — sau cu una inexistentă (404) — întoarce lista asta, ca să nu
// ghicească un nume care nu există și să pară orb. Sunt rutele GET reale din
// routes/admin.ts; când adaugi o secțiune nouă acolo, adaug-o și aici.
const SECTIUNI: { nume: string; ce: string }[] = [
  { nume: 'erori', ce: 'erorile recente ale userilor (F12/client) + explicație' },
  { nume: 'notificari', ce: 'alertele/notificările pentru owner (alias: alerte)' },
  { nume: 'finance', ce: 'situația financiară (venituri, solduri)' },
  { nume: 'money-circuit', ce: 'circuitul banilor, cap la cap' },
  { nume: 'transactions', ce: 'tranzacțiile' },
  { nume: 'plati', ce: 'plățile (încasate / neatribuite / coduri)' },
  { nume: 'costs', ce: 'costurile reale ale aplicației' },
  { nume: 'credit-ai', ce: 'creditul AI rămas' },
  { nume: 'brain-credit', ce: 'creditul creierului (Gemini)' },
  { nume: 'users', ce: 'utilizatorii' },
  { nume: 'activity', ce: 'activitatea recentă a userilor' },
  { nume: 'demos', ce: 'statistici demo' },
  { nume: 'leads', ce: 'lead-uri' },
  { nume: 'contact-messages', ce: 'mesaje din formularul de contact' },
  { nume: 'visitor-chats', ce: 'conversațiile vizitatorilor' },
  { nume: 'audit', ce: 'jurnalul de audit' },
  { nume: 'gaps', ce: 'cererile neacoperite (capability gaps)' },
  { nume: 'kelion-tools', ce: 'uneltele pe care Kelion și le-a propus (de aprobat)' },
  { nume: 'autonomie/dovezi', ce: 'dovezile de autonomie' },
  { nume: 'plafon-constructor', ce: 'plafonul zilnic de bani al constructorului' },
  { nume: 'models', ce: 'modelele de creier + verificarea lor' },
  { nume: 'keys', ce: 'cheile/secretele (doar starea, nu valorile)' },
  { nume: 'token-checks', ce: 'verificarea token-urilor / integrărilor' },
  { nume: 'env-check', ce: 'variabilele de mediu (prezente / lipsă)' },
  { nume: 'backups', ce: 'punctele de restaurare' },
  { nume: 'stores', ce: 'prezența în magazine (Windows/Android/iOS/web)' },
  { nume: 'inbound', ce: 'emailurile primite recent' },
]

/** Lista secțiunilor ca text pentru creier — „ce pot citi și cum se cheamă". */
function catalogSectiuni(): string {
  return JSON.stringify({
    nota: 'Secțiunile pe care le pot CITI cu admin_vezi(sectiune). Alege numele EXACT din listă.',
    sectiuni: SECTIUNI,
  })
}

/** Rutele se cheamă pe BUCLA LOCALĂ (127.0.0.1:port), nu pe domeniul public.
 *  E ACELAȘI proces, aceeași bază de date, exact datele pe care le vezi în panou
 *  — dar pe drumul care nu poate cădea.
 *
 *  DE CE (rule #2, „prima dată caut în codul meu care a produs raportul"; owner,
 *  13 aug: „Kelion e orb pe admin, îi sabotezi activitatea"): `https://kelionai.app`
 *  însemna VPS → internet public → înapoi la același VPS (hairpin-NAT + un TLS
 *  către tine însuți). Când conexiunile IEȘITE ale VPS-ului pică — MĂSURAT chiar
 *  în logurile ownerului din aceeași zi: „[mailbox] poll failed: Failed to
 *  establish connection in required time" / „[mail] send failed: Connection
 *  timeout" — ACEST fetch pica la fel, iar `admin_vezi` întorcea o eroare de
 *  rețea. Deci Kelion AVEA unealta, dar unealta murea pe drumul pe care i-l
 *  pusesem eu. Bucla locală e fix calea pe care vocea își cheamă deja creierul
 *  (`http://127.0.0.1:${config.port}/api/chat`, vocalLive.ts), dovedită în
 *  producție: fără DNS, fără hairpin, fără TLS-către-sine, și mai rapid. Poarta
 *  de admin rămâne — cookie-ul e trimis mai departe, iar aceeași rută îl
 *  validează în proces, exact ca peste rețea. */
function url(cale: string): string {
  const c = cale.replace(/^\/+/, '').replace(/^api\/admin\//, '')
  const mapat = ALIAS_SECTIUNE[c.toLowerCase()] ?? c
  return `http://127.0.0.1:${config.port}/api/admin/${mapat}`
}

/**
 * Reads a section of the admin panel — exactly the data he sees.
 *
 * `cookie` is the admin session of the requester: without it the route answers
 * 403, and that is good — the tool does not bypass the admin gate, it uses it.
 */
export async function adminVezi(cale: string, cookie: string): Promise<string> {
  // Fără secțiune → nu „sunt orb", ci CATALOGUL: ce pot citi și cum se cheamă.
  if (!cale.trim()) return catalogSectiuni()
  try {
    const r = await fetch(url(cale), { headers: cookie ? { cookie } : {} })
    const text = (await r.text()).slice(0, MAX)
    if (!r.ok) {
      // 404 = secțiune inexistentă → dau catalogul, ca să aleagă numele corect,
      // nu să repete un nume care nu există (owner: „nu știe unde-s butoanele").
      if (r.status === 404) {
        return JSON.stringify({ error: `secțiunea „${cale}" nu există`, alege_din: SECTIUNI })
      }
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
 * Changes something in the panel (POST), on the routes that can be undone.
 *
 * What moves money or restores the database stays with the owner — the reply
 * states clearly WHICH route it is and WHY, so it doesn't look like an
 * arbitrary refusal.
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
