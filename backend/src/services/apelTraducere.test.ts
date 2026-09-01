import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DIRECTORY = [
  { email: 'a@x.com', name: 'Ana' },
  { email: 'b@x.com', name: 'Bogdan' },
]
const UTTERANCE_ID = '11111111-1111-4111-8111-111111111111'

const billing = vi.hoisted(() => ({
  debit: vi.fn(async () => ({ ok: true as const, debitedMinor: 1, duplicate: false })),
  grant: vi.fn(async () => true),
}))
vi.mock('../db.js', () => ({
  cautaUtilizatorApel: vi.fn(async (term: string) => {
    const query = term.toLowerCase()
    return {
      citit: true,
      valoare: DIRECTORY.filter((user) => user.email.includes(query) || user.name.toLowerCase().includes(query)),
    }
  }),
  getSpeechLang: vi.fn(async () => 'ro'),
  debitWalletMinorAtomar: billing.debit,
  grantCreditMinor: billing.grant,
}))

const brain = vi.hoisted(() => ({
  reason: vi.fn(async () => ({
    text: 'Bună (tradus în română)',
    toolCalls: [],
    model: 'test-model',
    stop: 'completed',
    inputTokens: 1,
    outputTokens: 1,
  })),
}))
vi.mock('./creierRationament.js', () => ({ rationeazaMesaje: brain.reason }))

const speech = vi.hoisted(() => ({
  synthesize: vi.fn(async () => ({ ok: true as const, audio: Buffer.from('MP3DATA'), engine: 'openai' as const })),
  transcribe: vi.fn(async () => ({ ok: true as const, transcript: 'Salut lume', providerRequestId: 'req_test' })),
}))
vi.mock('./tts.js', () => ({ synthesize: speech.synthesize }))
vi.mock('./openaiCallTranscription.js', () => ({ transcribeCallAudio: speech.transcribe }))
vi.mock('../config.js', () => ({ config: { billing: { callUtteranceMinor: 1 } } }))

const calls = await import('./apel.js')
const { traduVorbire, intentApel } = await import('./apelTraducere.js')
const registered: Array<{ email: string; connection: ReturnType<typeof connection> }> = []

function connection(): { trimite: (message: unknown) => void; messages: Array<Record<string, unknown>> } {
  const messages: Array<Record<string, unknown>> = []
  return { trimite: (message) => messages.push(message as Record<string, unknown>), messages }
}

function register(email: string, value: ReturnType<typeof connection>): void {
  calls.inregistreazaPrezenta(email, value)
  registered.push({ email, connection: value })
}

async function connectedCall(): Promise<{
  callId: string
  caller: ReturnType<typeof connection>
  callee: ReturnType<typeof connection>
}> {
  const caller = connection()
  const callee = connection()
  register('a@x.com', caller)
  register('b@x.com', callee)
  const result = await calls.sunaUtilizator('a@x.com', 'Bogdan')
  const callId = result.callId ?? ''
  calls.gestioneazaMesaj('b@x.com', { type: 'accept', callId })
  return { callId, caller, callee }
}

async function pendingCall(): Promise<string> {
  register('b@x.com', connection())
  const result = await calls.sunaUtilizator('a@x.com', 'Bogdan')
  return result.callId ?? ''
}

beforeEach(() => {
  brain.reason.mockReset()
  brain.reason.mockResolvedValue({
    text: 'Bună (tradus în română)',
    toolCalls: [],
    model: 'test-model',
    stop: 'completed',
    inputTokens: 1,
    outputTokens: 1,
  })
  speech.synthesize.mockReset()
  speech.synthesize.mockResolvedValue({ ok: true, audio: Buffer.from('MP3DATA'), engine: 'openai' })
  speech.transcribe.mockReset()
  speech.transcribe.mockResolvedValue({ ok: true, transcript: 'Salut lume', providerRequestId: 'req_test' })
  billing.debit.mockReset()
  billing.debit.mockResolvedValue({ ok: true, debitedMinor: 1, duplicate: false })
  billing.grant.mockReset()
  billing.grant.mockResolvedValue(true)
})

afterEach(() => {
  for (const item of registered.splice(0).reverse()) {
    calls.scoatePrezenta(item.email, item.connection)
  }
})

