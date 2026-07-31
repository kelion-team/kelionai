// Rezultat: patru furnizori DIFERIȚI (NVIDIA, Cohere, Novita, Google), ca o
// pană la unul să nu însemne pană la toți.
const MODEL_LADDER = [
  'cohere/north-mini-code:free', // agent de cod dedicat, alt furnizor, 96,79%
  'inclusionai/ling-3.0-flash:free', // Novita, cel mai bun uptime măsurat: 99,97%
  'google/gemma-4-31b-it:free', // Google AI Studio, 99,77% — plasă de final
].filter((m, i, a) => m && a.indexOf(m) === i)
// Modelul din env intră pe scară DOAR dacă nu e unul dovedit prost. Așa, o
// setare veche în kelionai.env nu mai poate readuce boala pe treapta întâi.
const MODELE_DOVEDIT_PROASTE = new Set([
  'poolside/laguna-m.1:free', // 95,43% uptime, 429 la fiecare pas (dovadă live)
  'nvidia/nemotron-nano-12b-v2-vl:free', // status -2 în catalog: degradat ACUM
  'nvidia/nemotron-3-super-120b-a12b:free', // returnează răspunsuri goale (200 fără mesaj) — dovadă live 31 iul
])