// ── GARDUL DETERMINIST DE LIMBĂ PE RĂSPUNS (9 aug 2026) ──────────────────────
//
// Capturile ownerului („Dime, con…", „Dime, ¿qué…", la ore diferite, DUPĂ două
// rânduri de reguli în persona): instrucțiunile NU țin singure — urechea aude
// spaniolă în româna lui, iar gura răspunde în spaniolă. Revizia adversarială
// (29 de agenți) a confirmat: singurul gard pe ieșire era ADRESAREA, nu limba.
//
// Funcțiile de aici sunt PURE și DETERMINISTE — markeri ficși pe începutul
// frazei, nu judecata vreunui model. Ele NU decid conținut, decid un singur
// lucru: „răspunsul ăsta începe într-o limbă pe care omul n-a cerut-o" — iar
// ruta îl suprimă și îl taie, în loc să-l lase în difuzor.

/** Diacritice + cuvinte românești frecvente — dacă începutul e vizibil
 *  românesc, NU e străin, indiferent de restul. */
const SEMNE_RO = /[ăâîșțĂÂÎȘȚ]/
const CUVINTE_RO = new Set([
  'să', 'sa', 'și', 'si', 'ce', 'cum', 'da', 'nu', 'este', 'sunt', 'bine', 'bună', 'buna', 'salut',
  'pentru', 'care', 'acum', 'astăzi', 'astazi', 'mulțumesc', 'multumesc', 'sigur', 'desigur', 'iată', 'iata',
  'am', 'ai', 'poți', 'poti', 'vreau', 'trebuie', 'foarte', 'după', 'dupa', 'când', 'cand', 'unde',
])

/** Markerii altor limbi — DOAR pe primele cuvinte (începutul e al gurii, nu al
 *  citatelor). Liste scurte, cuvinte de DESCHIDERE tipice, nu dicționare. */
const SEMNE_ES = /[¿¡ñ]/
const START_ES = new Set(['dime', 'hola', 'claro', 'bueno', 'vale', 'qué', 'que', 'cómo', 'como', 'sí', 'gracias', 'entiendo', 'perfecto', 'muy', 'aquí', 'aqui', 'entonces', 'no', 'y', 'los', 'las', 'una', 'esto', 'necesito', 'puedo', 'tengo', 'para'])
const START_EN = new Set(['the', 'hello', 'hi', 'hey', 'sure', 'okay', 'ok', 'well', 'yes', 'i', "i'm", 'here', 'this', 'that', 'let', "let's", 'so', 'what', 'now'])
const START_DE = new Set(['der', 'die', 'das', 'ich', 'ja', 'nein', 'gut', 'hallo', 'also', 'und', 'hier', 'jetzt'])
const START_FR = new Set(['le', 'la', 'les', 'je', 'oui', 'non', 'bonjour', 'alors', 'voilà', 'voila', 'bien', 'ici'])

const primeleCuvinte = (text: string, n = 4): string[] =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[.,;:!?"“”„]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)

/**
 * Începutul ăsta e într-o limbă STRĂINĂ (nu română)? Întoarce numele limbii
 * detectate sau null. Determinist: aceleași litere → același verdict.
 * Prudent prin construcție: dacă începutul are SEMNE românești, e null —
 * mai bine o scăpare rară decât un Kelion român amuțit de gardul lui.
 */
export function inceputStrain(text: string): string | null {
  const brut = String(text ?? '').trim()
  if (!brut) return null
  if (SEMNE_RO.test(brut.slice(0, 60))) return null
  const cuvinte = primeleCuvinte(brut)
  if (!cuvinte.length) return null
  if (cuvinte.some((c) => CUVINTE_RO.has(c))) return null
  if (SEMNE_ES.test(brut.slice(0, 60)) || cuvinte.some((c) => START_ES.has(c))) return 'spaniolă'
  if (cuvinte.some((c) => START_EN.has(c))) return 'engleză'
  if (cuvinte.some((c) => START_DE.has(c))) return 'germană'
  if (cuvinte.some((c) => START_FR.has(c))) return 'franceză'
  return null
}

/** Omul chiar a CERUT altă limbă în fraza lui? („vorbește-mi în engleză",
 *  „speak english", „răspunde în spaniolă") — atunci gardul se dă la o parte. */
export function aCerutAltaLimba(spusa: string): boolean {
  const t = String(spusa ?? '').toLowerCase()
  if (!t) return false
  return (
    // fără \b: pe diacritice (î/ă) JS-ul le vede non-word și \b nu se mai
    // potrivește — „vorbește-mi în engleză" pica exact pe asta (test).
    /(vorbe[șs]te|r[ăa]spunde|zi|spune|explic[ăa])[^.!?]{0,24}(în|in)\s+(englez|spaniol|german|francez|italian|portughez)/.test(t) ||
    /speak\s+(in\s+)?(english|spanish|german|french|italian)/.test(t) ||
    /habla(me)?\s+(en\s+)?espa/.test(t)
  )
}
