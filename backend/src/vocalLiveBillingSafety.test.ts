import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const wsMock = vi.hoisted(() => ({
  instances: [] as Array<{
    readyState: number
    sent: string[]
    terminated: boolean
    failSendTypes: Set<string>
    hangSendTypes: Set<string>
    emit(event: string, ...args: unknown[]): void
  }>,
}))

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1
    readyState = MockWebSocket.OPEN
    sent: string[] = []
    terminated = false
    failSendTypes = new Set<string>()
    hangSendTypes = new Set<string>()
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()

    constructor(_url: string, _options: unknown) {
      wsMock.instances.push(this)
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      const handlers = this.handlers.get(event) ?? []
      handlers.push(handler)
      this.handlers.set(event, handlers)
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }

    send(payload: string, callback?: (error?: Error) => void): void {
      this.sent.push(payload)
      if (!callback) return
      const type = String((JSON.parse(payload) as { type?: unknown }).type ?? '')
      if (this.hangSendTypes.has(type)) return
      queueMicrotask(() => callback(
        this.failSendTypes.has(type) ? new Error(`send failed: ${type}`) : undefined,
      ))
    }

    terminate(): void {
      this.terminated = true
      this.readyState = 3
    }

    close(): void {
      this.readyState = 3
    }
  }

  return { default: MockWebSocket }
})

process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime-test'
process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe'

const {
  creeazaControlRambursareVocalLive,
  debiteazaVocalLiveCuDeadline,
} = await import('./routes/vocalLive.js')
const { deschideVocalLive } = await import('./services/vocalLive.js')
const { config } = await import('./config.js')
// Testul transportului nu folosește rețeaua; îi deschidem numai gardul local
// pe care producția îl alimentează din secret store.
config.openai.key = 'test-key'

async function deschideSesiuneTest(
  errors: Array<{ motiv: string; code?: string }>,
  onUsage?: () => Promise<void> | void,
) {
  const live = deschideVocalLive('test', [], {
    onAudioIesire: () => undefined,
    onTranscriereUser: () => undefined,
    onTranscriereKelion: () => undefined,
    onUnealta: () => undefined,
    onUsage,
    onEroare: (motiv, code) => errors.push({ motiv, code }),
  })
  expect(live).not.toBeNull()
  const ws = wsMock.instances.at(-1)
  expect(ws).toBeDefined()
  ws!.emit('open')
  ws!.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
  await Promise.resolve()
  await Promise.resolve()
  return { live: live!, ws: ws! }
}

