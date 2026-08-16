// ── A FOST STRIGAT PE NUME? (Adrian, 8 aug 2026 — măsurat pe VPS-ul lui) ────
//
// Din jurnalul lui, de două ori la rând, pe două ture diferite:
//
//     [CHAT-IN] audio=da „"
//     [TIMP] tura …: creier=google-direct/gemini-3.5-flash-lite, total=1619ms
//     [VOCE] tura …: creierul a decis că NU i se vorbea — tăcere
//
// Adică: fraza AJUNGE la creier, creierul RĂSPUNDE în 1,6 secunde, și apoi
// hotărăște că nu lui i se vorbea. Omul vorbește și nu se întâmplă nimic.
//
// Pe 7 aug, poarta deterministă de nume a fost SCOASĂ de pe client — trezirea a
// devenit 100% judecata modelului pe audio brut. În AI-HANDOFF §13 s-a scris
// atunci, negru pe alb, riscul: „un fals <TAC/> poate înghiți tăcut o frază
// adresată; proba e testul ownerului". Testul lui l-a confirmat.
//
// Funcția asta NU repune poarta veche (nu decide ea trezirea — creierul rămâne
// cel care aude). Face un singur lucru, determinist: pe ce a spus CREIERUL că a
// auzit, se uită dacă numele a fost strigat. Dacă da, iar creierul a tăcut
// totuși, tăcerea aia e GREȘITĂ și trebuie NUMITĂ în jurnal — nu îngropată
// printre tăcerile corecte, unde arată identic cu zgomot de fond ignorat bine.
//
// E o funcție pură, deci se poate proba pe transcrieri reale, fără rețea și
// fără model.

/** Cum îl strigă lumea, inclusiv cum îl aude un microfon prin cameră. */
const NUME = [
  'kelion',
  'kelian',
  'kelien',
  'chelion',
  'celion',
  'kellion',
  'kaleon',
  'kaeleon',
  'kaleion',
  'keleion',
  'calion',
  'caleon',
  'kelionn',
  'kei',
  'chei',
  'key',
]

/** Câte cuvinte de la început se uită după nume. Numele strigat vine primul sau
 *  aproape primul („hei, Kelion", „ok Kelion, ..."); mai încolo într-o frază e
 *  vorbire DESPRE el, nu CĂTRE el — și aia chiar trebuie ignorată. */
const CUVINTE_CAP = 4

const fara_diacritice = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * A fost strigat pe nume, la începutul frazei?
 *
 * Se lucrează pe textul pe care CREIERUL a spus că l-a auzit — nu pe audio, nu
 * pe presupuneri. Fără text, răspunsul e `false`: „n-a spus ce-a auzit" NU
 * înseamnă „a fost strigat", și nici invers — aici nu inventăm nimic.
 */
export function numeStrigat(auzit: string): boolean {
  const t = fara_diacritice(String(auzit ?? '').trim())
  if (!t) return false
  const cuvinte = t.split(/[^a-z0-9]+/).filter(Boolean).slice(0, CUVINTE_CAP)
  // Exact pe listă SAU stâlcire ASR pe „kelion” (m?surat: Käleon→kaleon).
  // Fuzzy DOAR pe numele lung — ?kei/chei/key? r?m?n exact (altfel false+).
  return cuvinte.some(
    (c) => NUME.includes(c) || aproapeNumeLung(c, 'kelion') || aproapeNumeLung(c, 'kellion'),
  )
}

/** Potrivire moale doar pentru nume ≥5 litere (ASR: kaleon↔kelion, max 2 greșeli). */
function aproapeNumeLung(c: string, tinta: string): boolean {
  if (c === tinta) return true
  if (tinta.length < 5 || c.length < 4) return false
  if (Math.abs(c.length - tinta.length) > 2) return false
  // Hamming-ish pe aliniere simplă
  const n = Math.min(c.length, tinta.length)
  let diff = Math.abs(c.length - tinta.length)
  for (let i = 0; i < n; i++) if (c[i] !== tinta[i]) diff++
  return diff <= 2
}


// ── POARTA DETERMINISTĂ A SESIUNII LIVE (9 aug 2026) ────────────────────────
//
// Ownerul, a treia oară în aceeași zi: „kelion nu identifică când discuțiile
// ambientale sunt între alte persoane" — răspundea (și în spaniolă) la vorbire
// care nu-i era adresată. REGULA TREZIRII din instrucțiune (PR #926) e doar o
// rugăminte către model; modelul o mai calcă. Asta de aici e GARDUL: pe server,
// determinist, audio-ul lui Kelion pleacă spre difuzor DOAR dacă tura era
// adresată. Modelul poate vorbi cât vrea în gol — difuzorul tace.
//
// Contractul din 9 aug (validat atunci): numele la începutul frazei SAU
// conversație „în curs" (fereastră de 30s → 120s de la ultima lui vorbă).
//
// ── CONTRACTUL NOU — STRICT (owner, 15 aug, VERBATIM): „kelion trebuie sa
// raspunda doar cind aude numele, doar atunci" ───────────────────────────────
// „DOAR ATUNCI" revocă fereastra de dialog: fiecare enunț cere numele, altfel
// tăcere — vorbești cu altcineva în cameră/mașină, el tace; îl strigi, îți
// răspunde. Întrebarea „strict pe fiecare frază sau fereastră scurtă?" i-a
// fost pusă ownerului pe 15 aug, neblocant; fără alt răspuns, se implementează
// LITERA ordinului. Cine vrea fereastra înapoi o repune DOAR cu ordinul lui
// explicit — și atunci istoria de mai sus îi spune exact ce scoate.

/**
 * Tura userului era adresată lui Kelion? Funcție PURĂ — se probează pe
 * transcrieri, fără rețea. STRICT: doar numele decide (ordinul din 15 aug).
 *
 * @param transcript ce a spus omul în tura asta (transcrierea urechii)
 */
export function turaAdresata(transcript: string): boolean {
  return numeStrigat(transcript)
}
