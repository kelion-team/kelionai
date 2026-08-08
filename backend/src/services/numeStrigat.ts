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
  // Potrivire pe CUVÂNT ÎNTREG: „chei" din „cheia de la mașină" nu e o strigare,
  // iar un `includes` simplu ar fi făcut din orice propoziție cu „chei" o
  // trezire. Un gard care se declanșează degeaba e tot un gard stricat.
  return cuvinte.some((c) => NUME.includes(c))
}