describe('call translation', () => {
  it('charges once and delivers translated text plus OpenAI speech', async () => {
    const { callId, callee } = await connectedCall()
    const outcome = await traduVorbire('a@x.com', {
      type: 'vorbire', callId, utteranceId: UTTERANCE_ID, audio: 'BASE64', mime: 'audio/webm',
    })

    expect(outcome).toEqual({ ok: true, state: 'delivered' })
    expect(billing.debit).toHaveBeenCalledWith(
      'a@x.com', 1, `call:${callId}:${UTTERANCE_ID}`, 'call translation utterance',
    )
    const translated = callee.messages.find((message) => message.type === 'tradus')
    expect(translated).toMatchObject({
      callId,
      utteranceId: UTTERANCE_ID,
      text: 'Bună (tradus în română)',
      audio: Buffer.from('MP3DATA').toString('base64'),
      de_la: 'Ana',
    })
    expect(brain.reason).toHaveBeenCalledTimes(1)
    expect(speech.synthesize).toHaveBeenCalledWith(
      'Bună (tradus în română)',
      'ro',
      { usageContext: { userEmail: 'a@x.com', surface: 'call_translation_tts' } },
    )
  })

  it('does not call a provider twice for a duplicate billing reference', async () => {
    billing.debit.mockResolvedValueOnce({ ok: true, debitedMinor: 0, duplicate: true })
    const { callId } = await connectedCall()
    const outcome = await traduVorbire('a@x.com', {
      callId, utteranceId: UTTERANCE_ID, audio: 'BASE64', mime: 'audio/webm',
    })
    expect(outcome).toEqual({ ok: true, state: 'duplicate' })
    expect(speech.transcribe).not.toHaveBeenCalled()
    expect(brain.reason).not.toHaveBeenCalled()
  })

  it('refunds when transcription cannot deliver a phrase', async () => {
    speech.transcribe.mockResolvedValueOnce({ ok: false, status: 502, error: 'provider_failed' } as never)
    const { callId } = await connectedCall()
    const outcome = await traduVorbire('a@x.com', {
      callId, utteranceId: UTTERANCE_ID, audio: 'BASE64', mime: 'audio/webm',
    })
    expect(outcome).toEqual({ ok: false, code: 'provider_failed' })
    expect(billing.grant).toHaveBeenCalledWith('a@x.com', 1, `call:${callId}:${UTTERANCE_ID}:refund`)
  })

  it('rejects outsiders and calls that are not connected before charging', async () => {
    register('b@x.com', connection())
    const result = await calls.sunaUtilizator('a@x.com', 'Bogdan')
    const outcome = await traduVorbire('outsider@x.com', {
      callId: result.callId, utteranceId: UTTERANCE_ID, audio: 'BASE64', mime: 'audio/webm',
    })
    expect(outcome).toEqual({ ok: false, code: 'not_connected' })
    expect(billing.debit).not.toHaveBeenCalled()
    expect(speech.transcribe).not.toHaveBeenCalled()
  })

  it('still delivers subtitles when speech synthesis fails', async () => {
    speech.synthesize.mockResolvedValueOnce({ ok: false, status: 502, error: 'tts_failed' } as never)
    const { callId, callee } = await connectedCall()
    const outcome = await traduVorbire('a@x.com', {
      callId, utteranceId: UTTERANCE_ID, audio: 'BASE64', mime: 'audio/webm',
    })
    expect(outcome).toEqual({ ok: true, state: 'delivered' })
    expect(callee.messages.find((message) => message.type === 'tradus')).toMatchObject({ audio: '' })
    expect(billing.grant).not.toHaveBeenCalled()
  })
})

describe('hands-free call intent', () => {
  it.each([
    ['ANSWER', 'answer'],
    ['DECLINE', 'decline'],
    ['NONE', 'none'],
    ['NOT ANSWER', 'none'],
  ] as const)('maps the exact classifier token %s to %s', async (modelText, expected) => {
    brain.reason.mockResolvedValueOnce({
      text: modelText,
      toolCalls: [],
      model: 'test-model',
      stop: 'completed',
      inputTokens: 1,
      outputTokens: 1,
    })
    const callId = await pendingCall()
    await expect(intentApel('b@x.com', callId, UTTERANCE_ID, 'BASE64', 'audio/webm')).resolves.toBe(expected)
  })

  it('does not spend provider calls for empty audio or a forged call', async () => {
    const callId = await pendingCall()
    await expect(intentApel('b@x.com', callId, UTTERANCE_ID, '', 'audio/webm')).resolves.toBe('none')
    await expect(intentApel('a@x.com', callId, UTTERANCE_ID, 'BASE64', 'audio/webm')).resolves.toBe('none')
    expect(speech.transcribe).not.toHaveBeenCalled()
    expect(brain.reason).not.toHaveBeenCalled()
  })
})
