// ── GESTIUNEA ENERGIEI (owner, 22 aug 2026: „consum minim de energie") ────────
//
// Centralizează detecția stării device-ului pentru a reduce consumul:
//   1. Ecran stins / tab în fundal → oprește verificările periodice
//   2. Baterie scăzută → oprește download-uri grele ale kitului offline
//   3. Device încărcat la priză → permite operații intensive
//   4. Pe baterie, dar >20% → verificări mai rare (60min nu 30min)
//
// Toate modulele senzoriale (vedere, auz, emoție) apelează
// `poateRula()` înainte de verificare — dacă e false, sar ciclul.
//
// API-uri folosite (toate standard, fără dependențe):
//   - document.visibilityState / visibilitychange — tab vizibil
//   - navigator.getBattery() — nivel baterie + stare încărcare (Chromium)
//   - navigator.scheduling?.isInputPending — nu există peste tot, best-effort

interface StareEnergie {
  ecranActiv: boolean // tab vizibil, nu în fundal
  baterieScăzută: boolean // < 20%
  baterieCritică: boolean // < 10%
  laPriză: boolean // încărcător conectat
  nivelBaterie: number | null // 0-1 (null = API indisponibil)
  ultimaCitire: number
}

let stare: StareEnergie = {
  ecranActiv: true,
  baterieScăzută: false,
  baterieCritică: false,
  laPriză: false,
  nivelBaterie: null,
  ultimaCitire: 0,
}

let initiat = false

/** Praguri de baterie — declarate pe linie (LEGEA ANTI-HARDCODARE: reglaj
 *  tehnic de energie, nu cifră arătată omului). */
const PRAG_SCĂZUT = 0.2 // hardcod-permis: prag tehnic baterie scăzută
const PRAG_CRITIC = 0.1 // hardcod-permis: prag tehnic baterie critică

/** Inițializează ascultătorii. Idempotent — poate fi apelat de mai multe module. */
export function initiazaGestiuneaEnergiei(): void {
  if (initiat) return
  initiat = true

  // 1. Vizibilitate tab
  if (typeof document !== 'undefined') {
    stare.ecranActiv = document.visibilityState === 'visible'
    document.addEventListener('visibilitychange', () => {
      stare.ecranActiv = document.visibilityState === 'visible'
      stare.ultimaCitire = Date.now()
    })
  }

  // 2. Baterie (Chromium-only — telefonul ownerului / APK)
  const nav = navigator as unknown as {
    getBattery?: () => Promise<{
      level: number
      charging: boolean
      addEventListener(t: string, cb: () => void): void
    }>
  }
  if (nav.getBattery) {
    nav.getBattery().then((b) => {
      citesteBaterie(b.level, b.charging)
      b.addEventListener('levelchange', () => citesteBaterie(b.level, b.charging))
      b.addEventListener('chargingchange', () => citesteBaterie(b.level, b.charging))
    }).catch(() => { /* API indisponibil — nu penalizăm */ })
  }
}

function citesteBaterie(level: number, charging: boolean): void {
  stare.nivelBaterie = level
  stare.laPriză = charging
  stare.baterieScăzută = !charging && level < PRAG_SCĂZUT
  stare.baterieCritică = !charging && level < PRAG_CRITIC
  stare.ultimaCitire = Date.now()
}

/** Poate rula o verificare periodică a senzorilor?
 *  - Ecran activ (tab vizibil)
 *  - Baterie nu e critică
 *  Pe baterie scăzută (nu critică), rulează dar mai rar. */
export function poateRulaVerificare(): boolean {
  return stare.ecranActiv && !stare.baterieCritică
}
