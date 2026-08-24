// ── REGISTRUL VOCILOR LUI KELION — PENTRU ÎNREGISTRARE (8 aug 2026) ──────────
//
// Adrian: „trebuie, când se înregistrează, să se audă pe înregistrare vocea
// lui Kelion". Până acum vocea lui ajungea pe filmare DOAR dacă omul alegea
// tab/ecran ȘI bifa „Distribuie audio" în dialogul browserului — o bifă
// uitată = filmare fără Kelion. Dar vocea lui e redată chiar de pagina asta:
// nu depindem de o bifă. Fiecare gură (sesiunea Live sau TTS-ul
// chatului) își înscrie aici fluxul de ieșire, iar recorder.ts le amestecă
// DIRECT în pistă — vocea e pe filmare prin construcție, orice ar alege omul.
const fluxuri = new Set<MediaStream>()

/** Înscrie un flux cu vocea lui Kelion. Întoarce funcția de radiere. */
export function inscrieVoceaLuiKelion(s: MediaStream): () => void {
  fluxuri.add(s)
  return () => fluxuri.delete(s)
}

/** Fluxurile active acum — recorder.ts le ia la pornirea înregistrării. */
export function vocileLuiKelion(): MediaStream[] {
  return [...fluxuri]
}
