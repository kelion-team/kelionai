import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { config } from './config.js'
import { execSharedAdminTool, SHARED_ADMIN_TOOLS } from './services/adminTools.js'
import {
  construiesteInstructiune,
  construiesteSetup,
  creeazaPoartaUnelteRealtime,
  interpreteazaCadru,
  modelTranscriereRealtimeMeterizabil,
  oraLocalaText,
} from './services/vocalLive.js'
import { cadreVedereLive, capacitateVocalLive, cheieIdempotentaTuraVocala, creeazaPoartaStartExplicit, dateDinEvenimentSse, meterizeazaVocalLiveCuDeadline, rearmeazaCeasCostVocalLive, unelteleSesiuniiLive, verdictMeteringVocalLive } from './routes/vocalLive.js'
import { inputImageBlock, parseInputImageDataUrl } from './services/inputImage.js'
import { clasificaStatusOpenAIRealtime } from './services/openaiVoiceStatus.js'

describe('OpenAI Realtime — session.update', () => {
  it('acceptă numai modele de transcriere cu usage tokenizabil în ledgerul curent', () => {
    expect(modelTranscriereRealtimeMeterizabil('gpt-4o-mini-transcribe')).toBe(true)
    expect(modelTranscriereRealtimeMeterizabil('gpt-4o-transcribe')).toBe(true)
    expect(modelTranscriereRealtimeMeterizabil('whisper-1')).toBe(false)
    expect(modelTranscriereRealtimeMeterizabil('gpt-realtime-whisper')).toBe(false)
  })

  it('configurează audio nativ full-duplex, transcriere, server VAD și barge-in', () => {
    const message = construiesteSetup(
      'gpt-realtime-test',
      'cedar',
      'Instrucțiune de test',
      [{ name: 'cauta', description: 'Caută', parameters: { type: 'object', properties: {} } }],
      'ro-RO',
    ) as {
      type: string
      session: {
        type: string
        model: string
        instructions: string
        output_modalities: string[]
        audio: {
          input: {
            format: { type: string; rate: number }
            transcription: { language?: string }
            turn_detection: { type: string; create_response: boolean; interrupt_response: boolean }
          }
          output: { format: { type: string; rate: number }; voice: string }
        }
        tools: Array<{ type: string; name: string }>
        tool_choice: string
      }
    }

    expect(message.type).toBe('session.update')
    expect(message.session).toMatchObject({
      type: 'realtime', model: 'gpt-realtime-test', instructions: 'Instrucțiune de test',
      output_modalities: ['audio'], tool_choice: 'auto',
    })
    expect(message.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24_000 })
    expect(message.session.audio.output).toMatchObject({ format: { type: 'audio/pcm', rate: 24_000 }, voice: 'cedar' })
    expect(message.session.audio.input.transcription.language).toBe('ro')
    expect(message.session.audio.input.turn_detection).toMatchObject({
      type: 'server_vad', create_response: true, interrupt_response: true,
    })
    expect(message.session.tools).toEqual([
      { type: 'function', name: 'cauta', description: 'Caută', parameters: { type: 'object', properties: {} } },
    ])
  })
})

describe('ușa vocală spre /api/chat', () => {
  it('înlătură metadatele SSE și păstrează numai liniile data', () => {
    expect(dateDinEvenimentSse('id: 42\r\ndata: \u001f{"executie":{"pas":"caută"}}\u001f\r\ndata: text\r\n')).toBe(
      '\u001f{"executie":{"pas":"caută"}}\u001f\ntext',
    )
    expect(dateDinEvenimentSse(': keep-alive\n\n')).toBe('')
  })

  it('transformă ID-urile opace OpenAI într-un UUID stabil și distinct pe rundă', () => {
    const prima = cheieIdempotentaTuraVocala('call_abc-123')
    const repetata = cheieIdempotentaTuraVocala('call_abc-123')
    const triere = cheieIdempotentaTuraVocala('call_abc-123:triage:1')
    expect(prima).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(repetata).toBe(prima)
    expect(triere).not.toBe(prima)
  })

  it('armează clickul o singură dată, îl consumă și nu armează o reconectare nouă', () => {
    let acum = 1_000
    const click = creeazaPoartaStartExplicit(() => acum)
    expect(click.activa()).toBe(false)
    expect(click.armeaza()).toBe(true)
    expect(click.activa()).toBe(true)
    expect(click.incepeTura()).toBe(true)
    acum += 30_001
    expect(click.activa()).toBe(true)
    click.consuma()
    expect(click.activa()).toBe(false)
    expect(click.armeaza()).toBe(false)

    const reconectare = creeazaPoartaStartExplicit(() => acum)
    expect(reconectare.activa()).toBe(false)
    expect(reconectare.armeaza()).toBe(true)
    acum += 30_001
    expect(reconectare.activa()).toBe(false)
  })
})

