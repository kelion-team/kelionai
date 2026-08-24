import { Suspense, lazy, useEffect, useState } from 'react'
import { Languages } from 'lucide-react'
import ContactModal from '../components/ContactModal'
import VisitorChatWidget from '../components/VisitorChatWidget'
import { startGoogleLogin } from '../lib/api'
import { submissionSessionId } from '../lib/submissionSession'
import { raporteazaPagina } from '../lib/vizita'
import { strings, type Lang } from '../lib/i18n'
import { PUBLIC_TEXT as PT } from '../lib/publicText'
import { apiFetch } from '../lib/transport'
// Avatarul 3D — încărcat leneș (three.js scos din calea critică a landing-ului).
const LandingAvatar = lazy(() => import('../components/LandingAvatar'))

const ERR_KEY: Record<string, keyof ReturnType<typeof strings>> = {
  closed: 'errClosed',
  bad_state: 'errBadState',
  token_exchange: 'errTokenExchange',
  no_id_token: 'errNoIdToken',
  no_email: 'errNoEmail',
}

const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ro', label: 'Română' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
]

// The public start page: a professional hero with a LIVE 3D Kelion, plus the
// way in — Google sign-in (no free trial; users buy to try).
// AUTOMATICALLY multilingual: the UI follows the visitor's browser language
// (en/ro/es/fr/de/it/pt; anything else falls back to English). The conversation
// itself adapts to dozens of languages independently of the UI.
export default function Landing({ error }: { error?: string | null }) {
  // Language selector state — defaults to English, visitor can change
  const [lang, setLang] = useState<Lang>('en')
  const [langOpen, setLangOpen] = useState(false)
  const t = strings(lang)
  const [contactOpen, setContactOpen] = useState(false)
  // Error arriving via URL (e.g. ?error=closed). Shown once; doesn't change
  // after mount (there's no probe flow left to update it).
  const [notice] = useState<string | null>(
    error ? (t[ERR_KEY[error] ?? 'errGeneric'] as string) : null,
  )
  // Lead capture: a visitor leaves an email so the owner can reach them.
  const [leadEmail, setLeadEmail] = useState('')
  const [leadNote, setLeadNote] = useState('')
  const [leadBusy, setLeadBusy] = useState(false)
  const [leadSent, setLeadSent] = useState(false)

  async function submitLead(): Promise<void> {
    if (leadBusy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(leadEmail)) return
    setLeadBusy(true)
    const submissionSession = submissionSessionId()
    try {
      const r = await apiFetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: leadEmail, note: leadNote, submissionSession }),
      })
      if (r.ok) {
        setLeadSent(true)
        setLeadEmail('')
        setLeadNote('')
      }
    } catch {
      /* ignore */
    }
    setLeadBusy(false)
  }

  // Visit beacon: every arrival lands in the owner's analytics (server dedupes
  // 6h). Eticheta „acasă" hrănește raportul „ce au vizitat" (owner, 13 aug).
  useEffect(() => raporteazaPagina('acasă'), [])

  const currentLang = LANGUAGES.find((l) => l.code === lang)

  return (
    <div className="landing">
      {/* THE MANUAL, top-right (Adrian): anyone, without an account, can read
      everything the app does — picks their language and downloads it in that
      language. */}
      <div className="landing-top-bar">
        {/* Language selector — compact capsule with vertical dropdown */}
        <div className="lang-selector">
          <button
            type="button"
            className="lang-btn"
            onClick={() => setLangOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={langOpen}
          >
            <span className="lang-icon">🌐</span>
            <span className="lang-label">{currentLang?.label}</span>
            <span className="lang-arrow">{langOpen ? '▲' : '▼'}</span>
          </button>
          {langOpen && (
            <ul className="lang-dropdown" role="listbox">
              {LANGUAGES.map((l) => (
                <li
                  key={l.code}
                  role="option"
                  aria-selected={l.code === lang}
                  className={l.code === lang ? 'selected' : ''}
                  onClick={() => {
                    setLang(l.code)
                    setLangOpen(false)
                  }}
                >
                  {l.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <a className="landing-manual-btn" href="/manual">{PT.userManual}</a>
      </div>
      <div className="landing-hero">
        {/* Same proven framing as the in-app stage: camera at chest height looking
            AT the chest (target), so the head and torso fill the hero. */}
        {/* Avatarul 3D + AvatarLoading trăiesc în chunk-ul lazy LandingAvatar —
            three.js nu mai blochează prima vopsire a hero-ului. */}
        <Suspense fallback={null}>
          <LandingAvatar />
        </Suspense>
        <div className="landing-hero-fade" />
      </div>

      <div className="landing-panel">
        <div className="landing-content">
          <span className="brand-lg">Kelionai</span>
          <h1 className="landing-headline">{t.landingHeadline}</h1>
          <p className="landing-sub">{t.landingSub}</p>

          <div className="landing-multi">
            <Languages size={16} aria-hidden="true" />
            <span>{t.multilingual}</span>
          </div>

          {notice && <p className="error">{notice}</p>}

          <div className="landing-cta">
            <button type="button" className="google-btn cta-primary" onClick={startGoogleLogin}>
              <img src="/google-g-logo.svg" width="18" height="18" alt="" aria-hidden="true" />
              {t.signIn}
            </button>
            <div className="landing-alt-links">
              <a href="/login">{PT.emailSignIn}</a>
              <span aria-hidden>·</span>
              <a href="/credite">{PT.creditsPricing}</a>
            </div>
          </div>

          <div className="landing-lead">
            {leadSent ? (
              <p className="landing-lead-done">{PT.leadThanks}</p>
            ) : (
              <>
                <h3 className="landing-lead-title">{PT.leadTitle}</h3>
                <div className="landing-lead-row">
                  <input
                    className="landing-lead-input"
                    type="email"
                    placeholder={PT.emailPlaceholder}
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="landing-lead-btn"
                    onClick={() => void submitLead()}
                    disabled={leadBusy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(leadEmail)}
                  >
                    {leadBusy ? PT.leadSending : PT.leadSend}
                  </button>
                </div>
                <input
                  className="landing-lead-input landing-lead-note"
                  type="text"
                  placeholder={PT.leadNotePlaceholder}
                  value={leadNote}
                  onChange={(e) => setLeadNote(e.target.value)}
                />
              </>
            )}
          </div>

          <div className="landing-manual">
            <h3>{t.manualTitle}</h3>
            <ul>
              {t.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <p className="landing-legal">
            <button type="button" className="landing-contact-link" onClick={() => setContactOpen(true)}>
              {PT.contactLink}
            </button>{' '}
            · <a href="/privacy">{t.privacyLabel}</a> · <a href="/terms">{t.termsLabel}</a>
            <br />
            {t.cookieNote}
          </p>
        </div>
      </div>
      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
      <VisitorChatWidget />
    </div>
  )
}
