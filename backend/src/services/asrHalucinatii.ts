// ── HALUCINAȚIILE STT PE TĂCERE/ZGOMOT (Adrian, K8: „de unde apar cuvinte ca
// «Greț» — n-am scris nimic") ─────────────────────────────────────────────────
//
// Modelele de transcriere (Whisper/Gemini/Chirp) scot pe LINIȘTE sau zgomot
// fraze învățate din subtitrări — „Thanks for watching", „Subtitrare", „Greț",
// note muzicale. Poarta de energie de pe client (RMS + voiced-ms) taie mare parte,
// dar una tot scapă și devine o bulă-fantomă în chat. Aici filtrăm ieșirea:
// resping DOAR când transcriptul ÎNTREG e o astfel de frază (un mesaj real mai
// lung nu se atinge), plus cazul „doar simboluri/punctuație".
//
// Cuvinte reale scurte (Da / Nu / OK / Bine) NU sunt în listă — n-avem voie să
// tăiem un răspuns adevărat. Pur și determinist — testat în asrHalucinatii.test.ts.

// Formele NORMALIZATE (fără diacritice/punctuație, litere mici) ale halucinațiilor.
const HALUCINATII = new Set([
  'gret',
  'greata',
  'subtitrare',
  'subtitrari',
  'subtitrarea',
  'multumesc pentru vizionare',
  'multumesc ca ati urmarit',
  'va multumesc pentru vizionare',
  'aboneaza te',
  'abonati va',
  'like si abonare',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subtitles by',
  'bye bye',
  'music',
  'muzica',
])

function normaliz(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `true` = transcriptul e (întreg) o halucinație tipică de tăcere → de aruncat. */
export function esteHalucinatieASR(text: string): boolean {
  const raw = String(text ?? '').trim()
  if (!raw) return false
  // Doar simboluri/punctuație (♪, ..., —) fără nicio literă/cifră reală → fantomă.
  if (!/[a-z0-9à-ÿ]/i.test(raw)) return true
  const n = normaliz(raw)
  if (!n) return true
  return HALUCINATII.has(n)
}
