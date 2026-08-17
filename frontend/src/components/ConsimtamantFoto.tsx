import type { StareConsimtamant } from '../lib/consimtamant'

// ── POARTA DE CONSIMȚĂMÂNT FOTO (GDPR) — owner, 13 aug ───────────────────────
// „dacă nu acceptă captarea unei poze conform GDPR, nu li se permite accesul
// deloc; anunț pe pagina de pornire; acceptă → trece mai departe."
// Ecran BLOCANT, ca poarta de update: null = anunțul + accept/refuz; „refuzat" =
// ecran de refuz cu reconsiderare. Doar „acceptat" lasă aplicația să se afișeze.
// i18n auto-conținut (en bază + ro); alte limbi cad pe engleză.

const TEXTE: Record<
  string,
  {
    titlu: string
    mesaj: string
    accept: string
    refuz: string
    refuzatTitlu: string
    refuzatMesaj: string
    reconsidera: string
  }
> = {
  en: {
    titlu: 'Before you enter',
    mesaj:
      'To personalize your session, Kelion can capture a photo of your face (to recognize you), stored securely. Under GDPR we ask your consent first. Accept and you can use the app; refuse and access is not granted.',
    accept: 'I accept the photo capture',
    refuz: 'Refuse',
    refuzatTitlu: 'Access not granted',
    refuzatMesaj:
      'Without consent to the photo capture, the app cannot be used. You can reconsider anytime.',
    reconsidera: 'Reconsider',
  },
  ro: {
    titlu: 'Înainte să intri',
    mesaj:
      'Ca să-ți personalizeze sesiunea, Kelion poate capta o poză a feței tale (ca să te recunoască), păstrată în siguranță. Conform GDPR îți cerem întâi consimțământul. Accepți → poți folosi aplicația; refuzi → accesul nu e permis.',
    accept: 'Accept captarea pozei',
    refuz: 'Refuz',
    refuzatTitlu: 'Acces nepermis',
    refuzatMesaj:
      'Fără consimțământ pentru captarea pozei, aplicația nu poate fi folosită. Poți reconsidera oricând.',
    reconsidera: 'Reconsideră',
  },
}

function texte(lang: string): (typeof TEXTE)['en'] {
  return TEXTE[lang.slice(0, 2).toLowerCase()] ?? TEXTE.en
}

export function ConsimtamantFoto({
  stare,
  lang,
  onDecide,
}: {
  stare: StareConsimtamant
  lang: string
  onDecide: (v: 'acceptat' | 'refuzat') => void
}) {
  const t = texte(lang)
  if (stare === 'refuzat') {
    return (
      <div className="consimt-gate" role="alertdialog" aria-modal="true" aria-label={t.refuzatTitlu}>
        <div className="consimt-card">
          <span className="consimt-titlu">{t.refuzatTitlu}</span>
          <span className="consimt-mesaj">{t.refuzatMesaj}</span>
          <button type="button" className="consimt-btn consimt-accept" onClick={() => onDecide('acceptat')}>
            {t.reconsidera}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="consimt-gate" role="alertdialog" aria-modal="true" aria-label={t.titlu}>
      <div className="consimt-card">
        <span className="consimt-titlu">{t.titlu}</span>
        <span className="consimt-mesaj">{t.mesaj}</span>
        <div className="consimt-actiuni">
          <button type="button" className="consimt-btn consimt-accept" onClick={() => onDecide('acceptat')}>
            {t.accept}
          </button>
          <button type="button" className="consimt-btn consimt-refuz" onClick={() => onDecide('refuzat')}>
            {t.refuz}
          </button>
        </div>
      </div>
    </div>
  )
}
