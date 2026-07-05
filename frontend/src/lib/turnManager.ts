// MANAGERUL DE TUR — inima vocii full-duplex a lui Kelion (decalaj 0).
// Mașină de stări PURĂ: primește EVENIMENTE (de la ASR-ul în streaming al
// serverului + de la redarea vocii) și produce EFECTE prin callback-uri:
//   • onStopVoice — BARGE-IN: taie vocea lui Kelion pe loc când vorbește Adrian,
//   • onUtterance — o frază finală → o trimit creierului,
//   • onState     — starea curentă (pentru UI/telemetrie).
// Fără DOM, fără Web Audio aici — doar logica, ca s-o pot testa separat, dur.
//
// De ce rezolvă cerințele:
//   1 barge-in instant: `speechBegin`/`partial` în timp ce Kelion vorbește → tai vocea.
//   2 fără tăiat la început: microfonul curge continuu (managerul nu-l poartă), deci
//     începutul frazei nu se pierde; finalul vine din endpointing-ul serverului.
//   7 AEC: vocea lui Kelion e scoasă din microfon de browser (echoCancellation),
//     iar fereastra de gardă evită ca onset-ul propriu să se taie singur (fals ecou).

export type TurnState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface TurnCallbacks {
  onState?: (s: TurnState) => void
  onStopVoice?: () => void // barge-in: taie vocea lui Kelion ACUM
  onUtterance?: (text: string) => void // frază finală → creier
  // TELEMETRIE: latența răspunsului = de la fraza finală a lui Adrian → prima
  // voce a lui Kelion (drum complet: creier + TTS + rețea). „Decalaj 0" cu cifre.
  onLatency?: (ms: number) => void
}

export interface TurnOptions {
  // ignoră un barge-in „gol" (doar speech_begin, fără cuvinte) atâta timp după ce
  // începe vocea lui Kelion — anti-ecou de onset. Textul real taie ORICÂND.
  bargeGuardMs?: number
  now?: () => number // injectabil pentru teste
}

export interface TurnManager {
  getState(): TurnState
  // evenimente de la ASR-ul în streaming:
  speechBegin(): void
  speechEnd(): void
  partial(text: string): void
  final(text: string): void
  // evenimente de la redarea vocii lui Kelion:
  voiceStarted(): void
  voiceEnded(): void
  reset(): void
}

export function createTurnManager(cb: TurnCallbacks = {}, opts: TurnOptions = {}): TurnManager {
  const guard = opts.bargeGuardMs ?? 250
  const now = opts.now ?? ((): number => Date.now())
  let state: TurnState = 'listening'
  let voiceAt = 0
  let lastFinalAt = 0 // când a terminat Adrian de vorbit (pornește cronometrul)

  const set = (s: TurnState): void => {
    if (s === state) return
    state = s
    cb.onState?.(s)
  }
  const bargeIn = (): void => {
    cb.onStopVoice?.()
    set('listening')
  }
  // fromText = declanșat de cuvinte reale (partial/final). Textul taie mereu;
  // un simplu speech_begin e ignorat în fereastra de gardă (posibil ecou onset).
  const maybeBarge = (fromText: boolean): void => {
    if (state !== 'speaking') return
    if (!fromText && now() - voiceAt < guard) return
    bargeIn()
  }

  return {
    getState: () => state,
    speechBegin() {
      maybeBarge(false)
    },
    speechEnd() {
      // endpointing e pe server; finalul frazei sosește prin final().
    },
    partial(text) {
      if (text.trim()) maybeBarge(true)
    },
    final(text) {
      maybeBarge(true) // dacă vorbea peste Kelion, tai întâi vocea
      const t = text.trim()
      if (t) {
        cb.onUtterance?.(t)
        lastFinalAt = now() // pornim cronometrul răspunsului
        set('thinking')
      }
    },
    voiceStarted() {
      if (lastFinalAt) {
        cb.onLatency?.(now() - lastFinalAt) // răspuns: final → prima voce
        lastFinalAt = 0
      }
      voiceAt = now()
      set('speaking')
    },
    voiceEnded() {
      if (state === 'speaking') set('listening')
    },
    reset() {
      set('listening')
    },
  }
}
