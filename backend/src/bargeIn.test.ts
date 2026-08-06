import { describe, expect, it } from 'vitest'

// Logică de detectare barge-in pe microfon mut (cât timp Kelion vorbește/joacă TTS).
// Gardă de onset = 300ms, Hold = 180ms, Prag RMS mut = 0.024.
export interface BargeInDetectorOpts {
  bargeGuardMs?: number
  bargeHoldMs?: number
  bargeRms?: number
  onBargeIn: () => void
  onSpeechBegin?: () => void
}

export class BargeInDetector {
  private muted = false
  private mutedSince = -1
  private bargeSince = 0
  private bargeGuardMs: number
  private bargeHoldMs: number
  private bargeRms: number
  private onBargeIn: () => void
  private onSpeechBegin?: () => void

  constructor(opts: BargeInDetectorOpts) {
    this.bargeGuardMs = opts.bargeGuardMs ?? 300
    this.bargeHoldMs = opts.bargeHoldMs ?? 180
    this.bargeRms = opts.bargeRms ?? 0.024
    this.onBargeIn = opts.onBargeIn
    this.onSpeechBegin = opts.onSpeechBegin
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (!m) {
      this.mutedSince = -1
      this.bargeSince = 0
    }
  }

  processFrame(rms: number, tNow: number): boolean {
    if (!this.muted) {
      this.mutedSince = -1
      this.bargeSince = 0
      return false
    }

    if (this.mutedSince === -1) this.mutedSince = tNow

    if (tNow - this.mutedSince > this.bargeGuardMs && rms > this.bargeRms) {
      if (this.bargeSince === 0) {
        this.bargeSince = tNow
      } else if (tNow - this.bargeSince >= this.bargeHoldMs) {
        this.bargeSince = 0
        this.onSpeechBegin?.()
        this.onBargeIn()
        return true
      }
    } else {
      this.bargeSince = 0
    }

    return false
  }
}

describe('BargeInDetector', () => {
  it('nu declanșează când microfonul nu este mut', () => {
    let triggered = false
    const detector = new BargeInDetector({ onBargeIn: () => { triggered = true } })
    detector.setMuted(false)
    detector.processFrame(0.05, 1000)
    expect(triggered).toBe(false)
  })

  it('nu declanșează în fereastra de gardă (bargeGuardMs)', () => {
    let triggered = false
    const detector = new BargeInDetector({ onBargeIn: () => { triggered = true } })
    detector.setMuted(true)
    // tNow = 100 (mutedSince setat la 100)
    detector.processFrame(0.05, 100)
    // tNow = 200 (trecute 100ms < 300ms gardă)
    detector.processFrame(0.05, 200)
    expect(triggered).toBe(false)
  })

  it('declanșează barge-in când semnalul depășește pragul după gardă și este susținut pe durata hold-ului', () => {
    let triggered = false
    let speechBegan = false
    const detector = new BargeInDetector({
      onBargeIn: () => { triggered = true },
      onSpeechBegin: () => { speechBegan = true },
    })
    detector.setMuted(true)
    detector.processFrame(0.01, 0) // t=0, mutedSince=0
    detector.processFrame(0.01, 350) // garda a trecut (350 > 300), dar RMS e mic (0.01 < 0.024)
    expect(triggered).toBe(false)

    detector.processFrame(0.03, 400) // t=400, RMS > 0.024, începe bargeSince (t=400)
    expect(triggered).toBe(false)

    detector.processFrame(0.03, 585) // t=585 (delta 185ms >= 180ms)
    expect(triggered).toBe(true)
    expect(speechBegan).toBe(true)
  })

  it('resetează starea când nivelul scade sub prag în timpul hold-ului', () => {
    let count = 0
    const detector = new BargeInDetector({ onBargeIn: () => { count++ } })
    detector.setMuted(true)
    detector.processFrame(0.01, 0)
    detector.processFrame(0.03, 400) // începe hold la t=400
    detector.processFrame(0.005, 450) // pauză / zgomot slab → reset bargeSince
    detector.processFrame(0.03, 500) // re-începe hold
    detector.processFrame(0.03, 600) // doar 100ms trecute de la 500
    expect(count).toEqual(0)
  })
})