describe('OpenAI Realtime — protocol events', () => {
  const usageZero = () => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })

  it('traduce audio și transcrieri incrementale/finale', () => {
    expect(interpreteazaCadru({ type: 'session.updated' })).toEqual([{ fel: 'gata' }])
    expect(interpreteazaCadru({ type: 'response.output_audio.delta', delta: 'AAA' })).toEqual([{ fel: 'audio', data: 'AAA' }])
    expect(interpreteazaCadru({ type: 'conversation.item.input_audio_transcription.delta', delta: 'sal' })).toEqual([
      { fel: 'user', text: 'sal', final: false },
    ])
    expect(interpreteazaCadru({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: 'event-transcription-1',
      transcript: 'salut',
      usage: {
        type: 'tokens',
        total_tokens: 26,
        input_tokens: 17,
        output_tokens: 9,
        input_token_details: { audio_tokens: 17 },
      },
    })).toEqual([
      { fel: 'user', text: 'salut', final: true },
      {
        fel: 'usage',
        usage: {
          responseId: 'event-transcription-1',
          model: config.openai.realtimeTranscription,
          surface: 'realtime_transcription',
          inputTokens: 17,
          outputTokens: 9,
          totalTokens: 26,
          inputAudioTokens: 17,
          outputAudioTokens: 0,
        },
      },
    ])
    expect(interpreteazaCadru({ type: 'response.output_audio_transcript.done', transcript: 'bună' })).toEqual([
      { fel: 'kelion', text: 'bună', final: true },
    ])
  })

  it('semnalează barge-in și acceptă numai tool calls structurate valid', () => {
    expect(interpreteazaCadru({ type: 'input_audio_buffer.speech_started' })).toEqual([{ fel: 'intrerupt' }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', response_id: 'resp-tools', call_id: 'call-1', name: 'cauta', arguments: '{"q":"test"}',
    })).toEqual([{ fel: 'unealta', responseId: 'resp-tools', id: 'call-1', name: 'cauta', args: { q: 'test' } }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', response_id: 'resp-tools', call_id: 'call-2', name: 'cauta', arguments: '{invalid',
    })).toEqual([{ fel: 'eroare', motiv: 'realtime_tool_arguments_invalid' }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', response_id: 'resp-tools', call_id: '', name: 'cauta', arguments: '{}',
    })).toEqual([{ fel: 'eroare', motiv: 'realtime_tool_call_invalid' }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', response_id: `resp-${'x'.repeat(160)}`, call_id: 'call-3', name: 'cauta', arguments: '{}',
    })).toEqual([{ fel: 'eroare', motiv: 'realtime_tool_call_invalid' }])
  })

  it('emite usage real înainte de finalul unei ture reușite', () => {
    expect(interpreteazaCadru({
      type: 'response.done',
      response: {
        id: 'resp-1', status: 'completed',
        usage: {
          input_tokens: 12, output_tokens: 7, total_tokens: 19,
          input_token_details: { audio_tokens: 9 }, output_token_details: { audio_tokens: 5 },
        },
      },
    })).toEqual([
      {
        fel: 'usage',
        usage: {
          responseId: 'resp-1', model: config.openai.realtime, surface: 'realtime',
          inputTokens: 12, outputTokens: 7, totalTokens: 19,
          inputAudioTokens: 9, outputAudioTokens: 5,
        },
      },
      { fel: 'turaGata', responseId: 'resp-1', executaUnelte: true },
    ])
  })

  it('respinge usage-ul Realtime fără toate contoarele core valide', () => {
    const invalidUsage = [
      undefined,
      {},
      { input_tokens: '1', output_tokens: 0, total_tokens: 1 },
      { input_tokens: 0, output_tokens: 0.5, total_tokens: 1 },
      { input_tokens: 0, output_tokens: 0, total_tokens: -1 },
      { input_tokens: 0, output_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    ]
    for (const usage of invalidUsage) {
      const frames = interpreteazaCadru({
        type: 'response.done',
        response: { id: 'resp-invalid-usage', status: 'completed', usage },
      })
      expect(frames).toEqual([{
        fel: 'eroare',
        motiv: 'provider_usage_unavailable',
        code: 'billing_unavailable',
      }])
      expect(frames.some((frame) => frame.fel === 'usage' || frame.fel === 'turaGata')).toBe(false)
    }
  })

  it('respinge contoarele audio opționale când sunt prezente dar nu sunt întregi sigure', () => {
    for (const details of [
      'invalid',
      { audio_tokens: '3' },
      { audio_tokens: -1 },
      { audio_tokens: 1.5 },
      { audio_tokens: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const frames = interpreteazaCadru({
        type: 'response.done',
        response: {
          id: 'resp-invalid-audio-usage',
          status: 'completed',
          usage: { ...usageZero(), input_token_details: details },
        },
      })
      expect(frames).toEqual([{
        fel: 'eroare',
        motiv: 'provider_usage_unavailable',
        code: 'billing_unavailable',
      }])
    }
  })

  it('respinge usage-ul Realtime cu total sau contoare audio incoerente', () => {
    for (const usage of [
      { input_tokens: 10, output_tokens: 5, total_tokens: 0 },
      { input_tokens: 10, output_tokens: 5, total_tokens: 16 },
      { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_token_details: { audio_tokens: 11 } },
      { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_token_details: { audio_tokens: 6 } },
    ]) {
      const frames = interpreteazaCadru({
        type: 'response.done',
        response: { id: 'resp-incoherent-usage', status: 'completed', usage },
      })
      expect(frames).toEqual([{
        fel: 'eroare',
        motiv: 'provider_usage_unavailable',
        code: 'billing_unavailable',
      }])
      expect(frames.some((frame) => frame.fel === 'usage' || frame.fel === 'turaGata')).toBe(false)
    }
  })

  it('respinge identificatorii providerului care nu sunt șiruri valide', () => {
    for (const id of [12, {}, 'response id', '']) {
      const frames = interpreteazaCadru({
        type: 'response.done',
        response: { id, status: 'completed', usage: usageZero() },
      })
      expect(frames).toEqual([{
        fel: 'eroare',
        motiv: 'realtime_usage_missing_response_id',
        code: 'billing_unavailable',
      }])
    }
  })

  it('arată un eșec 5xx cu un cod sigur și fără textul privat al providerului', () => {
    const failed = interpreteazaCadru({
      type: 'response.done',
      response: {
        id: 'resp-2',
        status: 'failed',
        status_details: { error: { code: 'server_error', message: 'private provider incident' } },
        usage: usageZero(),
      },
    })
    expect(failed).toContainEqual({
      fel: 'eroare',
      motiv: 'openai_realtime_response_failed',
      code: 'provider_5xx',
    })
    expect(failed.some((frame) => frame.fel === 'turaGata')).toBe(false)
    expect(JSON.stringify(failed)).not.toContain('private provider incident')
  })

  it('arată un response.failed rate-limit cu un cod sigur', () => {
    const failed = interpreteazaCadru({
      type: 'response.done',
      response: {
        id: 'resp-rate-limit',
        status: 'failed',
        status_details: { error: { code: 'rate_limit_exceeded', message: 'private rpm detail' } },
        usage: usageZero(),
      },
    })
    expect(failed).toContainEqual({
      fel: 'eroare',
      motiv: 'openai_realtime_response_failed',
      code: 'rate_limit',
    })
    expect(failed.some((frame) => frame.fel === 'turaGata')).toBe(false)
    expect(JSON.stringify(failed)).not.toContain('private rpm detail')
  })

  it('nu execută unelte când statusul response.done lipsește', () => {
    const frames = interpreteazaCadru({
      type: 'response.done',
      response: { id: 'resp-no-status', usage: usageZero() },
    })
    expect(frames).toContainEqual({
      fel: 'eroare',
      motiv: 'openai_realtime_response_status_invalid',
      code: 'configuration',
    })
    expect(frames.some((frame) => frame.fel === 'turaGata')).toBe(false)
  })

  it('nu declară tura gata pentru response.done fără response id', () => {
    expect(interpreteazaCadru({ type: 'response.done', response: { status: 'completed', usage: {} } })).toEqual([
      { fel: 'eroare', motiv: 'realtime_usage_missing_response_id', code: 'billing_unavailable' },
    ])
  })

  it('închide normal o tură incompletă fără să omoare sesiunea Realtime', () => {
    const frames = interpreteazaCadru({
      type: 'response.done',
      response: {
        id: 'resp-incomplete',
        status: 'incomplete',
        status_details: { reason: 'max_output_tokens' },
        usage: usageZero(),
      },
    })
    expect(frames).toContainEqual({ fel: 'turaGata', responseId: 'resp-incomplete', executaUnelte: false })
    expect(frames.some((frame) => frame.fel === 'eroare')).toBe(false)
  })

  it('nu execută unelte înainte de response.completed și le aruncă pe incomplete', () => {
    const executate: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    const poarta = creeazaPoartaUnelteRealtime((apel) => executate.push(apel))
    const apel = { fel: 'unealta' as const, responseId: 'resp-safe', id: 'call-safe', name: 'scrie', args: { valoare: 1 } }

    poarta.pregateste(apel)
    expect(executate).toEqual([])
    poarta.finalizeaza('resp-safe', false)
    expect(executate).toEqual([])

    poarta.pregateste(apel)
    poarta.finalizeaza('resp-safe', true)
    expect(executate).toEqual([{ id: 'call-safe', name: 'scrie', args: { valoare: 1 } }])
  })

  it('oprește terminal o tură incompletă billable fără response id', () => {
    expect(interpreteazaCadru({
      type: 'response.done',
      response: { status: 'incomplete', status_details: { reason: 'max_output_tokens' }, usage: {} },
    })).toEqual([{
      fel: 'eroare',
      motiv: 'realtime_usage_missing_response_id',
      code: 'billing_unavailable',
    }])
  })

  it('oprește terminal o transcriere billable fără usage sau id idempotent', () => {
    expect(interpreteazaCadru({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'salut',
    })).toEqual([
      { fel: 'user', text: 'salut', final: true },
      {
        fel: 'eroare',
        motiv: 'realtime_transcription_usage_unavailable',
        code: 'billing_unavailable',
      },
    ])
  })

  it('oprește terminal usage-ul de transcriere pe durată, pe care ledgerul token nu îl poate reprezenta', () => {
    expect(interpreteazaCadru({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: 'event-duration',
      transcript: 'salut',
      usage: { type: 'duration', seconds: 1.25 },
    })).toEqual([
      { fel: 'user', text: 'salut', final: true },
      {
        fel: 'eroare',
        motiv: 'realtime_transcription_usage_unavailable',
        code: 'billing_unavailable',
      },
    ])
  })

  it('oprește terminal transcrierea când unitatea de usage lipsește sau nu este cunoscută', () => {
    for (const usage of [{ input_tokens: 2 }, { type: 'characters', input_tokens: 2 }]) {
      expect(interpreteazaCadru({
        type: 'conversation.item.input_audio_transcription.completed',
        event_id: 'event-usage-unit',
        transcript: 'salut',
        usage,
      })).toContainEqual({
        fel: 'eroare',
        motiv: 'realtime_transcription_usage_unavailable',
        code: 'billing_unavailable',
      })
    }
  })

  it('respinge usage-ul de transcriere cu contoare core sau audio deformate', () => {
    const invalidUsage = [
      { type: 'tokens', input_tokens: 1, output_tokens: 0 },
      { type: 'tokens', input_tokens: 1, output_tokens: 0, total_tokens: '1' },
      { type: 'tokens', input_tokens: -1, output_tokens: 0, total_tokens: 0 },
      { type: 'tokens', input_tokens: 1, output_tokens: 0, total_tokens: 1, input_token_details: { audio_tokens: 0.5 } },
      { type: 'tokens', input_tokens: 1, output_tokens: 0, total_tokens: 1, output_token_details: { audio_tokens: '0' } },
    ]
    for (const usage of invalidUsage) {
      const frames = interpreteazaCadru({
        type: 'conversation.item.input_audio_transcription.completed',
        event_id: 'event-invalid-token-usage',
        transcript: 'salut',
        usage,
      })
      expect(frames).toContainEqual({
        fel: 'eroare',
        motiv: 'realtime_transcription_usage_unavailable',
        code: 'billing_unavailable',
      })
      expect(frames.some((frame) => frame.fel === 'usage' || frame.fel === 'turaGata')).toBe(false)
    }
  })

  it('respinge usage-ul de transcriere incoerent', () => {
    for (const usage of [
      { type: 'tokens', input_tokens: 4, output_tokens: 1, total_tokens: 4 },
      { type: 'tokens', input_tokens: 4, output_tokens: 1, total_tokens: 5, input_token_details: { audio_tokens: 5 } },
      { type: 'tokens', input_tokens: 4, output_tokens: 1, total_tokens: 5, output_token_details: { audio_tokens: 2 } },
    ]) {
      const frames = interpreteazaCadru({
        type: 'conversation.item.input_audio_transcription.completed',
        event_id: 'event-incoherent-token-usage',
        transcript: 'salut',
        usage,
      })
      expect(frames).toContainEqual({
        fel: 'eroare',
        motiv: 'realtime_transcription_usage_unavailable',
        code: 'billing_unavailable',
      })
      expect(frames.some((frame) => frame.fel === 'usage' || frame.fel === 'turaGata')).toBe(false)
    }
  })

  it('tratează anularea prin barge-in ca întrerupere, nu ca defect terminal', () => {
    const frames = interpreteazaCadru({
      type: 'response.done',
      response: { id: 'resp-cancelled', status: 'cancelled', usage: usageZero() },
    })
    expect(frames).toContainEqual({ fel: 'intrerupt' })
    expect(frames.some((frame) => frame.fel === 'eroare')).toBe(false)
  })

  it('oprește fail-closed și un răspuns anulat billable fără response id', () => {
    expect(interpreteazaCadru({
      type: 'response.done',
      response: { status: 'cancelled', usage: { input_tokens: 2 } },
    })).toEqual([{
      fel: 'eroare',
      motiv: 'realtime_usage_missing_response_id',
      code: 'billing_unavailable',
    }])
  })

  it('reduce erorile terminale ale providerului la coduri publice fără mesajul lui liber', () => {
    const cases = [
      [{ code: 'invalid_api_key', message: 'secret provider detail' }, 'invalid_key'],
      [{ code: 'insufficient_quota', message: 'billing limit reached' }, 'quota'],
      [{ code: 'model_not_found', message: 'no access to this model' }, 'model_access'],
    ] as const
    for (const [error, code] of cases) {
      const frames = interpreteazaCadru({ type: 'error', error })
      expect(frames).toEqual([{ fel: 'eroare', motiv: 'openai_realtime_unavailable', code }])
      expect(JSON.stringify(frames)).not.toContain(error.message)
    }
  })

  it('ignoră numai erorile request-scoped care nu cer retry', () => {
    for (const error of [
      { code: 'response_cancel_not_active', message: 'There is no active response to cancel' },
      { code: 'invalid_request_error', message: 'bad event' },
    ]) {
      const frames = interpreteazaCadru({ type: 'error', event_id: 'event-request', error })
      expect(frames).toEqual([])
      expect(JSON.stringify(frames)).not.toContain(error.message)
    }
  })

  it('arată rate-limit și 5xx ca erori retryable cu cod sigur', () => {
    for (const [error, code] of [
      [{ code: 'rate_limit_exceeded', message: 'private rpm detail' }, 'rate_limit'],
      [{ code: 'server_error', message: 'private provider incident' }, 'provider_5xx'],
    ] as const) {
      const frames = interpreteazaCadru({ type: 'error', event_id: 'event-retry', error })
      expect(frames).toEqual([{ fel: 'eroare', motiv: 'openai_realtime_unavailable', code }])
      expect(JSON.stringify(frames)).not.toContain(error.message)
    }
  })

  it('clasifică handshake-ul Realtime înainte ca browserul să-l piardă în 1006', () => {
    expect(clasificaStatusOpenAIRealtime(401)).toBe('invalid_key')
    expect(clasificaStatusOpenAIRealtime(403)).toBe('model_access')
    expect(clasificaStatusOpenAIRealtime(404, { code: 'model_not_found' })).toBe('model_access')
    expect(clasificaStatusOpenAIRealtime(429, { code: 'insufficient_quota' })).toBe('quota')
    expect(clasificaStatusOpenAIRealtime(429, { code: 'organization_usage_limit_exceeded' })).toBe('quota')
    expect(clasificaStatusOpenAIRealtime(429, { code: 'rate_limit_exceeded' })).toBe('rate_limit')
    expect(clasificaStatusOpenAIRealtime(503)).toBe('provider_5xx')
  })
})

describe('OpenAI Realtime — context și autorizare', () => {
  it('publică disponibil când health-ul OpenAI real este verde', async () => {
    await expect(capacitateVocalLive(async () => ({
      ok: true,
      serving: true,
      status: 200,
      class: 'ok',
    }), () => true)).resolves.toEqual({
      disponibil: true,
      model: config.openai.realtime,
      voce: config.openaiVoice,
      retryable: false,
    })
  })

  it('propagă coduri safe terminale și nu le marchează pentru retry', async () => {
    for (const [healthClass, code, status] of [
      ['invalid_key', 'invalid_key', 401],
      ['invalid_credentials', 'invalid_key', 401],
      ['insufficient_quota', 'quota', 429],
      ['metering_unavailable', 'billing_unavailable', 200],
    ] as const) {
      await expect(capacitateVocalLive(async () => ({
        ok: true,
        serving: false,
        status,
        class: healthClass,
      }), () => true)).resolves.toMatchObject({
        disponibil: false,
        code,
        retryable: false,
      })
    }
  })

  it('lasă handshake-ul Realtime să judece erorile neautoritare ale probei Luna', async () => {
    for (const [healthClass, status] of [
      ['model_access', 403],
      ['bad_request', 400],
      ['rate_limited', 429],
      ['provider_5xx', 503],
      ['transport', null],
    ] as const) {
      await expect(capacitateVocalLive(async () => ({
        ok: status !== null,
        serving: false,
        status,
        class: healthClass,
      }), () => true)).resolves.toMatchObject({
        disponibil: true,
        retryable: false,
      })
    }
  })

  it('oprește terminal după eșecul de metering fără refund sau reconectare taxabilă', () => {
    expect(verdictMeteringVocalLive('provider_usage_unavailable')).toEqual({
      frame: {
        type: 'eroare',
        motiv: 'provider_usage_unavailable',
        code: 'billing_unavailable',
      },
      closeCode: 1008,
      closeReason: 'billing_unavailable',
      refundInitialCharge: false,
    })
  })

  it('închide fail-closed o scriere de metering care nu se termină', async () => {
    vi.useFakeTimers()
    try {
      const pending = meterizeazaVocalLiveCuDeadline(
        () => new Promise<void>(() => undefined),
        25,
      )
      const rejection = expect(pending).rejects.toThrow('provider_usage_timeout')
      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('rearmează 60s de la fiecare ACK și anulează tickul vechi', async () => {
    vi.useFakeTimers()
    try {
      let inchis = false
      const tick = vi.fn(async () => true)
      let ceas = rearmeazaCeasCostVocalLive(null, () => inchis, tick, 60_000)

      await vi.advanceTimersByTimeAsync(59_000)
      expect(tick).not.toHaveBeenCalled()
      ceas = rearmeazaCeasCostVocalLive(ceas, () => inchis, tick, 60_000)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(tick).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(59_000)
      expect(tick).toHaveBeenCalledTimes(1)

      inchis = true
      rearmeazaCeasCostVocalLive(ceas, () => inchis, tick, 60_000)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(tick).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('închide server-side providerul, browserul și ceasurile pe eroare fatală', () => {
    const source = readFileSync(new URL('./routes/vocalLive.ts', import.meta.url), 'utf8')
    const start = source.indexOf('onEroare: (motiv, code) => {')
    const end = source.indexOf('onInfo: (msg) => {', start)
    const handler = source.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(handler).toContain('clearInterval(ceasCost)')
    expect(handler).toContain('clearInterval(ceasOrdine)')
    expect(handler).toContain('live?.inchide()')
    expect(handler).toContain('socket.close(')
  })

  it('ține orice mesaj billable în coadă până când metering-ul precedent este durabil', () => {
    const source = readFileSync(new URL('./services/vocalLive.ts', import.meta.url), 'utf8')
    expect(source).toContain('if (meteringInFlight) {')
    expect(source).toContain("queueWhileMetering({ kind: 'message', message }")
    expect(source).toContain("queueWhileMetering({ kind: 'audio', audio: pcm24k }")
    expect(source).toContain('sendTurnMessages([')
    expect(source).toContain('flushMeteringQueue()')
  })

  it('serializează debitările, pornește intervalul numai după providerReady și compensează debitul tardiv', () => {
    const source = readFileSync(new URL('./routes/vocalLive.ts', import.meta.url), 'utf8')
    expect(source).toContain('if (chargeInFlight) return chargeInFlight')
    expect(source).toContain('if (inchis && !providerReady) {')
    const interval = source.indexOf('ceasCost = rearmeazaCeasCostVocalLive(')
    const ready = source.lastIndexOf('providerReady = true', interval)
    expect(interval).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(-1)
    expect(source.slice(ready, interval)).toContain('if (monetizedCustomer)')
    expect(source).toContain('if (inchis) return Promise.resolve(false)')
    expect(source).toContain('if (!inchis) onDebitAcknowledged()')
    expect(source.slice(ready, interval)).toContain('if (inchis) return')
    expect(source.slice(interval, interval + 220)).toContain('() => inchis')
    expect(source.slice(interval, interval + 220)).toContain('chargeMinute')
  })

  it('nu cheamă health când cheia/modelul Realtime nu sunt configurate', async () => {
    let probes = 0
    await expect(capacitateVocalLive(async () => {
      probes++
      return { ok: true, serving: true, status: 200, class: 'ok' }
    }, () => false)).resolves.toMatchObject({
      disponibil: false,
      code: 'not_configured',
      retryable: false,
    })
    expect(probes).toBe(0)
  })

  it('acceptă un singur cadru data URL compatibil cu /api/chat și respinge base64 brut', () => {
    const valid = 'data:image/jpeg;base64,AA=='
    expect(cadreVedereLive([valid, 'data:image/png;base64,AA=='])).toEqual([valid])
    expect(cadreVedereLive(['AA==', 'data:text/plain;base64,AA==', 'data:image/jpeg;base64,%%%'])).toEqual([])
    expect(cadreVedereLive([`data:image/jpeg;base64,${'A'.repeat(2_000_000)}`])).toEqual([])
  })

  it('păstrează MIME-ul validat JPEG/PNG/WebP până în blocul multimodal', () => {
    expect(inputImageBlock('data:image/jpeg;base64,AA==')?.source.media_type).toBe('image/jpeg')
    expect(inputImageBlock('data:image/png;base64,AA==')?.source.media_type).toBe('image/png')
    expect(inputImageBlock('data:image/webp;base64,AA==')?.source.media_type).toBe('image/webp')
    expect(parseInputImageDataUrl('data:image/gif;base64,AA==')).toBeNull()
    expect(inputImageBlock('AA==')).toBeNull()
  })

  it('păstrează persoana, limba, timpul și istoricul fără context inventat', () => {
    const text = construiesteInstructiune(
      'Ești Kelion.',
      'Ana',
      [
        { role: 'user', content: 'Ce am spus?' },
        { role: 'assistant', content: 'Ai întrebat despre context.' },
      ],
      { nowIso: '2026-08-24T12:00:00.000Z', tz: 'Europe/London' },
      'ro-RO',
    )
    expect(text).toContain('Ana')
    expect(text).toContain('Limba preferată')
    expect(text).toContain('Ana: Ce am spus?')
    expect(text).toContain('Kelion: Ai întrebat despre context.')
    expect(text).toContain(oraLocalaText('2026-08-24T12:00:00.000Z', 'Europe/London'))
  })

  it('nu închide o conversație normală după o pauză de 20 de secunde', () => {
    expect(config.vocalLiveIdleTimeoutSeconds).toBeGreaterThan(20)
  })

  it('nu oferă utilizatorilor obișnuiți nicio unealtă globală/admin', async () => {
    const userTools = new Set(unelteleSesiuniiLive(false).map((tool) => tool.name))
    expect(userTools.has('cere_creierului')).toBe(true)
    expect(userTools.has('list_memories')).toBe(true)
    expect(userTools.has('dovada_faptelor')).toBe(true)
    for (const name of SHARED_ADMIN_TOOLS) {
      expect(userTools.has(name), `${name} nu trebuie expus unui client`).toBe(false)
      await expect(execSharedAdminTool(name, {})).resolves.toBe(JSON.stringify({ error: 'admin_only' }))
    }
  })

  it('inventarul admin este activat numai după verificarea server-side', () => {
    const adminTools = new Set(unelteleSesiuniiLive(true).map((tool) => tool.name))
    expect(adminTools.has('cere_creierului')).toBe(true)
    for (const name of SHARED_ADMIN_TOOLS) expect(adminTools.has(name)).toBe(true)
  })
})
