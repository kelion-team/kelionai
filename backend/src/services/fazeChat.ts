// ── TURA LUI KELION, PE FAZE (Adrian, 8 aug 2026) ──────────────────────────
//
// Ordinul lui, verbatim:
//
//   „chatul este doar chat, depistarea cerinței este depistarea cerinței,
//    decizia ce unealtă se face cu creierul, aplicarea și măsurarea
//    rezultatelor, deploy dacă e cazul"
//
//   „orice chat trebuie să fie default chat, fără să poarte nimic cu el, după
//    care urmează procedura prin creier de analiză și execuție"
//
// DE CE EXISTĂ FIȘIERUL ĂSTA. Până azi, o tură făcea toate astea DEODATĂ: și
// vorbea, și depista cerința, și alegea unealta, și executa, și raporta. De-aia
// căra la fiecare frază, măsurat:
//
//     prompt de sistem : ~3.900 tokeni (24 de blocuri, 17 necondiționate)
//     scheme de unelte : ~11.300 tokeni (până la 128)
//     ────────────────────────────────────────────────────────────────
//     ≈ 15.000 de tokeni ÎNAINTE ca omul să spună un cuvânt
//
// Se vede direct în cifre, din rularea lui de pe VPS: Gemini singur răspunde în
// 482 ms, dar tura aplicației a durat 1619 ms. Restul era citit degeaba. Și nu
// doar încetinea — dilua: decizia „mi se vorbește mie?" stătea îngropată la
// pagina 8 dintr-un regulament, printre 128 de scheme de unelte.
//
// Fazele NU sunt o schemă frumoasă pe hârtie. Fiecare are o intrare, o ieșire și
// un cost, iar costul se măsoară. O fază care nu e nevoie NU se plătește.

/** Fazele, în ordinea în care le-a numit ownerul. */
export type Faza = 'vorbire' | 'depistare' | 'decizie' | 'executie' | 'masurare' | 'publicare'

/** Ce știm despre tura care intră. Nimic din ce nu e aici nu influențează faza. */
export interface IntrareTura {
  /** Ce a scris omul. Gol pe o tură vocală — fraza e audio, nu text. */
  text: string
  /** Tura poartă vocea brută (creierul trebuie să decidă dacă i se vorbește). */
  areAudio: boolean
  /** Tura poartă o imagine (poză atașată sau cadru de cameră). */
  areImagine: boolean
  /** Textul cere o ACȚIUNE („repară", „publică", „scrie cod"…)? Verdictul vine
   *  din `hasActionIntent`, care e deja sursa unică pentru asta în aplicație. */
  cereActiune: boolean
  /** Creierul a cerut singur escaladarea (a chemat `ask_brain`) în tura asta. */
  aEscaladat?: boolean
}

/** Ce primește creierul pe faza asta. Cu cât mai puțin, cu atât mai repede și
 *  mai ascuțit — și fiecare adăugare trebuie să aibă un motiv scris. */
export interface Incarcatura {
  faza: Faza
  /** Uneltele care pleacă, pe nume. Lista goală = tura nu cară nimic. */
  unelte: string[]
  /** Blocurile grele de prompt (reparat cod, PR, runbook, clipuri) pleacă? */
  instructiuniDeLucru: boolean
  /** De ce faza asta și nu alta — scris, ca să se poată contesta. */
  motiv: string
}

// ── FAZA 1: VORBIREA ────────────────────────────────────────────────────────
// Chat curat. Nu cară unelte de lucru, nu cară regulamentul de reparat cod.
// Singura ușă spre restul e `ask_brain` — fără ea faza asta ar fi o cușcă, iar
// Kelion ar răspunde „nu pot" la lucruri pe care le poate face. Ușa NU e o
// unealtă de lucru: e chiar procedura pe care a cerut-o ownerul.
export const UNELTE_VORBIRE: readonly string[] = [
  'ask_brain', // ușa spre analiză și execuție
  'get_time',
  'get_weather',
  'web_search',
  'show_on_screen',
  'goleste_monitorul', // a goli ecranul e o comandă de conversație, nu de lucru
  'show_document',
  'open_app_view',
  'save_note',
  'list_notes',
  'list_memories',
  'memorie_ia',
  'cheama_agent',
  // „apelează-l pe X" e o comandă de CONVERSAȚIE (rapidă: rezolvă ținta + trimite
  // un mesaj pe WS), nu una scumpă — merge direct din vorbire, din chat sau voce.
  'apeleaza_user',
  // ── OBSERVABILITATEA DE ADMIN, MEREU DISPONIBILĂ (owner, 13 aug: „kelion e un
  //    admin secund cu toate drepturile… are obligația să țină TOT sub observație
  //    și să repare autonom"; „nu are toate drepturile de admin"). Uneltele
  //    READ-ONLY și IEFTINE — baza de date locală (~ms), fișierele (~ms), logurile
  //    din memorie (~ms) și vederea adminului (loopback local) — NU mai stau în
  //    spatele escaladării. Un admin secund trebuie să vadă DB/fișiere/loguri în
  //    ORICE tură, inclusiv într-o conversație, fără să ceară voie. Pe non-admin
  //    n-au NICIUN efect (nu-s în lista lor de unelte, deci filtrul nu le poate
  //    adăuga). Singura care rămâne AFARĂ e `system_health` (~8s: GitHub + sonde).
  'db_tables',
  'db_query',
  'server_logs',
  'list_source',
  'read_source',
  'search_source',
  'admin_vezi',
]

