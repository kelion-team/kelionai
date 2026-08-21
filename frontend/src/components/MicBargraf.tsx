import { useEffect, useRef, useState, type ReactElement } from 'react'

// ── BARGRAF DE INTRARE AL URECHII LIVE ───────────────────────────────────────
// Owner, 16 aug: „vreau sa vad un mic bargraf care arata nivelul de la intrarea
// urechi modelului live, trebuie indentificat daca nu se truncheaza nimic".
//
// Ce arată, MĂSURAT (nu presupus): nivelul REAL al microfonului pe fiecare cadru
// care pleacă spre model — calculat în lib/vocalLive.ts (RMS + vârf) exact în
// punctul de trimitere, și dat aici printr-un ref citit prin requestAnimationFrame
// (deci NU re-randează restul chatului). Trei stări vizibile:
//   • bare VERZI/portocalii = vocea intră la model (înălțimea = cât de tare);
//   • bare GRI + „mut" = poarta half-duplex TAIE trimiterea (model primește
//     tăcere cât vorbește Kelion) — asta e „truncherea" pe care o caută ownerul;
//   • vârf ROȘU = clip (semnalul atinge plafonul → distorsiune).
// Fără nicio clasă CSS partajată (doar stiluri inline) — ca să nu rupă alt layout.

export interface NivelIntrare {
  nivel: number // RMS 0..1 al cadrului trimis
  pic: number // vârf 0..1
  poarta: boolean // half-duplex taie trimiterea (tăcere la model)
  clip: boolean // vârful atinge plafonul (distorsiune)
}

const SEGMENTE = 16
// RMS-ul vorbirii normale stă jos (~0,02–0,2). Curba (sqrt × factor) umple bara la
// voce normală fără să sară la clip — ca ownerul să vadă mișcare, nu o bară moartă.
const laUmplere = (v: number): number => Math.min(1, Math.sqrt(Math.max(0, v)) * 2.4)

export default function MicBargraf({
  nivelRef,
  activ,
}: {
  nivelRef: { current: NivelIntrare }
  activ: boolean
}): ReactElement | null {
  const [n, setN] = useState<NivelIntrare>({ nivel: 0, pic: 0, poarta: false, clip: false })
  const rafRef = useRef(0)
  const netedRef = useRef(0) // atac rapid / cădere lentă, ca un VU-metru real (fără pâlpâit)

  useEffect(() => {
    if (!activ) {
      netedRef.current = 0
      setN({ nivel: 0, pic: 0, poarta: false, clip: false })
      return
    }
    const tick = (): void => {
      const cur = nivelRef.current
      netedRef.current = cur.nivel > netedRef.current ? cur.nivel : netedRef.current * 0.82 + cur.nivel * 0.18
      setN({ nivel: netedRef.current, pic: cur.pic, poarta: cur.poarta, clip: cur.clip })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [activ, nivelRef])

  if (!activ) return null

  const aprinse = Math.round(laUmplere(n.nivel) * SEGMENTE)
  const picSeg = Math.min(SEGMENTE - 1, Math.round(laUmplere(n.pic) * SEGMENTE) - 1)
  const culoare = (i: number): string => {
    if (n.poarta) return i < aprinse ? '#7a7f87' : '#2a2d33' // gri = trimiterea e tăiată (half-duplex)
    if (n.clip && i >= SEGMENTE - 2) return '#e5484d' // vârf în plafon = clip (roșu)
    if (i >= SEGMENTE - 3) return i < aprinse ? '#e5a34d' : '#33251a' // sus = portocaliu (tare)
    return i < aprinse ? '#31c46a' : '#1b2b20' // verde
  }
  const eticheta = n.poarta
    ? 'mut (Kelion vorbește)'
    : n.clip
      ? 'clip'
      : `${Math.round(n.nivel * 100)}%`
  const titlu = n.poarta
    ? 'half-duplex: microfonul e MUTAT cât vorbește Kelion — modelul primește tăcere (nu e o defecțiune, e anti-ecou)'
    : n.clip
      ? 'CLIP: vârful atinge plafonul (prea tare → distorsiune/tăiere)'
      : 'nivelul REAL de intrare în urechea modelului live (RMS)'

  return (
    <div
      title={titlu}
      aria-label={`nivel intrare ureche: ${eticheta}`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, lineHeight: 1, padding: '2px 4px', color: '#c9ccd1' }}
    >
      <span style={{ opacity: 0.85 }}>🎙</span>
      <span style={{ display: 'inline-flex', gap: 2, alignItems: 'flex-end', height: 16 }}>
        {Array.from({ length: SEGMENTE }, (_, i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: 5 + (i / SEGMENTE) * 11,
              background: culoare(i),
              borderRadius: 1,
              boxShadow: i === picSeg && !n.poarta && n.pic > 0.001 ? '0 0 0 1px rgba(255,255,255,0.55)' : 'none',
              transition: 'background 40ms linear',
            }}
          />
        ))}
      </span>
      <span style={{ minWidth: 34, opacity: 0.8, color: n.clip ? '#e5484d' : n.poarta ? '#9aa0a8' : '#c9ccd1' }}>{eticheta}</span>
    </div>
  )
}
