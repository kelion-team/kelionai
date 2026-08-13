// ── MANUALUL, CA O CARTE ────────────────────────────────────────────────────
// Adrian: button on the start page → the complete manual; the user is ASKED
// which language they want it in, SEES it on screen in the chosen language,
// can DOWNLOAD it in that language and chooses where to save it. And: "when you open the manual it must be like a
// a book with a page-turn effect."
//
// Trei lucruri reparate aici, toate raportate de el:
//   • IT HAD NO SCROLL — `body { overflow: hidden }` (the app shell) cut the
//     page; content grew under a body that doesn't scroll.
//   • THE LANGUAGE DIDN'T CHANGE ON SCREEN — translating a new language took over 100
//     seconds, the request hung and nothing happened on screen. Now
//     the server answers INSTANTLY (English + `ready:false`) and translates in the background;
//     the page re-asks and swaps the text when ready, with a visible sign meanwhile.
//   • THE DOWNLOAD — now it's a real FILE, with a name, that the browser saves
//     where the user chooses; not a new tab you have to figure out on your own.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import BackLink from '../components/BackLink'
import ManualIcon from '../components/ManualIcon'
import { raporteazaPagina } from '../lib/vizita'
// The manual's 7 languages (same list as on the server). The general
// language selector stays for the contact form, where it costs nothing.
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
  flow: { title: string; steps: { icon: string; label: string; note: string }[] }
  sections: { title: string; paragraphs: string[] }[]
  abilitiesTitle: string
  abilitiesIntro: string
  columnWhat: string
  columnSay: string
  groups: { title: string; key: string; items: { what: string; say: string }[] }[]
  footer: string
  ready?: boolean
}

/** A "leaf" of the book: either a prose section or a group of features. */
type Fila =
  | { fel: 'coperta'; titlu: string; subtitlu: string; cuprins: string[] }
  | { fel: 'proza'; titlu: string; paragrafe: string[] }
  | { fel: 'intro'; titlu: string; text: string }
  | { fel: 'flux'; titlu: string; pasi: { icon: string; label: string; note: string }[] }
  | { fel: 'grup'; titlu: string; cheie: string; coloane: [string, string]; randuri: { what: string; say: string }[] }

/** Cuts the manual into leaves. Large groups break into several leaves, so no
 *  page is three times longer than the others — a book with uneven leaves
 *  isn't read, it's scrolled. */
function inFile(d: ManualDoc): Fila[] {
  const RANDURI_PE_FILA = 9
  // The cover carries the table of contents too: otherwise it's title + subtitle on a whole leaf,
  // i.e. three quarters of an empty page.
  const cuprins = [...d.sections.map((s) => s.title), ...d.groups.map((g) => g.title)]
  const file: Fila[] = [{ fel: 'coperta', titlu: d.title, subtitlu: d.subtitle, cuprins }]
  // "How a request travels" comes right after the cover: it's the only leaf that
  // looks like a diagram, not text, and sets the tone for the rest of the book.
  file.push({ fel: 'flux', titlu: d.flow.title, pasi: d.flow.steps })
  for (const s of d.sections) file.push({ fel: 'proza', titlu: s.title, paragrafe: s.paragraphs })
  file.push({ fel: 'intro', titlu: d.abilitiesTitle, text: d.abilitiesIntro })
  for (const g of d.groups) {
    for (let i = 0; i < g.items.length; i += RANDURI_PE_FILA) {
      const bucata = g.items.slice(i, i + RANDURI_PE_FILA)
      const cont = i > 0 ? ' ·' : ''
      file.push({ fel: 'grup', titlu: g.title + cont, cheie: g.key, coloane: [d.columnWhat, d.columnSay], randuri: bucata })
    }
  }
  return file
}

