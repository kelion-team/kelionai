import { useEffect, useState } from 'react'
import { stareCreierLocal } from '../lib/creierLocal'
import { uiStrings } from '../lib/i18n'

// ── STATUSUL CREIERULUI OFFLINE (mod companion, faza 2+) ────────────────────
// Owner, 20 aug: „mă anunță că se descarcă?" — până acum NU: modelul (~2 GB) se
// descărca TĂCUT, fără nicio urmă pe ecran. Aici e urma VIZIBILĂ, MĂSURATĂ: cât se
// descarcă arată procentul REAL (din stareCreierLocal), iar când e gata o spune.
// Strat pur de afișaj; citește starea, nu forțează nimic.

export function StatusOffline() {
  const [st, setSt] = useState(() => stareCreierLocal())
  const [ascunsDupaGata, setAscunsDupaGata] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setSt(stareCreierLocal()), 800)
    return () => window.clearInterval(id)
  }, [])

  // „Gata" se arată scurt (8s), apoi se ascunde — nu stă permanent pe ecran.
  useEffect(() => {
    if (st.stare !== 'gata') return
    const t = window.setTimeout(() => setAscunsDupaGata(true), 8000)
    return () => window.clearTimeout(t)
  }, [st.stare])

  const t = uiStrings()
  let text = ''
  let fill = 0
  if (st.stare === 'se_pregateste') {
    fill = Math.max(3, Math.round(st.progres * 100))
    text = `⏬ ${t.offlinePregatire} ${fill}%`
  } else if (st.stare === 'gata' && !ascunsDupaGata) {
    fill = 100
    text = `✓ ${t.offlineGata}`
  } else {
    return null // neintrodus / fara_webgpu / eroare / gata-vechi → nimic
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100001,
        background: '#141024',
        color: '#e9e4ff',
        textAlign: 'center',
        padding: '5px 12px',
        fontSize: 12.5,
        fontWeight: 600,
        borderBottom: '1px solid #2a2440',
        boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
      }}
    >
      {text}
      <div style={{ height: 3, marginTop: 4, background: '#2a2440', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${fill}%`,
            background: 'linear-gradient(90deg,#8b7cf0,#cbbcff)',
            transition: 'width .5s ease',
          }}
        />
      </div>
    </div>
  )
}
