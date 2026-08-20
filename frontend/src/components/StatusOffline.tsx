import { useEffect, useState } from 'react'
import { stareCreierLocal, pregatesteModelOffline, webgpuDisponibil } from '../lib/creierLocal'
import { uiStrings } from '../lib/i18n'

// ── STATUSUL CREIERULUI OFFLINE (mod companion) ─────────────────────────────
// Owner, 20 aug: „nu descarcă nimic pentru offline, e minciună gogonată" + „mă
// anunță că se descarcă? / că a terminat?". Până acum bara asta era MUTĂ pe cele mai
// multe stări (fără-WebGPU / eroare / nepornit → `return null`), așa că pe telefonul
// lui NU se vedea NIMIC: nici că se descarcă, nici DE CE nu se descarcă. Aici e urma
// VIZIBILĂ și CINSTITĂ (regula #1 — doar ce e măsurat):
//   • se descarcă → procentul REAL + bară;
//   • gata → o spune (8s, apoi se retrage);
//   • fără WebGPU → o spune pe față (dispozitivul chiar nu poate rula offline);
//   • eroare → arată motivul + „Reîncearcă";
//   • nepornit, dar se POATE → buton „Descarcă pentru offline" (control în mâna lui).
// Nu forțează nimic în fundal; doar arată starea și dă butonul.

type Dismis = boolean
const CHEIE_DISMIS = 'kelion_offline_bar_dismis'

export function StatusOffline() {
  const [st, setSt] = useState(() => stareCreierLocal())
  const [ascunsDupaGata, setAscunsDupaGata] = useState(false)
  // WebGPU măsurat O DATĂ la montare — ca să distingem cinstit „nepornit, dar se poate"
  // de „dispozitivul chiar nu are WebGPU", FĂRĂ să forțăm o descărcare ca să aflăm.
  const [areWebgpu, setAreWebgpu] = useState<boolean | null>(null)
  const [dismis, setDismis] = useState<Dismis>(() => {
    try {
      return sessionStorage.getItem(CHEIE_DISMIS) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const id = window.setInterval(() => setSt(stareCreierLocal()), 800)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let viu = true
    void webgpuDisponibil().then((ok) => {
      if (viu) setAreWebgpu(ok)
    })
    return () => {
      viu = false
    }
  }, [])

  // „Gata" se arată scurt (8s), apoi se ascunde — nu stă permanent pe ecran.
  useEffect(() => {
    if (st.stare !== 'gata') return
    const t = window.setTimeout(() => setAscunsDupaGata(true), 8000)
    return () => window.clearTimeout(t)
  }, [st.stare])

  const t = uiStrings()

  const inchide = (): void => {
    setDismis(true)
    try {
      sessionStorage.setItem(CHEIE_DISMIS, '1')
    } catch {
      /* storage indisponibil — se reia la refresh */
    }
  }
  const descarca = (): void => {
    setDismis(false)
    void pregatesteModelOffline()
    setSt(stareCreierLocal())
  }

  // Ce arătăm — decis din starea MĂSURATĂ, niciodată din presupunere.
  let text = ''
  let fill = -1 // -1 = fără bară de progres
  let actiune: { eticheta: string; onClick: () => void } | null = null
  let inchidere = false // arată X-ul de închidere?

  if (st.stare === 'se_pregateste') {
    fill = Math.max(3, Math.round(st.progres * 100))
    text = `⏬ ${t.offlinePregatire} ${fill}%`
  } else if (st.stare === 'gata') {
    if (ascunsDupaGata) return null
    fill = 100
    text = `✓ ${t.offlineGata}`
  } else if (st.stare === 'eroare') {
    if (dismis) return null
    text = `⚠️ ${st.motiv || t.offlineEroareLocal}`
    actiune = { eticheta: t.offlineReincearca, onClick: descarca }
    inchidere = true
  } else if (st.stare === 'fara_webgpu' || areWebgpu === false) {
    // Dispozitivul chiar nu poate rula creierul offline — o spunem pe față (măsurat).
    if (dismis) return null
    text = `ⓘ ${t.offlineFaraWebgpuScurt}`
    inchidere = true
  } else if (areWebgpu === true) {
    // Se POATE, dar încă nu s-a pornit — dăm butonul (nu forțăm gigabytes tăcut).
    if (dismis) return null
    text = ''
    actiune = { eticheta: `⏬ ${t.offlineDescarca}`, onClick: descarca }
    inchidere = true
  } else {
    // areWebgpu încă necunoscut (se măsoară) → nimic, ca să nu clipească.
    return null
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '5px 12px',
        fontSize: 12.5,
        fontWeight: 600,
        borderBottom: '1px solid #2a2440',
        boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ flex: '1 1 auto', textAlign: 'center', minWidth: 0 }}>
        {text && <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{text}</span>}
        {fill >= 0 && (
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
        )}
      </div>
      {actiune && (
        <button
          type="button"
          onClick={actiune.onClick}
          style={{
            flex: '0 0 auto',
            background: '#2a2440',
            color: '#e9e4ff',
            border: '1px solid #4a3f6e',
            borderRadius: 6,
            padding: '3px 10px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {actiune.eticheta}
        </button>
      )}
      {inchidere && (
        <button
          type="button"
          onClick={inchide}
          aria-label="×"
          title="×"
          style={{
            flex: '0 0 auto',
            background: 'transparent',
            color: '#9a92c0',
            border: 'none',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '0 2px',
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
