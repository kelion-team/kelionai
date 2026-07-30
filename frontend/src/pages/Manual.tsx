// ── MANUALUL DE UTILIZARE ───────────────────────────────────────────────────
// Adrian: buton pe pagina de start → manualul complet, în engleză, userul e
// ÎNTREBAT în ce limbă îl vrea, și îl poate DESCĂRCA în limba aleasă.
//
// Textul vine de la server (o sursă, engleză, tradusă la cerere), deci pagina
// asta nu ține niciun text de manual în ea — nici nu poate rămâne în urmă.
import React, { useEffect, useState } from 'react'
import BackLink from '../components/BackLink'
// Limbile din sursa comună — serverul traduce orice cod valid, lista e doar meniul.
import { LANG_OPTIONS } from '../lib/langList'

interface ManualDoc {
  lang: string
  title: string
  subtitle: string
  sections: { title: string; paragraphs: string[] }[]
  abilitiesTitle: string
  abilitiesIntro: string
  columnWhat: string
  columnSay: string
  groups: { title: string; items: { what: string; say: string }[] }[]
  footer: string
}


export default function Manual(): React.JSX.Element {
  const dinUrl = new URLSearchParams(window.location.search).get('lang') ?? 'en'
  const [lang, setLang] = useState(dinUrl)
  const [doc, setDoc] = useState<ManualDoc | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let anulat = false
    setBusy(true)
    fetch(`/api/manual?lang=${encodeURIComponent(lang)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ManualDoc | null) => {
        if (!anulat && j) setDoc(j)
      })
      .catch(() => {})
      .finally(() => {
        if (!anulat) setBusy(false)
      })
    return () => {
      anulat = true
    }
  }, [lang])

  return (
    <div className="manual-page">
      <div className="manual-card">
        <BackLink />
        <div className="manual-head">
          <a className="login-brand" href="/">Kelionai</a>
          <div className="manual-actions">
            {/* Întrebarea: în ce limbă îl vrei. Schimbarea se aplică pe loc. */}
            <label className="manual-lang">
              <span>Language</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANG_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            {/* Descărcarea respectă limba ALEASĂ, nu engleza. */}
            <a className="manual-dl" href={`/manual.html?lang=${encodeURIComponent(lang)}`} target="_blank" rel="noreferrer">
              Download
            </a>
          </div>
        </div>

        {busy && !doc && <p className="chat-hint">…</p>}
        {doc && (
          <article className="manual-body" lang={doc.lang} dir={['ar', 'he', 'fa', 'ur'].includes(doc.lang) ? 'rtl' : 'ltr'}>
            <h1>{doc.title}</h1>
            <p className="manual-sub">{doc.subtitle}</p>
            {doc.sections.map((s) => (
              <section key={s.title}>
                <h2>{s.title}</h2>
                {s.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </section>
            ))}
            <section>
              <h2>{doc.abilitiesTitle}</h2>
              <p>{doc.abilitiesIntro}</p>
            </section>
            {doc.groups.map((g) => (
              <section key={g.title}>
                <h3>{g.title}</h3>
                <table className="manual-table">
                  <thead>
                    <tr>
                      <th>{doc.columnWhat}</th>
                      <th>{doc.columnSay}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.what}</td>
                        <td className="manual-say">{it.say}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            <footer className="manual-foot">{doc.footer}</footer>
          </article>
        )}
      </div>
    </div>
  )
}
