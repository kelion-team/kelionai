// ── POARTA FAPTELOR (owner, 16 aug 05:53, verbatim: „acest soft e doar o
// minciuna, inventata ca face de tine... raspunde de ce") ────────────────────
// Dovada zilei, în captura lui de la 05:54 — creierul RECUNOAȘTE singur:
// „Nu am apelat nicio unealtă și am mințit afirmând că am generat clipul."
// A putut minți pentru că NIMIC nu-i lega vorbele de fapte.
//
// Aici se închide CLASA, nu instanța: pretențiile de FAPTĂ TRECUTĂ din
// răspunsul creierului se verifică pe MĂSURĂTOARE — jurnalul uneltelor chiar
// EXECUTATE în tura curentă. Pretenție fără faptă = demascată automat, pe
// ecran și în istoric, indiferent de model (legea adminului: „de neignorat
// pentru orice model ai e folosit").
//
// Funcție PURĂ: intră textul + lista uneltelor executate; ies pretențiile
// nedovedite, pe nume. Ținută STRÂMTĂ intenționat: doar fapte cu unealtă
// clară (generat/creat/trimis/urcat) — un fals-pozitiv ar face poarta să
// strige la adevăr, și atunci nimeni n-ar mai crede-o.

interface FamiliePretentie {
  /** Pretenția de faptă TRECUTĂ (nu intenție: „voi genera"/„pornesc" nu intră). */
  re: RegExp
  /** Uneltele care ar DOVEDI fapta — oricare din ele, executată, o acoperă. */
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
]

/** Pretențiile de faptă din text pe care jurnalul uneltelor NU le acoperă.
 *  Gol = totul dovedit (sau nicio pretenție). */
export function pretentiiFaraFapta(text: string, unelteExecutate: readonly string[]): string[] {
  const t = String(text ?? '')
  if (!t) return []
  const facute = new Set(unelteExecutate)
  const nedovedite: string[] = []
  for (const f of FAMILII) {
    if (f.re.test(t) && !f.unelte.some((u) => facute.has(u))) nedovedite.push(f.eticheta)
  }
  return nedovedite
}

/** Textul demascării — același peste tot (scris + istoric), ca proba să fie
 *  identică oriunde se citește. */
export function textulDemascarii(nedovedite: readonly string[]): string {
  return (
    `\n\n⚠ VERIFICAREA FAPTELOR (automată, pe jurnalul uneltelor turei): ` +
    `${nedovedite.join('; ')}. Pretenția de mai sus e FALSĂ — o retrag. ` +
    `Spune „fă-o" și execut pe bune, cu unealta.`
  )
}
