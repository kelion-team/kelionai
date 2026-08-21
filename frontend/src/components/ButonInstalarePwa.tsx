import { useEffect, useState } from 'react'

// ── BUTON „INSTALEAZĂ APLICAȚIA" (Faza 1 offline-first, M1) ─────────────────
// Owner (21 aug, PROIECT-OFFLINE-FIRST §2): „intrarea = deschizi pagina web →
// download pe local → se instalează pe orice device". Ăsta e drumul UȘOR: un
// singur tap instalează PWA-ul ca aplicație de sine stătătoare — FĂRĂ să descarci
// un .exe/.apk (aia sunt codurile QR de lângă, pentru instalatorul nativ per
// platformă). Trăiește INLINE în secțiunea de instalare de pe Landing — NU e o
// bară fixă (o bară jos s-ar fi ciocnit cu FAB-ul de chat, watermark-ul de
// versiune și modalele paginii; lecția #3: un element fix refolosit rupe pagina).
//
// Onestitate (regula #1 — doar ce e măsurat, zero buton fals):
//  • Chrome/Edge/Android → primim evenimentul REAL `beforeinstallprompt` (prins
//    devreme în index.html, folosibil o singură dată) → butonul cheamă promptul
//    NATIV al browserului.
//  • iOS Safari (nu dă `beforeinstallprompt` — Apple nu-l implementează) → NU
//    arătăm buton mort; arătăm instrucțiunea reală (Partajează → „Adaugă pe ecran").
//  • deja instalat (display-mode: standalone / navigator.standalone) → nimic.
// Textul vine din afară (prop), ca să respecte limba aleasă de vizitator pe Landing.

interface PromptInstalare extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type FereastraInstal = typeof window & { __kelionDeferredInstall?: PromptInstalare | null }

function esteInstalatDeja(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {
    /* matchMedia indisponibil — cădem pe verificarea iOS de mai jos */
  }
  // iOS Safari: semnalul de „adăugat pe ecran" e navigator.standalone (nestandard).
  return (navigator as unknown as { standalone?: boolean }).standalone === true
}

function esteIos(): boolean {
  const ua = navigator.userAgent || ''
  const iDevice = /iphone|ipad|ipod/i.test(ua)
  // iPad pe iOS 13+ se dă drept „Mac" — îl prindem după touch pe platformă Mac.
  const iPadNou = /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1
  return iDevice || iPadNou
}

export function ButonInstalarePwa({
  invitatie,
  eticheta,
  hintIos,
}: {
  invitatie: string
  eticheta: string
  hintIos: string
}) {
  const [prompt, setPrompt] = useState<PromptInstalare | null>(
    () => (window as FereastraInstal).__kelionDeferredInstall ?? null,
  )
  const [instalat, setInstalat] = useState<boolean>(() => esteInstalatDeja())
  const ios = esteIos()

  useEffect(() => {
    const laInstalabil = (): void => setPrompt((window as FereastraInstal).__kelionDeferredInstall ?? null)
    const laInstalat = (): void => {
      setInstalat(true)
      setPrompt(null)
    }
    // Reconciliere O DATĂ la montare: dacă evenimentul a sosit în fereastra
    // dintre citirea inițială a stării și atașarea listenerului, nu-l pierdem.
    laInstalabil()
    window.addEventListener('kelion-installable', laInstalabil)
    window.addEventListener('kelion-installed', laInstalat)
    let mq: MediaQueryList | null = null
    const laStandalone = (e: MediaQueryListEvent): void => {
      if (e.matches) setInstalat(true)
    }
    try {
      mq = window.matchMedia('(display-mode: standalone)')
      mq.addEventListener('change', laStandalone)
    } catch {
      /* matchMedia indisponibil — rămânem pe evenimentele de mai sus */
    }
    return () => {
      window.removeEventListener('kelion-installable', laInstalabil)
      window.removeEventListener('kelion-installed', laInstalat)
      mq?.removeEventListener('change', laStandalone)
    }
  }, [])

  if (instalat) return null
  // Nimic de arătat: nici prompt nativ (Android/desktop), nici iOS Safari.
  if (!prompt && !ios) return null

  const instaleaza = (): void => {
    const p = prompt
    if (!p) return
    // Ascundem OPTIMIST + consumăm evenimentul ÎNAINTE de prompt: Chrome lasă
    // evenimentul folosit o SINGURĂ dată, iar un dublu-tap ar respinge al doilea
    // apel (promisiune neprinsă). Așa se cheamă exact o dată.
    setPrompt(null)
    ;(window as FereastraInstal).__kelionDeferredInstall = null
    void p.prompt().catch(() => {
      /* promptul nu a putut porni — un nou eveniment îl poate readuce */
    })
    void p.userChoice.catch(() => {
      /* alegerea a fost întreruptă — nimic de făcut */
    })
  }

  return (
    <div className="landing-instal">
      <span className="landing-instal-invit">{invitatie}</span>
      {prompt ? (
        <button type="button" className="landing-instal-btn" onClick={instaleaza}>
          ⤓ {eticheta}
        </button>
      ) : (
        // iOS Safari: fără prompt nativ — arătăm instrucțiunea reală, nu buton mort.
        <span className="landing-instal-hint">⤓ {hintIos}</span>
      )}
    </div>
  )
}
