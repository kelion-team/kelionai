// ── POARTA FAPTELOR (owner, 16 aug 05:53, verbatim: „acest soft e doar o
// minciuna, inventata ca face de tine... raspunde de ce") ────────────────────
// Dovada zilei, în captura lui de la 05:54 — creierul RECUNOAȘTE singur:
// „Nu am apelat nicio unealtă și am mințit afirmând că am generat clipul."
// A putut minți pentru că NIMIC nu-i lega vorbele de fapte.
//
// Aici se închide CLASA, nu instanța: pretențiile de FAPTĂ TRECUTĂ din
// răspunsul creierului se verifică pe MĂSURĂTOARE — jurnalul uneltelor chiar
// REUȘITE în tura curentă. O tentativă, un refuz sau o eroare nu sunt efecte.
// Pretenție fără faptă = demascată automat, pe
// ecran și în istoric, indiferent de model (legea adminului: „de neignorat
// pentru orice model ai e folosit").
//
// Funcție PURĂ: intră textul + lista uneltelor executate; ies pretențiile
// nedovedite, pe nume. Ținută STRÂMTĂ intenționat: doar fapte cu unealtă
// clară (generat/creat/trimis/urcat) — un fals-pozitiv ar face poarta să
// strige la adevăr, și atunci nimeni n-ar mai crede-o.

export type StareDovadaUnealta =
  | 'succeeded'
  | 'verified'
  | 'failed'
  | 'blocked'
  | 'awaiting_confirmation'
  | 'unverified'

/** Rezultatul normalizat al unei tentative de unealtă. Fiecare intrare implică
 *  o tentativă; numai `succeeded` și `verified` pot dovedi o faptă. */
export interface DovadaUnealta {
  nume: string
  stare: StareDovadaUnealta
  cod?: string
}

