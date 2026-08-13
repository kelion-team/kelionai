// ── CONSIMȚĂMÂNTUL PENTRU CAPTAREA POZEI (GDPR) — poartă de intrare ──────────
// Owner, 13 aug: „la vizitatori umani, dacă nu acceptă să se poată capta o poză
// conform GDPR, nu li se permite accesul deloc pe aplicație — refuz total; se
// face anunț pe pagina de pornire; se acceptă → se trece mai departe."
//
// Cauza reală (mapare 13 aug): camera pornea DIN START după logare (ChatPanel),
// iar fața se salva în faceprints FĂRĂ niciun consimțământ — gaura GDPR. Poarta
// asta cere acceptul ÎNAINTE de orice acces; refuzul = ecran de refuz, fără app.
//
// Alegerea se ține local (per dispozitiv/browser), ca la orice banner de
// consimțământ: decizia utilizatorului, nu una impusă de server.

const KEY = 'kelion:consimtamant-foto'

export type StareConsimtamant = 'acceptat' | 'refuzat' | null

/** Ce a ales utilizatorul (sau `null` = încă n-a ales → i se arată poarta). */
export function citesteConsimtamant(): StareConsimtamant {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'acceptat' || v === 'refuzat' ? v : null
  } catch {
    return null
  }
}

/** Scrie alegerea. Idempotent, best-effort (dacă localStorage e blocat, poarta
 *  rămâne — mai bine să reapară decât să treacă fără consimțământ). */
export function scrieConsimtamant(v: 'acceptat' | 'refuzat'): void {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* ignore — poarta reapare la reîncărcare, ceea ce e partea sigură */
  }
}
