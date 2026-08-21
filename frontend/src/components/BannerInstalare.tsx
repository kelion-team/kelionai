import { useEffect, useState } from 'react'
import { uiStrings } from '../lib/i18n'

// ── BANNER „INSTALEAZĂ" (Faza 1 offline-first, M1) ──────────────────────────
// Owner (21 aug, PROIECT-OFFLINE-FIRST §2): „intrarea = deschizi pagina web →
// download programul pe local → se instalează local pe orice device". Butonul
// ăsta e ușa: pe orice dispozitiv care poate instala PWA-ul (Android/desktop
// Chrome/Edge), un singur tap îl pune pe ecran ca aplicație de sine stătătoare —
// baza pe care Faza 1 rulează OFFLINE. NU e QR-ul de pe Landing (ăla e pentru
// scanat de pe ALT telefon); ăsta instalează CHIAR dispozitivul curent.
//
// Onestitate (regula #1 — doar ce e măsurat):
//  • Chrome/Edge/Android → primim evenimentul REAL `beforeinstallprompt`
//    (prins devreme în index.html, poate apărea înainte să monteze React) și
//    butonul cheamă promptul NATIV al browserului. Fără el, nu arătăm buton fals.
//  • iOS Safari NU dă `beforeinstallprompt` (Apple nu-l implementează) → nu
//    inventăm un buton care n-ar face nimic; arătăm instrucțiunea reală
//    (Partajează → „Adaugă pe ecranul principal”).
//  • Deja instalat (display-mode: standalone / navigator.standalone) → tăcem.
// Strat PUR de afișaj; nu atinge nimic din calea online/offline. Text multilingv.

interface PromptInstalare extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type FereastraInstal = typeof window & { __kelionDeferredInstall?: PromptInstalare | null }

const CHEIE_DISMIS = 'kelion_instal_bar_dismis'

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

export function BannerInstalare() {
  const [prompt, setPrompt] = useState<PromptInstalare | null>(
    () => (window as FereastraInstal).__kelionDeferredInstall ?? null,
  )
  const [instalat, setInstalat] = useState<boolean>(() => esteInstalatDeja())
  const [dismis, setDismis] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(CHEIE_DISMIS) === '1'
    } catch {
      return false
    }
  })
  const ios = esteIos()

  useEffect(() => {
    // Promptul poate sosi DUPĂ montare (Chrome îl emite când pagina devine
    // eligibilă) — index.html îl prinde în global și ne bate la ușă cu un event.
    const laInstalabil = (): void => setPrompt((window as FereastraInstal).__kelionDeferredInstall ?? null)
    const laInstalat = (): void => {
      setInstalat(true)
      setPrompt(null)
    }
    window.addEventListener('kelion-installable', laInstalabil)
    window.addEventListener('kelion-installed', laInstalat)
    // Când comută în standalone (după instalare), matchMedia ne anunță.
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

  if (instalat || dismis) return null
  // Nimic de arătat: nici prompt nativ (Android/desktop), nici iOS Safari.
  if (!prompt && !ios) return null

  const t = uiStrings()

  const inchide = (): void => {
    setDismis(true)
    try {
      sessionStorage.setItem(CHEIE_DISMIS, '1')
    } catch {
      /* storage indisponibil — se reia la refresh */
    }
  }

  const instaleaza = (): void => {
    if (!prompt) return
    void prompt.prompt()
    void prompt.userChoice
      .then((alegere) => {
        // Consumat: Chrome nu mai lasă același eveniment să fie folosit iar.
        ;(window as FereastraInstal).__kelionDeferredInstall = null
        setPrompt(null)
        if (alegere.outcome === 'accepted') setInstalat(true)
      })
      .catch(() => {
        /* promptul a fost întrerupt — lăsăm bara să reapară la următorul event */
      })
  }

  return (
    <div
      role="dialog"
      aria-label={t.instalDeviceButon}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100003,
        background: '#141024',
        color: '#e9e4ff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '8px 12px',
        fontSize: 13,
        fontWeight: 600,
        borderTop: '1px solid #2a2440',
        boxShadow: '0 -1px 8px rgba(0,0,0,0.4)',
      }}
    >
      <span
        style={{
          flex: '1 1 auto',
          textAlign: 'center',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        ⤓ {prompt ? t.instalDeviceInvitatie : `${t.instalDeviceInvitatie} ${t.instalDeviceIos}`}
      </span>
      {prompt && (
        <button
          type="button"
          onClick={instaleaza}
          style={{
            flex: '0 0 auto',
            background: 'linear-gradient(90deg,#8b7cf0,#cbbcff)',
            color: '#1a1030',
            border: 'none',
            borderRadius: 6,
            padding: '5px 14px',
            fontSize: 13,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {t.instalDeviceButon}
        </button>
      )}
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
    </div>
  )
}
