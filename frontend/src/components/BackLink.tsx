// ── ÎNTOARCEREA LA PAGINA ANTERIOARĂ ────────────────────────────────────────
//
// Adrian, 30 iul: „panourile trebuie să aibă buton de back în pagina anterioară".
// Până acum, ajuns pe /login sau /credite, singura ieșire era logo-ul (care duce
// mereu în pagina de start, nu de unde ai venit) sau butonul browserului — care
// pe aplicația instalată, în fereastră fără bară, nici nu există.
//
// O singură componentă pentru toate paginile (principiul permanent: unic, fără
// duplicate). Se întoarce EXACT de unde ai venit dacă există istoric în acest
// tab; altfel cade pe pagina de start, ca să nu ducă nicăieri.
import React from 'react'

export default function BackLink({
  label = 'Back',
  onBack,
}: {
  label?: string
  /** Panourile nu sunt pagini: „înapoi" înseamnă închide-mă și lasă-mă unde
   *  eram. Când e dat, el decide; altfel ne întoarcem în istoricul paginii. */
  onBack?: () => void
}): React.JSX.Element {
  const inapoi = (): void => {
    if (onBack) return onBack()
    // history.length > 1 = am ajuns aici dintr-o altă pagină din acest tab.
    // Deschis direct din link/marcaj → nu există „înapoi", mergem acasă.
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/'
  }
  return (
    <button type="button" className="back-link" onClick={inapoi} aria-label={label}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      <span>{label}</span>
    </button>
  )
}