/** Căutare fără diacritice: „cautare" găsește „căutare" și invers. */
function faraDiacritice(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Toate potrivirile unei interogări în filele cărții: fila + un fragment. */
function cautaInFile(file: Fila[], q: string): { idx: number; titlu: string; fragment: string }[] {
  const nq = faraDiacritice(q.trim())
  if (!nq) return []
  const out: { idx: number; titlu: string; fragment: string }[] = []
  file.forEach((f, idx) => {
    const texte: string[] =
      f.fel === 'coperta' ? [f.titlu, f.subtitlu, ...f.cuprins]
      : f.fel === 'proza' ? [f.titlu, ...f.paragrafe]
      : f.fel === 'intro' ? [f.titlu, f.text]
      : f.fel === 'flux' ? [f.titlu, ...f.pasi.flatMap((p) => [p.label, p.note])]
      : [f.titlu, ...f.randuri.flatMap((r) => [r.what, r.say])]
    for (const t of texte) {
      const poz = faraDiacritice(t).indexOf(nq)
      if (poz >= 0) {
        const start = Math.max(0, poz - 40)
        out.push({ idx, titlu: f.titlu, fragment: (start > 0 ? '…' : '') + t.slice(start, poz + nq.length + 60) })
        break // o potrivire pe filă ajunge în listă
      }
    }
  })
  return out
}

export default function Manual(): React.JSX.Element {
  const dinUrl = new URLSearchParams(window.location.search).get('lang') ?? 'en'
  const [lang, setLang] = useState(dinUrl)
  // CĂUTAREA ÎN MANUAL (10 aug, ownerul: „să se poată căuta în el cu search").
  const [cauta, setCauta] = useState('')
  const [doc, setDoc] = useState<ManualDoc | null>(null)
  const [traduce, setTraduce] = useState(false)
  const [fila, setFila] = useState(0)
  const [intoarce, setIntoarce] = useState<'' | 'inainte' | 'inapoi'>('')
  const [descarca, setDescarca] = useState(false)
  const timer = useRef<number | null>(null)

  // „ce au vizitat" (owner, 13 aug): secțiunea „manual" în raportul de vizite.
  useEffect(() => raporteazaPagina('manual'), [])

  // Fetches the manual; if the language is still translating, re-asks until ready.
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

  // Arrows + space: a book is read from the keyboard, not only the mouse.
  // NU și când omul TASTEAZĂ (10 aug — căutarea): un spațiu scris în câmpul de
  // search nu are voie să întoarcă pagina.
  useEffect(() => {
    const pe = (e: KeyboardEvent): void => {
      const tinta = e.target as HTMLElement | null
      if (tinta && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tinta.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') muta(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') muta(-1)
    }
    window.addEventListener('keydown', pe)
    return () => window.removeEventListener('keydown', pe)
  }, [muta])

  /** REAL download: fetches the complete manual in the chosen language (here
   *  the server really waits for the translation) and hands it to the browser
   *  as a named file, so the person chooses where to put it. */
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
      /* no error window: the button stays, the user can retry */
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
            {/* Search — sare direct la fila care conține textul căutat. */}
            <input
              type="search"
              value={cauta}
              onChange={(e) => setCauta(e.target.value)}
              placeholder="Search…"
              aria-label="Search the manual"
              style={{ maxWidth: 160 }}
            />
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

        {/* An honest sign while translating: the on-screen text is still in English. */}
        {traduce && (
          <div className="manual-translating" role="status">
            <span className="manual-spin" aria-hidden="true" />
            Translating… showing English until it is ready.
          </div>
        )}

        {!doc && <p className="chat-hint">…</p>}

        {/* REZULTATELE CĂUTĂRII (10 aug): cât timp e text în search, lista de
            potriviri ia locul cărții; click pe un rezultat = salt la fila lui. */}
        {doc && cauta.trim() && (
          <div className="manual-book" lang={doc.lang}>
            <div className="manual-leaf">
              {(() => {
                const rezultate = cautaInFile(file, cauta)
                if (rezultate.length === 0) return <p className="chat-hint">0 — no matches</p>
                return (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {rezultate.map((r) => (
                      <li key={r.idx}>
                        <button
                          type="button"
                          style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit' }}
                          onClick={() => { setFila(r.idx); setCauta('') }}
                        >
                          <strong>{r.titlu}</strong>
                          <br />
                          <span style={{ opacity: 0.75, fontSize: '0.9em' }}>{r.fragment}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
          </div>
        )}
        {doc && !cauta.trim() && (
          <>
            <div className="manual-book" lang={doc.lang} dir={rtl ? 'rtl' : 'ltr'}>
              <div className={`manual-leaf ${intoarce ? `turn-${intoarce}` : ''}`} key={`${doc.lang}-${fila}`}>
                {file[fila]?.fel === 'coperta' && (
                  <div className="leaf-cover">
                    <div className="leaf-crest" aria-hidden="true">K</div>
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
                {file[fila]?.fel === 'flux' && (
                  <>
                    <h2>{(file[fila] as { titlu: string }).titlu}</h2>
                    <ol className="manual-pasi">
                      {(file[fila] as { pasi: { icon: string; label: string; note: string }[] }).pasi.map((p, i) => (
                        <li key={i}>
                          <span className="manual-pas-ic" aria-hidden="true">
                            {p.icon}
                          </span>
                          <strong>{p.label}</strong>
                          <span className="manual-pas-nota">{p.note}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {file[fila]?.fel === 'grup' && (
                  <>
                    <h3 className="leaf-h3">
                      <ManualIcon k={(file[fila] as { cheie: string }).cheie} />
                      {(file[fila] as { titlu: string }).titlu}
                    </h3>
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
