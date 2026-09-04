import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Un AudioContext fals, suficient pentru contractul modulului: stare, resume,
// close, ascultători de 'statechange'. Fiecare `new` incrementează contorul —
// exact ce numărăm: câte contexte se nasc.
type Stare = 'suspended' | 'running' | 'closed'
class AudioContextFals {
  static create = 0
  static stareInitiala: Stare = 'running'
  state: Stare
  private ascultatori = new Map<string, Set<() => void>>()
  constructor() {
    AudioContextFals.create++
    this.state = AudioContextFals.stareInitiala
  }
  addEventListener(tip: string, fn: () => void): void {
    if (!this.ascultatori.has(tip)) this.ascultatori.set(tip, new Set())
    this.ascultatori.get(tip)!.add(fn)
  }
  removeEventListener(tip: string, fn: () => void): void {
    this.ascultatori.get(tip)?.delete(fn)
  }
  private schimba(s: Stare): void {
    this.state = s
    for (const fn of this.ascultatori.get('statechange') ?? []) fn()
  }
  resume(): Promise<void> {
    if (this.state === 'suspended') this.schimba('running')
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.schimba('closed')
    return Promise.resolve()
  }
}

// `window` pentru deblocheazaAudioLaGest (mediul de test e node, fără DOM).
const ascultatoriWindow = new Map<string, Set<EventListener>>()
const windowFals = {
  addEventListener(tip: string, fn: EventListener): void {
    if (!ascultatoriWindow.has(tip)) ascultatoriWindow.set(tip, new Set())
    ascultatoriWindow.get(tip)!.add(fn)
  },
  removeEventListener(tip: string, fn: EventListener): void {
    ascultatoriWindow.get(tip)?.delete(fn)
  },
}
const totalAscultatoriWindow = (): number =>
  [...ascultatoriWindow.values()].reduce((n, s) => n + s.size, 0)

async function modul() {
  vi.resetModules()
  return import('./audioContextPartajat')
}

describe('audioContextPartajat', () => {
  beforeEach(() => {
    AudioContextFals.create = 0
    AudioContextFals.stareInitiala = 'running'
    ascultatoriWindow.clear()
    vi.stubGlobal('AudioContext', AudioContextFals)
    vi.stubGlobal('window', windowFals)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creează leneș un singur context și îl reutilizează', async () => {
    const m = await modul()
    expect(AudioContextFals.create).toBe(0)
    const a = m.obtineAudioContext()
    const b = m.obtineAudioContext()
    const c = m.obtineAudioContext()
    expect(a).not.toBeNull()
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(AudioContextFals.create).toBe(1)
  })

  it('după close re-creează un context nou, o singură dată', async () => {
    const m = await modul()
    const a = m.obtineAudioContext()
    // Închiderea vine din afara modulului — exact cum o face browserul sau un
    // consumator care termină; modulul trebuie s-o observe și să uite contextul.
    await a!.close()
    expect(a!.state).toBe('closed')
    const b = m.obtineAudioContext()
    expect(b).not.toBe(a)
    expect(b!.state).not.toBe('closed')
    expect(m.obtineAudioContext()).toBe(b)
    expect(AudioContextFals.create).toBe(2)
  })

  it('un context închis din afară (nu prin modul) e uitat și înlocuit', async () => {
    const m = await modul()
    const a = m.obtineAudioContext()
    await a!.close() // ex. browserul sau un consumator vechi
    const b = m.obtineAudioContext()
    expect(b).not.toBe(a)
    expect(AudioContextFals.create).toBe(2)
  })

  it('reia un context suspendat la cerere și armează deblocajul o singură dată', async () => {
    AudioContextFals.stareInitiala = 'suspended'
    // resume() nu prinde fără gest: îl facem inert ca să simulăm mobilul.
    const resumeOriginal = AudioContextFals.prototype.resume
    AudioContextFals.prototype.resume = function (): Promise<void> {
      return Promise.resolve()
    }
    try {
      const m = await modul()
      const a = m.obtineAudioContext()
      expect(a!.state).toBe('suspended')
      const armate = totalAscultatoriWindow()
      expect(armate).toBeGreaterThan(0)
      m.obtineAudioContext()
      m.obtineAudioContext()
      // Nicio armare suplimentară la apeluri repetate pe același context.
      expect(totalAscultatoriWindow()).toBe(armate)
    } finally {
      AudioContextFals.prototype.resume = resumeOriginal
    }
  })

  it('întoarce null când Web Audio lipsește sau constructorul aruncă (plafonul Chrome)', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const m1 = await modul()
    expect(m1.obtineAudioContext()).toBeNull()

    class ContextCarePica {
      constructor() {
        throw new DOMException('The number of hardware contexts provided (6) is greater than or equal to the maximum bound (6).', 'NotSupportedError')
      }
    }
    vi.stubGlobal('AudioContext', ContextCarePica)
    const m2 = await modul()
    expect(m2.obtineAudioContext()).toBeNull()
  })
})

describe('deblocheazaAudioLaGest — ascultătoarele nu se scurg', () => {
  beforeEach(() => {
    ascultatoriWindow.clear()
    vi.stubGlobal('window', windowFals)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('se retrag când contextul se închide fără să fi ajuns running', async () => {
    vi.resetModules()
    const { deblocheazaAudioLaGest } = await import('./audioGraph')
    AudioContextFals.stareInitiala = 'suspended'
    const ctx = new AudioContextFals()
    ctx.resume = () => Promise.resolve() // fără gest, nu pornește
    deblocheazaAudioLaGest(ctx as unknown as AudioContext)
    expect(totalAscultatoriWindow()).toBe(5)
    await ctx.close()
    expect(totalAscultatoriWindow()).toBe(0)
  })

  it('se retrag când contextul ajunge running', async () => {
    vi.resetModules()
    const { deblocheazaAudioLaGest } = await import('./audioGraph')
    AudioContextFals.stareInitiala = 'suspended'
    const ctx = new AudioContextFals()
    const resumeReal = ctx.resume.bind(ctx)
    let gest = false
    ctx.resume = () => (gest ? resumeReal() : Promise.resolve())
    deblocheazaAudioLaGest(ctx as unknown as AudioContext)
    expect(totalAscultatoriWindow()).toBe(5)
    gest = true
    for (const fn of [...(ascultatoriWindow.get('click') ?? [])]) fn(new Event('click'))
    expect(ctx.state).toBe('running')
    expect(totalAscultatoriWindow()).toBe(0)
  })

  it('nu armează nimic pe un context deja închis', async () => {
    vi.resetModules()
    const { deblocheazaAudioLaGest } = await import('./audioGraph')
    AudioContextFals.stareInitiala = 'closed'
    deblocheazaAudioLaGest(new AudioContextFals() as unknown as AudioContext)
    expect(totalAscultatoriWindow()).toBe(0)
  })
})