// ── CE NU ARE VOIE SĂ CALCE PE FAZA DE VORBIRE ─────────────────────────────
// Nu e o listă de gusturi. Fiecare de aici costă SECUNDE sau BANI pe drumul unei
// fraze:
//   system_health   → 2 apeluri la GitHub (timeout 10 s) + sondează endpointul
//                     fiecărui buton din Admin (timeout 8 s) ≈ 8 s în cel mai
//                     rău caz. SINGURA observabilitate care rămâne afară (e scumpă).
//   repo_*/build_*  → GitHub, PR-uri, construcții (SCRIU / cheltuie)
//   run_runbook     → declanșează workflow-uri pe VPS
//   jules_*         → rețea la Google (pornesc sarcini)
// Restul rămân disponibile prin `ask_brain`.
// NOTĂ (owner, 13 aug): db_query/db_tables/server_logs au IEȘIT de aici — sunt
// read-only și ieftine (DB locală, loguri din memorie), iar adminul secund trebuie
// să vadă baza de date și logurile în orice tură. Sunt acum în UNELTE_VORBIRE.
export const INTERZISE_LA_VORBIRE: readonly string[] = [
  'system_health',
  'stare_masurata',
  'constructor_status',
  'build_software',
  'repo_write',
  'repo_open_pr',
  'repo_merge_pr',
  'run_runbook',
  'runbook_status',
  'runbook_log',
  'jules_repos',
  'jules_task',
  'jules_status',
  'ruleaza_portile',
  'vaneaza_buguri',
]

/**
 * CE FAZĂ E TURA ASTA. Funcție PURĂ: aceleași intrări → același verdict,
 * probabilă fără rețea, fără model, fără bază de date.
 *
 * Regula, în ordinea în care se aplică:
 *   1. Creierul a cerut singur escaladarea → e fază de DECIZIE (are nevoie de
 *      tot inventarul ca să aleagă unealta).
 *   2. Omul cere o acțiune, sau tura poartă o imagine (vederea e lucru, nu
 *      vorbă) → DECIZIE.
 *   3. Orice altceva, INCLUSIV o frază rostită → VORBIRE.
 *
 * Punctul 3 e cel care contează și e cel mai ușor de greșit: o tură vocală pare
 * „specială", dar decizia „mi se vorbește mie?" e o judecată, nu o execuție.
 * Nu are nimic de făcut — deci nu are de ce să care unelte de făcut.
 */
export function fazaTurei(t: IntrareTura): Incarcatura {
  if (t.aEscaladat) {
    return {
      faza: 'decizie',
      unelte: [], // '' = tot inventarul; se completează de apelant
      instructiuniDeLucru: true,
      motiv: 'creierul a cerut singur escaladarea (ask_brain) — are nevoie de tot inventarul ca să aleagă',
    }
  }
  if (t.cereActiune) {
    return {
      faza: 'decizie',
      unelte: [],
      instructiuniDeLucru: true,
      motiv: 'textul cere o acțiune — de aici încolo e lucru, nu vorbă',
    }
  }
  if (t.areImagine) {
    return {
      faza: 'decizie',
      unelte: [],
      instructiuniDeLucru: true,
      motiv: 'tura poartă o imagine — vederea se folosește ca să FACĂ ceva, nu ca să povestească',
    }
  }
  return {
    faza: 'vorbire',
    unelte: [...UNELTE_VORBIRE],
    instructiuniDeLucru: false,
    motiv: t.areAudio
      ? 'frază rostită: creierul are de DECIS dacă i se vorbește, nu de executat — nu cară nimic'
      : 'conversație: chatul e doar chat',
  }
}

/** Are voie unealta asta pe faza de vorbire? Gardul de rulare, ca lista de mai
 *  sus să nu poată fi ocolită prin adăugare într-un alt loc. */
export function permisaLaVorbire(nume: string): boolean {
  if (INTERZISE_LA_VORBIRE.includes(nume)) return false
  return UNELTE_VORBIRE.includes(nume)
}
