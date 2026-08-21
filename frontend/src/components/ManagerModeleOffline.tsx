import { useEffect, useRef, useState } from 'react'
import {
  MODELE_OFFLINE,
  getModelOffline,
  setModelOffline,
  modeleDescarcate,
  stareCreierLocal,
  pregatesteModelOffline,
  webgpuDisponibil,
  sincronizeazaStareOffline,
  stergeModelOffline,
} from '../lib/creierLocal'

// ── MANAGER MODELE OFFLINE (owner 21 aug: „vreau să pot seta EU modelul, inclusiv
// Gemma 2 sau plus, doar la offline… să le downloadez și să le pot încerca") ──────
// Owner-ul vede lista de modele offline (id-uri REALE WebLLM), descarcă ce vrea și
// comută modelul ACTIV. Alegerea e PE DEVICE (localStorage). Nimic online aici — doar
// creierul local. Țintă 2026+ (owner: „nu e criteriu telefoanele vechi"): 7B/9B sunt OK.

export function ManagerModeleOffline({ onClose }: { onClose: () => void }) {
  const [activ, setActiv] = useState(() => getModelOffline())
  const [descarcate, setDescarcate] = useState<string[]>(() => modeleDescarcate())
  const [st, setSt] = useState(() => stareCreierLocal())
  const [areWebgpu, setAreWebgpu] = useState<boolean | null>(null)
  const montat = useRef(true)

  useEffect(() => {
    montat.current = true
    let viu = true
    void webgpuDisponibil().then((ok) => viu && setAreWebgpu(ok))
    void sincronizeazaStareOffline().then(() => {
      if (viu) setSt(stareCreierLocal())
    })
    // Reîmprospătăm starea (progres descărcare, activ, descărcate) cât e deschis.
    const id = window.setInterval(() => {
      if (!viu) return
      setSt(stareCreierLocal())
      setActiv(getModelOffline())
      setDescarcate(modeleDescarcate())
    }, 600)
    return () => {
      viu = false
      montat.current = false
      window.clearInterval(id)
    }
  }, [])

  const seDescarca = st.stare === 'se_pregateste'
  const procent = Math.max(3, Math.round(st.progres * 100))

  // Descarcă + încarcă un model: îl facem activ, apoi îl pregătim. O singură descărcare
  // odată (butoanele celorlalte se blochează cât se descarcă unul).
  const descarca = (id: string): void => {
    setModelOffline(id)
    setActiv(id)
    setSt(stareCreierLocal())
    void pregatesteModelOffline().then(() => {
      if (!montat.current) return // panoul s-a închis între timp — nu atinge starea
      setSt(stareCreierLocal())
      setDescarcate(modeleDescarcate())
    })
  }
  // Comută modelul ACTIV pe unul deja descărcat (se încarcă la prima folosire offline).
  const foloseste = (id: string): void => {
    setModelOffline(id)
    setActiv(id)
    setSt(stareCreierLocal())
  }
  // Șterge un model descărcat (eliberează spațiul din cache). Owner: „să pot da jos
  // modelul care nu-mi place".
  const sterge = (id: string): void => {
    void stergeModelOffline(id).then(() => {
      if (!montat.current) return
      setActiv(getModelOffline())
      setDescarcate(modeleDescarcate())
      setSt(stareCreierLocal())
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modele offline"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100050,
        background: 'rgba(6,7,12,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(94vw, 460px)',
          maxHeight: '86vh',
          overflowY: 'auto',
          background: '#141024',
          color: '#e9e4ff',
          border: '1px solid #2a2440',
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          padding: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 15 }}>🧠 Model offline</strong>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            title="Închide"
            style={{ background: 'transparent', border: 'none', color: '#9a92c0', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#9a92c0' }}>
          Creierul care ține compania FĂRĂ net, rulat în browser (WebGPU). Descarcă modelele
          pe care vrei să le încerci și alege-l pe cel activ. Mai mare = mai deștept, dar se
          descarcă mai greu prima dată (o singură dată, apoi stă local).
        </p>

        {areWebgpu === false && (
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#ffcaca' }}>
            ⓘ Dispozitivul ăsta nu are WebGPU — creierul offline nu poate rula aici.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODELE_OFFLINE.map((m) => {
            const eActiv = m.id === activ
            const eDescarcat = descarcate.includes(m.id)
            const seDescarcaAcum = seDescarca && eActiv
            return (
              <div
                key={m.id}
                style={{
                  border: `1px solid ${eActiv ? '#6ea8fe' : '#2a2440'}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  background: eActiv ? 'rgba(110,168,254,0.08)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {m.nume} <span style={{ color: '#9a92c0', fontWeight: 600 }}>· {m.parametri}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#9a92c0', marginTop: 2 }}>
                      {eActiv
                        ? eDescarcat
                          ? '● activ'
                          : '● activ · nedescărcat'
                        : eDescarcat
                          ? '✓ descărcat'
                          : 'nedescărcat'}
                    </div>
                  </div>
                  <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {seDescarcaAcum ? (
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#cbbcff' }}>⏬ {procent}%</span>
                    ) : eActiv && eDescarcat ? (
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#6ea8fe' }}>activ</span>
                    ) : eDescarcat ? (
                      <button
                        type="button"
                        onClick={() => foloseste(m.id)}
                        disabled={seDescarca}
                        style={btnStil('#2a2440', '#e9e4ff', seDescarca)}
                      >
                        Folosește
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => descarca(m.id)}
                        disabled={seDescarca || areWebgpu === false}
                        style={btnStil('#6ea8fe', '#10121a', seDescarca || areWebgpu === false)}
                      >
                        ⏬ Descarcă
                      </button>
                    )}
                    {/* Șterge (dă jos modelul, eliberează spațiul) — doar dacă e descărcat
                        și nu se descarcă nimic acum. Merge și pe cel activ (mută activul). */}
                    {eDescarcat && !seDescarca && (
                      <button
                        type="button"
                        onClick={() => sterge(m.id)}
                        aria-label="Șterge modelul"
                        title="Șterge — eliberează spațiul"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#c98a8a',
                          fontSize: 15,
                          lineHeight: 1,
                          cursor: 'pointer',
                          padding: '0 2px',
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                {seDescarcaAcum && (
                  <div style={{ height: 3, marginTop: 8, background: '#2a2440', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${procent}%`, background: 'linear-gradient(90deg,#8b7cf0,#cbbcff)', transition: 'width .4s ease' }} />
                  </div>
                )}
                {eActiv && st.stare === 'eroare' && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: '#ffcaca' }}>
                    ⚠️ {st.motiv || 'a picat încărcarea'}{' '}
                    <button type="button" onClick={() => descarca(m.id)} style={{ ...btnStil('#2a2440', '#e9e4ff'), marginLeft: 6 }}>
                      Reîncearcă
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function btnStil(bg: string, fg: string, dezactivat = false): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: 'none',
    borderRadius: 7,
    padding: '5px 12px',
    fontSize: 12.5,
    fontWeight: 700,
    cursor: dezactivat ? 'default' : 'pointer',
    opacity: dezactivat ? 0.5 : 1,
  }
}
