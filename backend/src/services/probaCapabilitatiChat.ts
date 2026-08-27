// ── PROBAREA CAPABILITĂȚILOR DIN CALEA CHAT (extindere autoverificare) ────────
//
// PROBLEMA (owner, 28 aug): „creierul trebuie să analizeze fiecare funcție din
// aplicație și să decida ce face cu ea". Autoverificarea existentă probează
// doar SHARED_ADMIN_TOOLS (8) + googleTools (33) = 41 din 91 capabilități.
// Celelalte 50 apar ca „nu_pot_verifica — se execută pe calea chat" — ceea ce
// e cinstit dar NEUTIL: ownerul vrea verdict real pe fiecare.
//
// SOLUȚIA: acest modul probează DIRECT funcțiile de citire din chat.ts și
// adminTools.ts care sunt safe (fără efecte secundare). Funcțiile cu efect
// (build, email, ștergere, generare) rămân dry-run (verifică doar cablajul).
//
// REGULA #1 rămâne: o citire picată se SPUNE, nu se maschează în succes.

import { execUserScopedTool, USER_SCOPED_TOOLS } from './adminTools.js'
import { listBuildJobs, listNotes } from '../db.js'
import { citesteEpisoade } from './promoEpisoade.js'
import { meniulDeTarife } from './tarife.js'

/** Capabilitățile care pot fi probate DIRECT prin handler-ul lor de citire
 *  (fără efecte secundare, fără cost). Restul rămân „nu_pot_verifica". */
const PROBA_DIRECTA: ReadonlySet<string> = new Set([
  // USER_SCOPED_TOOLS — toate sunt citiri sau logări safe
  ...USER_SCOPED_TOOLS,
  // chat.ts — citiri safe (fără efecte, fără cost, fără monitor)
  'constructor_status',
  'lista_tarife',
  'episoade_promo',
  'list_notes',
  // Browser, monitor, vedere — NU se probează (efecte pe monitor/screenshot)
  // Generări (imagine/video) — NU se probează (cost)
  // show_on_screen/show_document/run_web_app — NU (efect pe monitor)
  // apeleaza_user — NU (apel real)
])

export interface ProbaChatResult {
  ok: boolean
  rezultat?: string
  eroare?: string
}

/** Probează o capabilitate care trăiește în calea chat (nu în dispecerul
 *  standard). Returnează null dacă funcția NU se poate proba direct (efect/
 *  cost/monitor) — caller-ul o marchează „nu_pot_verifica". */
export async function probaCapabilitateChat(
  name: string,
  email: string,
  isAdmin: boolean,
): Promise<ProbaChatResult | null> {
  if (!PROBA_DIRECTA.has(name)) return null

  try {
    // USER_SCOPED_TOOLS — executorul shared cu voice
    if (USER_SCOPED_TOOLS.has(name)) {
      const result = await execUserScopedTool(name, {}, email, isAdmin)
      if (result === null) return { ok: false, eroare: 'unealtă necunoscută în executorul user-scoped' }
      // Verificăm dacă rezultatul conține o eroare
      const parsed = JSON.parse(result) as Record<string, unknown>
      if (parsed?.error) {
        // Normalizăm semnalele de „argument lipsă" ca interpreteazaProba
        // să le clasifice „nu_pot_verifica" (nu „stricat"):
        // no_query → empty_query, no_fragment → empty_fragment, etc.
        const er = String(parsed.error)
        const normalizata = er.replace(/^no_(query|fragment|request)$/, 'empty_$1')
        return { ok: false, eroare: normalizata }
      }
      return { ok: true, rezultat: result.slice(0, 200) }
    }

    // constructor_status — citire directă din DB
    if (name === 'constructor_status') {
      if (!isAdmin) return { ok: false, eroare: 'admin_only' }
      const jobs = await listBuildJobs(5)
      if (!jobs) return { ok: false, eroare: 'coada_necitibila — citirea din baza de date a picat' }
      return { ok: true, rezultat: `${jobs.length} joburi în coadă` }
    }

    // lista_tarife — citire din tarife.ts
    if (name === 'lista_tarife') {
      const meniu = meniulDeTarife()
      return { ok: true, rezultat: `${meniu.length} tarife configurate` }
    }

    // episoade_promo — citire din promoEpisoade.ts
    if (name === 'episoade_promo') {
      if (!isAdmin) return { ok: false, eroare: 'admin_only' }
      const episoade = await citesteEpisoade(email)
      return { ok: true, rezultat: `${episoade.length} episoade promo` }
    }

    // list_notes — citire din DB
    if (name === 'list_notes') {
      const notes = await listNotes(email)
      return { ok: true, rezultat: `${notes.length} notițe` }
    }

    return null
  } catch (err) {
    return { ok: false, eroare: String((err as Error)?.message ?? err).slice(0, 200) }
  }
}

/** Lista capabilităților care POT fi probate prin acest modul. */
export function capabilitatiProbeabileChat(): readonly string[] {
  return [...PROBA_DIRECTA]
}