function obiectRezultat(text: string): Record<string, unknown> | null {
  const faraImagine = text.split('\u001F[OCHI]', 1)[0].trim()
  if (!faraImagine.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(faraImagine)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function textCamp(obiect: Record<string, unknown>, ...campuri: string[]): string {
  for (const camp of campuri) {
    const valoare = obiect[camp]
    if (typeof valoare === 'string' && valoare.trim()) return valoare.trim()
  }
  return ''
}

/** Interpretează rezultatul real, nu simplul apel. Contractele mai vechi nu au
 *  încă un câmp unic `status`, deci păstrăm suportul pentru semnalele existente
 *  (`error`, `succes`, `success`, `ok`, refuz/confirmare). */
export function clasificaRezultatUnealta(nume: string, rezultat: string): DovadaUnealta {
  const text = String(rezultat ?? '').trim()
  if (/^tool_error\s*:/i.test(text)) return { nume, stare: 'failed', cod: 'tool_error' }

  const obiect = obiectRezultat(text)
  if (!obiect) return { nume, stare: 'succeeded' }

  const stare = textCamp(obiect, 'status', 'state', 'outcome').toLowerCase()
  const cod = textCamp(obiect, 'error', 'code', 'reason', 'motiv', 'mesaj')
  const semnal = `${stare} ${cod}`.toLowerCase()
  const refuzExplicit =
    obiect.blocked === true ||
    obiect.denied === true ||
    obiect.refused === true ||
    /blocked|denied|refused|forbidden|unauthori[sz]ed|not_authorized|permission|refuz/i.test(semnal)
  if (refuzExplicit) return { nume, stare: 'blocked', cod: cod || stare }
  const cereConfirmare =
    obiect.awaiting_confirmation === true ||
    obiect.requires_confirmation === true ||
    obiect.needs_confirmation === true ||
    /awaiting[_ -]?confirmation|needs?[_ -]?confirmation|confirm/i.test(semnal)
  if (cereConfirmare) return { nume, stare: 'awaiting_confirmation', cod: cod || stare }

  const blocat =
    /consimțământ|consimtamant|credit|transcript_suspect/i.test(semnal)
  if (blocat) return { nume, stare: 'blocked', cod: cod || stare }

  const esuat =
    obiect.success === false ||
    obiect.succes === false ||
    obiect.ok === false ||
    Object.prototype.hasOwnProperty.call(obiect, 'error') ||
    /failed|failure|error|invalid|unavailable|not_connected|nu s-a putut/i.test(semnal)
  if (esuat) return { nume, stare: 'failed', cod: cod || stare }

  if (obiect.verified === true || stare === 'verified') return { nume, stare: 'verified' }
  if (obiect.verified === false || stare === 'unverified') return { nume, stare: 'unverified', cod: cod || stare }
  return { nume, stare: 'succeeded' }
}

export function unelteCuSucces(dovezi: readonly DovadaUnealta[]): string[] {
  return dovezi
    .filter((d) => d.stare === 'succeeded' || d.stare === 'verified')
    .map((d) => d.nume)
}

interface FamiliePretentie {
  /** Pretenția de faptă TRECUTĂ (nu intenție: „voi genera"/„pornesc" nu intră). */
  re: RegExp
  /** Uneltele care ar DOVEDI fapta — oricare din ele, reușită, o acoperă. */
  unelte: readonly string[]
  eticheta: string
}

// Granițele din jurul lui „am": fără litere/cratimă înainte („n-am generat"
// e negație, nu pretenție) — aceeași lecție de diacritice ca la ACTION_INTENT.
const FAMILII: readonly FamiliePretentie[] = [
  {
    re: /(?<![-\p{L}])am\s+(generat|creat|f[ăa]cut|produs)\b[^.!?\n]{0,80}\b(clip|video)/iu,
    unelte: ['generate_video'],
    eticheta: '„am generat clipul" — fără generate_video',
  },
  {
    re: /\b(clipul|video-?ul)\b[^.!?\n]{0,50}\b(e|este|a fost)\s+(gata|generat|creat|finalizat)/iu,
    unelte: ['generate_video'],
    eticheta: '„clipul e gata" — fără generate_video',
  },
  {
    re: /(?<![-\p{L}])am\s+(generat|creat|desenat|f[ăa]cut)\b[^.!?\n]{0,80}\b(imagine|imaginea|poz[ăa]|poza|logo)/iu,
    unelte: ['generate_image'],
    eticheta: '„am generat imaginea" — fără generate_image',
  },
  {
    re: /(?<![-\p{L}])am\s+trimis\b[^.!?\n]{0,60}\b(email|e-?mail)/iu,
    unelte: ['send_email'],
    eticheta: '„am trimis emailul" — fără send_email',
  },
  {
    re: /(?<![-\p{L}])am\s+(creat|f[ăa]cut)\b[^.!?\n]{0,60}\b(document\p{L}*|doc)\b/iu,
    unelte: ['create_doc'],
    eticheta: '„am creat documentul" — fără create_doc',
  },
  {
    re: /(?<![-\p{L}])am\s+(creat|f[ăa]cut)\b[^.!?\n]{0,60}\bprezentare/iu,
    unelte: ['create_presentation'],
    eticheta: '„am creat prezentarea" — fără create_presentation',
  },
  {
    re: /(?<![-\p{L}])am\s+(creat|f[ăa]cut)\b[^.!?\n]{0,60}\bformular/iu,
    unelte: ['create_form'],
    eticheta: '„am creat formularul" — fără create_form',
  },
  {
    re: /(?<![-\p{L}])am\s+(creat|f[ăa]cut)\b[^.!?\n]{0,60}\b(tabel|sheet)/iu,
    unelte: ['create_sheet'],
    eticheta: '„am creat tabelul" — fără create_sheet',
  },
  {
    re: /(?<![-\p{L}])am\s+urcat\b[^.!?\n]{0,60}\b(youtube|clipul)/iu,
    unelte: ['youtube_urca'],
    eticheta: '„am urcat pe YouTube" — fără youtube_urca',
  },
  // ÎNGHEȚUL DE 5 LUNI (owner, 16 aug 06:41, cu captura: „asa incremeneste,
  // nu face nimic mai departe... ai zis mincinos ca ai rezolvat"): fraza-ritual
  // „Am preluat cerința." poate fi SPUSĂ fără build_software — fără număr de
  // ordin, fără panou, fără lucrător. Preluarea nedovedită e minciună.
  {
    re: /(?<![-\p{L}])am\s+preluat\b[^.!?\n]{0,40}\b(cerin|ordin)/iu,
    unelte: ['build_software'],
    eticheta: '„am preluat cerința" — fără build_software (niciun ordin creat, nimic nu va mișca)',
  },
  // AUDITUL INVENTAT (owner, 16 aug 06:56, cu captura: „asta e dovada mea ca
  // ti-ai batut joc de mine" — un „audit al codului sursă" care numea modele
  // ce NU EXISTĂ nicăieri în repo: claude-3-5-sonnet, gpt-4o). Singura scanare
  // REALĂ a codului e poarta anti-hardcod rulată pe server (ruleaza_portile →
  // 'hardcodari') sau verdictul ei din jurnal (jurnal_masuratori). Un „audit"
  // povestit fără una din ele = inventat, se demască.
  {
    re: /((?<![-\p{L}])am\s+(scanat|auditat)|[îi]n\s+urma\s+(scan|audit)[ăa]?\p{L}*)\b[^.!?\n]{0,80}\b(cod|surs)/iu,
    unelte: ['ruleaza_portile', 'jurnal_masuratori'],
    eticheta: '„am scanat codul sursă" — fără ruleaza_portile/jurnal_masuratori: auditul e inventat',
  },
]

/** Pretențiile de faptă din text pe care rezultatele reușite NU le acoperă.
 *  Gol = totul dovedit (sau nicio pretenție). */
export function pretentiiFaraFapta(text: string, dovezi: readonly DovadaUnealta[]): string[] {
  const t = String(text ?? '')
  if (!t) return []
  const facute = new Set(unelteCuSucces(dovezi))
  const nedovedite: string[] = []
  for (const f of FAMILII) {
    if (f.re.test(t) && !f.unelte.some((u) => facute.has(u))) nedovedite.push(f.eticheta)
  }
  return nedovedite
}

/** ÎNGHEȚUL-PLAN (owner, 16 aug: „sa nu mai intepeneasca... sa ofere solutia
 *  pina la deploy masurabil"): pe o tură de EXECUȚIE cu ZERO rezultate reușite,
 *  un răspuns care anunță analiză/pași/plan e fix înghețul de 5 luni — vorbă
 *  care se oprește singură. Detectat mecanic, strâmt: doar ture de acțiune,
 *  doar zero unelte, doar limbaj de plan, doar răspuns consistent (nu un „da"
 *  scurt). */
export function planFaraExecutie(text: string, dovezi: readonly DovadaUnealta[], turaDeActiune: boolean): boolean {
  if (!turaDeActiune || unelteCuSucces(dovezi).length > 0) return false
  const t = String(text ?? '')
  if (t.trim().length < 80) return false
  return /\b(se analizeaz[ăa]|voi (investiga|verifica|analiza|repara)|pa[șs]ii (sunt|urm)|planul (este|e|meu)|urm[ăa]torii pa[șs]i|încep prin|incep prin)\b/iu.test(t)
}

export const TEXT_PLAN_FARA_EXECUTIE =
  `\n\n⚠ PLAN FĂRĂ EXECUȚIE (verificare automată): am anunțat pași, dar n-am obținut NICIUN rezultat reușit în tura asta — ` +
  `exact înghețul interzis de legea ducerii la capăt. Spune „fă-o" și pornesc execuția reală acum, sau numesc blocajul.`

/** Textul demascării — același peste tot (scris + istoric), ca proba să fie
 *  identică oriunde se citește. */
export function textulDemascarii(nedovedite: readonly string[]): string {
  return (
    `\n\n⚠ VERIFICAREA FAPTELOR (automată, pe jurnalul uneltelor turei): ` +
    `${nedovedite.join('; ')}. Pretenția de mai sus e FALSĂ — o retrag. ` +
    `Spune „fă-o" și execut pe bune, cu unealta.`
  )
}
