// ── MANUALUL, CA O CARTE ────────────────────────────────────────────────────
// Adrian: buton pe pagina de start → manualul complet; userul e ÎNTREBAT în ce
// limbă îl vrea, îl VEDE pe ecran în limba aleasă, îl poate DESCĂRCA în acea
// limbă și îl alege unde să-l salveze. Și: „când dai pe manual trebuie să fie ca
// o carte cu efect de dat pagina."
//
// Trei lucruri reparate aici, toate raportate de el:
//   • NU AVEA SCROLL — `body { overflow: hidden }` (shell-ul aplicației) tăia
//     pagina; conținutul creștea sub un corp care nu derulează.
//   • LIMBA NU SE SCHIMBA PE ECRAN — traducerea unei limbi noi dura peste 100 de
//     secunde, cererea rămânea agățată și pe ecran nu se întâmpla nimic. Acum
//     serverul răspunde INSTANT (engleză + `ready:false`) și traduce în fundal;
//     pagina reîntreabă și schimbă textul când e gata, cu semn vizibil între timp.
//   • DESCĂRCAREA — acum e un FIȘIER real, cu nume, pe care browserul îl salvează
//     unde alege userul; nu o filă nouă din care trebuie să te descurci singur.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import BackLink from '../components/BackLink'
// Cele 7 limbi ale manualului (aceeași listă ca pe server). Selectorul general
// de limbi rămâne pentru formularul de contact, unde nu costă nimic.
const MANUAL_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
  { code: 'ro', label: 'Română' },
]

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
  ready?: boolean
}

/** O „filă" a cărții: fie o secțiune de proză, fie un grup de funcții. */
type Fila =
  | { fel: 'coperta'; titlu: string; subtitlu: string; cuprins: string[] }
  | { fel: 'proza'; titlu: string; paragrafe: string[] }
  | { fel: 'intro'; titlu: string; text: string }
  | { fel: 'grup'; titlu: string; coloane: [string, string]; randuri: { what: string; say: string }[] }

/** Taie manualul în file. Grupurile mari se rup în mai multe file, ca să nu
 *  existe o pagină de trei ori mai lungă decât celelalte — o carte cu file
 *  inegale nu se citește, se derulează. */
function inFile(d: ManualDoc): Fila[] {
  const RANDURI_PE_FILA = 9
  // Coperta poartă și cuprinsul: altfel e titlu + subtitlu pe o filă întreagă,
  // adică trei sferturi de pagină goală.
  const cuprins = [...d.sections.map((s) => s.title), ...d.groups.map((g) => g.title)]
  const file: Fila[] = [{ fel: 'coperta', titlu: d.title, subtitlu: d.subtitle, cuprins }]
  for (const s of d.sections) file.push({ fel: 'proza', titlu: s.title, paragrafe: s.paragraphs })
  file.push({ fel: 'intro', titlu: d.abilitiesTitle, text: d.abilitiesIntro })
  for (const g of d.groups) {
    for (let i = 0; i < g.items.length; i += RANDURI_PE_FILA) {
      const bucata = g.items.slice(i, i + RANDURI_PE_FILA)
      const cont = i > 0 ? ' ·' : ''
      file.push({ fel: 'grup', titlu: g.title + cont, coloane: [d.columnWhat, d.columnSay], randuri: bucata })
    }
  }
  return file
}

