import { describe, expect, it } from 'vitest'
import { config } from './config.js'
import { execSharedAdminTool, SHARED_ADMIN_TOOLS } from './services/adminTools.js'
import {
  construiesteInstructiune,
  construiesteSetup,
  interpreteazaCadru,
  oraLocalaText,
} from './services/vocalLive.js'
import { cadreVedereLive, capacitateVocalLive, unelteleSesiuniiLive } from './routes/vocalLive.js'
import { inputImageBlock, parseInputImageDataUrl } from './services/inputImage.js'

describe('OpenAI Realtime — session.update', () => {
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

describe('OpenAI Realtime — protocol events', () => {
  it('traduce audio și transcrieri incrementale/finale', () => {
    expect(interpreteazaCadru({ type: 'session.updated' })).toEqual([{ fel: 'gata' }])
    expect(interpreteazaCadru({ type: 'response.output_audio.delta', delta: 'AAA' })).toEqual([{ fel: 'audio', data: 'AAA' }])
    expect(interpreteazaCadru({ type: 'conversation.item.input_audio_transcription.delta', delta: 'sal' })).toEqual([
      { fel: 'user', text: 'sal', final: false },
    ])
    expect(interpreteazaCadru({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'salut' })).toEqual([
      { fel: 'user', text: 'salut', final: true },
    ])
    expect(interpreteazaCadru({ type: 'response.output_audio_transcript.done', transcript: 'bună' })).toEqual([
      { fel: 'kelion', text: 'bună', final: true },
    ])
  })

  it('semnalează barge-in și acceptă numai tool calls structurate valid', () => {
    expect(interpreteazaCadru({ type: 'input_audio_buffer.speech_started' })).toEqual([{ fel: 'intrerupt' }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', call_id: 'call-1', name: 'cauta', arguments: '{"q":"test"}',
    })).toEqual([{ fel: 'unealta', id: 'call-1', name: 'cauta', args: { q: 'test' } }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', call_id: 'call-2', name: 'cauta', arguments: '{invalid',
    })).toEqual([{ fel: 'eroare', motiv: 'realtime_tool_arguments_invalid' }])
    expect(interpreteazaCadru({
      type: 'response.function_call_arguments.done', call_id: '', name: 'cauta', arguments: '{}',
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
          responseId: 'resp-1', inputTokens: 12, outputTokens: 7, totalTokens: 19,
          inputAudioTokens: 9, outputAudioTokens: 5,
        },
      },
      { fel: 'turaGata' },
    ])
  })

  it('nu declară tura gata pentru răspuns failed/incomplete sau fără response id', () => {
    const failed = interpreteazaCadru({
      type: 'response.done',
      response: { id: 'resp-2', status: 'failed', status_details: { reason: 'provider_error' }, usage: {} },
    })
    expect(failed).toContainEqual({ fel: 'eroare', motiv: 'realtime_response_failed:provider_error' })
    expect(failed).not.toContainEqual({ fel: 'turaGata' })
    expect(interpreteazaCadru({ type: 'response.done', response: { status: 'completed', usage: {} } })).toEqual([
      { fel: 'eroare', motiv: 'realtime_usage_missing_response_id' },
    ])
  })
})

describe('OpenAI Realtime — context și autorizare', () => {
  it('publică exact contractul de capabilitate consumat de frontend', () => {
    expect(capacitateVocalLive()).toEqual({
      disponibil: Boolean(config.openai.key && config.openai.realtime),
      model: config.openai.realtime,
      voce: config.openaiVoice,
    })
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