describe('siguranța debitării vocale', () => {
  it('ține audio, anunț, ancoră și răspunsul uneltei în coadă până la succes durabil', async () => {
    const errors: Array<{ motiv: string; code?: string }> = []
    const { live, ws } = await deschideSesiuneTest(errors)
    await vi.waitFor(() => expect(ws.sent.some((raw) => JSON.parse(raw).type === 'session.update')).toBe(true))
    const sentBeforeDebit = ws.sent.length
    let confirmaDebit!: (ok: boolean) => void
    let confirmaRezervarea!: (ok: boolean) => void
    let confirmaAck!: (ok: boolean) => void
    const debit = new Promise<boolean>((resolve) => { confirmaDebit = resolve })
    const reservation = new Promise<boolean>((resolve) => { confirmaRezervarea = resolve })
    const ack = new Promise<boolean>((resolve) => { confirmaAck = resolve })
    const debiteaza = vi.fn(() => debit)
    const rezerva = vi.fn(() => reservation)
    const acknowledge = vi.fn(() => ack)

    const asteptareDebit = live.asteaptaDebit(debiteaza, rezerva, acknowledge)
    await Promise.resolve()
    await Promise.resolve()
    expect(debiteaza).not.toHaveBeenCalled()

    live.scrieAudio(Buffer.alloc(320, 1))
    live.anunta('anunț')
    live.ancoreaza('ancoră')
    live.raspundeUnealta('call-1', 'test', { ok: true })

    expect(ws.sent.slice(sentBeforeDebit).map((raw) => JSON.parse(raw).type)).toEqual(['response.cancel'])
    await vi.waitFor(() => expect(debiteaza).toHaveBeenCalledTimes(1))
    confirmaDebit(true)
    await vi.waitFor(() => expect(rezerva).toHaveBeenCalledTimes(1))
    expect(ws.sent.slice(sentBeforeDebit).map((raw) => JSON.parse(raw).type)).toEqual(['response.cancel'])
    confirmaRezervarea(true)
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1))
    expect(ws.sent.slice(sentBeforeDebit).map((raw) => JSON.parse(raw).type)).toEqual([
      'response.cancel',
      'input_audio_buffer.append',
      'conversation.item.create',
      'response.create',
      'conversation.item.create',
      'conversation.item.create',
      'response.create',
    ])
    confirmaAck(true)
    await ack
    await expect(asteptareDebit).resolves.toBe(true)
    expect(errors).toEqual([])
    live.inchide()
  })

  it('închide terminal la debit blocat și nu varsă coada după timeout', async () => {
    vi.useFakeTimers()
    try {
      const errors: Array<{ motiv: string; code?: string }> = []
      const { live, ws } = await deschideSesiuneTest(errors)
      await Promise.resolve()
      await Promise.resolve()
      const sentBeforeDebit = ws.sent.length
      live.asteaptaDebit(
        () => debiteazaVocalLiveCuDeadline(
          () => new Promise<boolean>(() => undefined),
          25,
        ),
        async () => true,
        async () => true,
      )
      live.scrieAudio(Buffer.alloc(320, 1))
      live.anunta('nu trebuie trimis')
      live.raspundeUnealta('call-timeout', 'test', { ok: true })
      expect(ws.sent.slice(sentBeforeDebit).map((raw) => JSON.parse(raw).type)).toEqual(['response.cancel'])

      await vi.advanceTimersByTimeAsync(25)
      await Promise.resolve()
      expect(ws.terminated).toBe(true)
      expect(errors).toEqual([{ motiv: 'voice_billing_unavailable', code: 'billing_unavailable' }])
      expect(ws.sent.slice(sentBeforeDebit).map((raw) => JSON.parse(raw).type)).toEqual([
        'response.cancel',
        'response.cancel',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ține intrarea pre-ready în poarta inițială și închide fără flush dacă rezervarea eșuează', async () => {
    const errors: Array<{ motiv: string; code?: string }> = []
    let resolveReserve!: (ok: boolean) => void
    const reservation = new Promise<boolean>((resolve) => { resolveReserve = resolve })
    const reserve = vi.fn(() => reservation)
    const acknowledge = vi.fn(async () => true)
    const live = deschideVocalLive('test', [], {
      onGata: () => ({ rezervaConsum: reserve, confirmaDupaTrimitere: acknowledge }),
      onAudioIesire: () => undefined,
      onTranscriereUser: () => undefined,
      onTranscriereKelion: () => undefined,
      onUnealta: () => undefined,
      onEroare: (motiv, code) => errors.push({ motiv, code }),
    })
    expect(live).not.toBeNull()
    const ws = wsMock.instances.at(-1)!
    ws.emit('open')
    live!.scrieAudio(Buffer.alloc(320, 1))
    live!.anunta('pre-ready')
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))

    await vi.waitFor(() => expect(reserve).toHaveBeenCalledTimes(1))
    expect(ws.sent.map((raw) => JSON.parse(raw).type)).toEqual(['session.update'])
    resolveReserve(false)
    await vi.waitFor(() => expect(ws.terminated).toBe(true))
    expect(acknowledge).not.toHaveBeenCalled()
    expect(ws.sent.map((raw) => JSON.parse(raw).type)).toEqual(['session.update', 'response.cancel'])
    expect(errors).toEqual([{ motiv: 'voice_billing_consume_unavailable', code: 'billing_unavailable' }])
  })

  it('anulează și termină dacă ACK-ul post-send rămâne blocat', async () => {
    vi.useFakeTimers()
    try {
      const errors: Array<{ motiv: string; code?: string }> = []
      const { live, ws } = await deschideSesiuneTest(errors)
      const before = ws.sent.length
      live.asteaptaDebit(
        async () => true,
        async () => true,
        () => new Promise<boolean>(() => undefined),
      )
      live.anunta('trimite apoi cere ACK')
      await vi.advanceTimersByTimeAsync(0)
      expect(ws.sent.slice(before).map((raw) => JSON.parse(raw).type)).toEqual([
        'response.cancel',
        'conversation.item.create',
        'response.create',
      ])

      await vi.advanceTimersByTimeAsync(5_500)
      expect(ws.terminated).toBe(true)
      expect(ws.sent.slice(before).map((raw) => JSON.parse(raw).type).at(-1)).toBe('response.cancel')
      expect(errors).toEqual([{ motiv: 'voice_billing_ack_unavailable', code: 'billing_unavailable' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('nu confirmă debitul dacă scrierea provider-bound eșuează asincron', async () => {
    const errors: Array<{ motiv: string; code?: string }> = []
    const { live, ws } = await deschideSesiuneTest(errors)
    const acknowledge = vi.fn(async () => true)
    ws.failSendTypes.add('conversation.item.create')

    const debit = live.asteaptaDebit(
      async () => true,
      async () => true,
      acknowledge,
    )
    live.anunta('nu confirma o trimitere eșuată')

    await vi.waitFor(() => expect(ws.terminated).toBe(true))
    await expect(debit).resolves.toBe(false)
    expect(acknowledge).not.toHaveBeenCalled()
    expect(errors).toEqual([{ motiv: 'openai_realtime_socket_error', code: 'transport' }])
  })

  it('nu confirmă debitul dacă scrierea provider-bound depășește deadline-ul', async () => {
    vi.useFakeTimers()
    try {
      const errors: Array<{ motiv: string; code?: string }> = []
      const { live, ws } = await deschideSesiuneTest(errors)
      const acknowledge = vi.fn(async () => true)
      ws.hangSendTypes.add('conversation.item.create')

      const debit = live.asteaptaDebit(
        async () => true,
        async () => true,
        acknowledge,
      )
      live.anunta('trimitere blocată')
      await vi.advanceTimersByTimeAsync(0)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(ws.terminated).toBe(true)
      await expect(debit).resolves.toBe(false)
      expect(acknowledge).not.toHaveBeenCalled()
      expect(errors).toEqual([{ motiv: 'openai_realtime_socket_error', code: 'transport' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('nu pornește debitul nou înainte ca usage-ul turei anulate să fie durabil', async () => {
    const errors: Array<{ motiv: string; code?: string }> = []
    let confirmaUsage!: () => void
    const usageDurabil = new Promise<void>((resolve) => { confirmaUsage = resolve })
    const onUsage = vi.fn(() => usageDurabil)
    const { live, ws } = await deschideSesiuneTest(errors, onUsage)
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'response.created' })))
    await Promise.resolve()
    await Promise.resolve()

    const debiteaza = vi.fn(async () => true)
    const asteptareDebit = live.asteaptaDebit(
      debiteaza,
      async () => true,
      async () => true,
    )
    live.anunta('intrare după cancel')
    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'response.done',
      response: {
        id: 'resp-before-periodic-debit',
        status: 'cancelled',
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    })))

    await vi.waitFor(() => expect(onUsage).toHaveBeenCalledTimes(1))
    expect(debiteaza).not.toHaveBeenCalled()
    expect(ws.sent.filter((raw) => JSON.parse(raw).type === 'conversation.item.create')).toHaveLength(0)

    confirmaUsage()
    await vi.waitFor(() => expect(debiteaza).toHaveBeenCalledTimes(1))
    await expect(asteptareDebit).resolves.toBe(true)
    expect(errors).toEqual([])
    live.inchide()
  })

  it('închide fără debit nou dacă tura activă nu livrează usage după cancel', async () => {
    vi.useFakeTimers()
    try {
      const errors: Array<{ motiv: string; code?: string }> = []
      const { live, ws } = await deschideSesiuneTest(errors)
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'response.created' })))
      await vi.advanceTimersByTimeAsync(0)

      const debiteaza = vi.fn(async () => true)
      const asteptareDebit = live.asteaptaDebit(
        debiteaza,
        async () => true,
        async () => true,
      )
      live.anunta('nu trece fără usage')
      await vi.advanceTimersByTimeAsync(5_500)

      expect(ws.terminated).toBe(true)
      expect(debiteaza).not.toHaveBeenCalled()
      await expect(asteptareDebit).resolves.toBe(false)
      expect(errors).toEqual([{ motiv: 'provider_usage_unavailable', code: 'billing_unavailable' }])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('rambursarea debitului vocal de setup', () => {
  it('reîncearcă false/reject cu aceeași referință și o șterge numai după succes', async () => {
    const refs: string[] = []
    const write = vi.fn(async (ref: string) => {
      refs.push(ref)
      if (refs.length === 1) return false
      if (refs.length === 2) throw new Error('db unavailable')
      return true
    })
    const control = creeazaControlRambursareVocalLive(write, { maxAttempts: 3, retryDelayMs: 0 })
    expect(control.seteazaReferinta('voice:session:1')).toBe(true)

    await expect(control.ramburseaza()).resolves.toBe(true)
    expect(refs).toEqual(['voice:session:1', 'voice:session:1', 'voice:session:1'])
    expect(control.referintaCurenta()).toBeNull()
  })

  it('păstrează referința după toate eșecurile și nu propagă reject', async () => {
    const write = vi.fn(async () => { throw new Error('db unavailable') })
    const control = creeazaControlRambursareVocalLive(write, { maxAttempts: 2, retryDelayMs: 0 })
    control.seteazaReferinta('voice:retry:1')

    await expect(control.ramburseaza()).resolves.toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
    expect(control.referintaCurenta()).toBe('voice:retry:1')
  })

  it('serializează apelurile concurente într-o singură scriere', async () => {
    let confirma!: (ok: boolean) => void
    const write = vi.fn(() => new Promise<boolean>((resolve) => { confirma = resolve }))
    const control = creeazaControlRambursareVocalLive(write, { maxAttempts: 2, retryDelayMs: 0 })
    control.seteazaReferinta('voice:concurrent:1')

    const first = control.ramburseaza()
    const second = control.ramburseaza()
    expect(first).toBe(second)
    expect(write).toHaveBeenCalledTimes(1)
    confirma(true)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(write).toHaveBeenCalledTimes(1)
    expect(control.referintaCurenta()).toBeNull()
  })
})

describe('reconcilierea vocală după restart', () => {
  it('rulează la startup și periodic cu deadline și timer unref', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(source).toContain('void reconcileVoiceBilling().catch')
    expect(source).toMatch(/setInterval\(\(\) => \{[\s\S]*reconcileVoiceBilling\(\)[\s\S]*\}, 30_000\)/)
    expect(source).toContain('voiceReconciliationTimer.unref()')
    expect(source).toContain('voice_billing_reconciliation_timeout')
  })
})