export default function Manual(): React.JSX.Element {
  const dinUrl = new URLSearchParams(window.location.search).get('lang') ?? 'en'
  const [lang, setLang] = useState(dinUrl)
  const [doc, setDoc] = useState<ManualDoc | null>(null)
  const [traduce, setTraduce] = useState(false)
  const [fila, setFila] = useState(0)
  const [intoarce, setIntoarce] = useState<'' | 'inainte' | 'inapoi'>('')
  const [descarca, setDescarca] = useState(false)
  const timer = useRef<number | null>(null)

  // Aduce manualul; dacă limba încă se traduce, reîntreabă până e gata.
  useEffect(() => {
    let anulat = false
    const cere = (): void => {
      fetch(`/api/manual?lang=${encodeURIComponent(lang)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: ManualDoc | null) => {
          if (anulat || !j) return
          setDoc(j)
          const gata = j.ready !== false
          setTraduce(!gata)
          if (!gata) timer.current = window.setTimeout(cere, 4000)
        })
        .catch(() => {})
    }
    setFila(0)
    cere()
    return () => {
      anulat = true
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [lang])

  const file = doc ? inFile(doc) : []
  const ultima = Math.max(0, file.length - 1)

  const muta = useCallback(
    (delta: number) => {
      setFila((f) => {
        const n = Math.min(ultima, Math.max(0, f + delta))
        if (n !== f) setIntoarce(delta > 0 ? 'inainte' : 'inapoi')
        return n
      })
      window.setTimeout(() => setIntoarce(''), 460)
    },
    [ultima],
  )

  // Săgeți + spațiu: o carte se citește din tastatură, nu doar din mouse.
  useEffect(() => {
    const pe = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') muta(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') muta(-1)
    }
    window.addEventListener('keydown', pe)
    return () => window.removeEventListener('keydown', pe)
  }, [muta])

  /** Descărcare REALĂ: aduce manualul complet în limba aleasă (aici serverul
   *  chiar așteaptă traducerea) și-l dă browserului ca fișier cu nume, ca omul
   *  să aleagă unde îl pune. */
  const salveaza = async (): Promise<void> => {
    setDescarca(true)
    try {
      const r = await fetch(`/manual.html?lang=${encodeURIComponent(lang)}`)
      const html = await r.text()
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `Kelionai-manual-${lang}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      /* fără fereastră de eroare: butonul rămâne, userul poate reîncerca */
    } finally {
      setDescarca(false)
    }
  }

  const rtl = ['ar', 'he', 'fa', 'ur'].includes(doc?.lang ?? 'en')

  return (
    <div className="manual-page">
      <div className="manual-shell">
        <div className="manual-bar">
          <BackLink />
          <a className="login-brand" href="/">Kelionai</a>
          <div className="manual-actions">
            <label className="manual-lang">
              <span>Language</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {MANUAL_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="manual-dl" onClick={() => void salveaza()} disabled={descarca}>
              {descarca ? '…' : 'Download'}
            </button>
          </div>
        </div>

        {/* Semn onest cât se traduce: textul de pe ecran e încă în engleză. */}
        {traduce && (
          <div className="manual-translating" role="status">
            <span className="manual-spin" aria-hidden="true" />
            Translating… showing English until it is ready.
          </div>
        )}

        {!doc && <p className="chat-hint">…</p>}

        {doc && (
          <>
            <div className="manual-book" lang={doc.lang} dir={rtl ? 'rtl' : 'ltr'}>
              <div className={`manual-leaf ${intoarce ? `turn-${intoarce}` : ''}`} key={`${doc.lang}-${fila}`}>
                {file[fila]?.fel === 'coperta' && (
                  <div className="leaf-cover">
                    <h1>{(file[fila] as { titlu: string }).titlu}</h1>
                    <p>{(file[fila] as { subtitlu: string }).subtitlu}</p>
                    <div className="leaf-toc">
                      {[...new Set((file[fila] as { cuprins: string[] }).cuprins)].map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                    <p className="leaf-hint">← → turn the page</p>
                  </div>
                )}
                {file[fila]?.fel === 'proza' && (
                  <>
                    <h2>{(file[fila] as { titlu: string }).titlu}</h2>
                    {(file[fila] as { paragrafe: string[] }).paragrafe.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </>
                )}
                {file[fila]?.fel === 'intro' && (
                  <>
                    <h2>{(file[fila] as { titlu: string }).titlu}</h2>
                    <p>{(file[fila] as { text: string }).text}</p>
                  </>
                )}
                {file[fila]?.fel === 'grup' && (
                  <>
                    <h3>{(file[fila] as { titlu: string }).titlu}</h3>
                    <table className="manual-table">
                      <thead>
                        <tr>
                          <th>{(file[fila] as { coloane: [string, string] }).coloane[0]}</th>
                          <th>{(file[fila] as { coloane: [string, string] }).coloane[1]}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(file[fila] as { randuri: { what: string; say: string }[] }).randuri.map((it, i) => (
                          <tr key={i}>
                            <td>{it.what}</td>
                            <td className="manual-say">{it.say}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>

            <div className="manual-nav">
              <button type="button" onClick={() => muta(-1)} disabled={fila === 0} aria-label="Previous page">
                ‹
              </button>
              <span className="manual-pageno">
                {fila + 1} / {file.length}
              </span>
              <button type="button" onClick={() => muta(1)} disabled={fila === ultima} aria-label="Next page">
                ›
              </button>
            </div>
            <p className="manual-foot">{doc.footer}</p>
          </>
        )}
      </div>
    </div>
  )
}
