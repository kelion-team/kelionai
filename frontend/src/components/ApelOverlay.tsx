import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { strings, type Lang } from '../lib/i18n'
import { acceptaApel, refuzaApel, inchideApel } from '../lib/apel'

// ── MESSENGER KELION↔KELION — INTERFAȚA DE APEL (Adrian, 11 aug) ─────────────────
// Un singur strat global (prin portal în <body>, ca stratul de mașină) care:
//  • la un apel PRIMIT arată „X te sună" + Acceptă/Refuză;
//  • la un apel PORNIT de tine arată „Sun pe X…" apoi „Conectat cu X" + Închide.
// Merge la fel acasă și în mașină (un apel e comunicare audio, trece și la volan).
// Ascultă evenimentele `window` emise de lib/apel.ts (WS de prezență) și de
// ChatPanel (frame-ul {apel} de la creier). FAZA 1: sunat + accept/refuz +
// conectat + închide. FAZA 2 adaugă audio + traducere live peste același canal.

interface Persoana {
  email?: string
  name?: string
  nume?: string
}
interface Intra {
  callId: string
  from: Persoana
}
interface Ongoing {
  callId: string
  cu?: Persoana
  stare: 'suna' | 'conectat'
}

function numeDe(p: Persoana | undefined): string {
  return p?.nume || p?.name || p?.email || ''
}

export default function ApelOverlay({ lang }: { readonly lang: Lang }): React.ReactElement | null {
  const t = strings(lang)
  const [intra, setIntra] = useState<Intra | null>(null)
  const [apel, setApel] = useState<Ongoing | null>(null)

  useEffect(() => {
    const laIntra = (e: Event): void => {
      const d = (e as CustomEvent).detail as Intra
      if (d?.callId) setIntra(d)
    }
    const laStare = (e: Event): void => {
      const d = (e as CustomEvent).detail as { stare: string; callId?: string; cu?: Persoana }
      if (!d) return
      if (d.stare === 'suna') {
        setApel({ callId: d.callId ?? '', cu: d.cu, stare: 'suna' })
      } else if (d.stare === 'conectat') {
        setIntra(null) // dacă eu am acceptat, ecranul de „te sună" dispare
        setApel({ callId: d.callId ?? '', cu: d.cu, stare: 'conectat' })
      } else if (d.stare === 'refuzat' || d.stare === 'inchis') {
        // Închide orice apel/invitație cu acest id (sau tot, dacă nu vine id).
        setApel((a) => (!a || !d.callId || a.callId === d.callId ? null : a))
        setIntra((i) => (!i || !d.callId || i.callId === d.callId ? null : i))
      }
    }
    window.addEventListener('kelion:apel-intra', laIntra)
    window.addEventListener('kelion:apel-stare', laStare)
    return () => {
      window.removeEventListener('kelion:apel-intra', laIntra)
      window.removeEventListener('kelion:apel-stare', laStare)
    }
  }, [])

  if (!intra && !apel) return null

  // Apel PRIMIT are prioritate vizuală (trebuie să răspunzi).
  if (intra) {
    const nume = numeDe(intra.from)
    return createPortal(
      <div className="apel-overlay" role="dialog" aria-label={`${nume} ${t.apelSuna}`}>
        <div className="apel-card">
          <div className="apel-avatar" aria-hidden="true">
            {(nume[0] || '?').toUpperCase()}
          </div>
          <p className="apel-nume">{nume}</p>
          <p className="apel-sub">{t.apelSuna}</p>
          <div className="apel-actiuni">
            <button
              type="button"
              className="apel-btn refuza"
              onClick={() => {
                refuzaApel(intra.callId)
                setIntra(null)
              }}
            >
              {t.apelRefuza}
            </button>
            <button
              type="button"
              className="apel-btn accepta"
              onClick={() => acceptaApel(intra.callId)}
            >
              {t.apelAccepta}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  // Apel PORNIT de tine (sună / conectat).
  const nume = numeDe(apel?.cu)
  return createPortal(
    <div className="apel-overlay" role="dialog" aria-label={nume}>
      <div className="apel-card">
        <div className={`apel-avatar ${apel?.stare === 'conectat' ? 'live' : 'suna'}`} aria-hidden="true">
          {(nume[0] || '?').toUpperCase()}
        </div>
        <p className="apel-nume">{nume}</p>
        <p className="apel-sub">
          {apel?.stare === 'conectat' ? t.apelConectat : `${t.apelSunPe}…`}
        </p>
        {apel?.stare === 'conectat' && <p className="apel-nota">{t.apelNotaFaza2}</p>}
        <div className="apel-actiuni">
          <button
            type="button"
            className="apel-btn inchide"
            onClick={() => {
              if (apel?.callId) inchideApel(apel.callId)
              setApel(null)
            }}
          >
            {t.apelInchide}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
