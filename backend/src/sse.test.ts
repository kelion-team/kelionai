// ── SSE STREAM READER TESTS (the real-time speech path) ─────────────────
//
// `readSSE` is the single source through which Responses output flows, word by
// word. If parsing breaks, the user sees torn text or nothing.
//
// The cases that ACTUALLY happen on the network: an event split across two
// packets, empty heartbeat lines, `[DONE]`, broken JSON.
import { describe, it, expect } from 'vitest'
import { readSSE } from './services/sse.js'

/** A stream like the real one, delivered in the given chunks (they can split an event in two). */
function flux(bucati: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(c) {
      if (i < bucati.length) c.enqueue(enc.encode(bucati[i++]))
      else c.close()
    },
  })
}

describe('sse — citirea fluxului de la creier', () => {
  it('citește evenimentele în ORDINE', async () => {
    const out: unknown[] = []
    await readSSE(flux(['data: {"n":1}\n\n', 'data: {"n":2}\n\n', 'data: {"n":3}\n\n']), (e) => out.push(e))
    expect(out).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it('reasamblează un eveniment TĂIAT între două pachete de rețea', async () => {
    // The real case that breaks naive parsers: the JSON arrives in two pieces.
    const out: unknown[] = []
    await readSSE(flux(['data: {"text":"buc', 'ată"}\n\n']), (e) => out.push(e))
    expect(out).toEqual([{ text: 'bucată' }])
  })

  it('ignoră [DONE], liniile goale și heartbeat-urile', async () => {
    const out: unknown[] = []
    await readSSE(flux(['\n', ': ping\n', 'data: {"a":1}\n\n', 'data: [DONE]\n\n']), (e) => out.push(e))
    expect(out).toEqual([{ a: 1 }])
  })

  it('refuză JSON corupt în loc să pretindă stream complet', async () => {
    const out: unknown[] = []
    await expect(readSSE(flux(['data: {rupt\n\n']), (e) => out.push(e))).rejects.toThrow('sse_invalid_json')
    expect(out).toEqual([])
  })

  it('flux gol → niciun eveniment, fără eroare', async () => {
    const out: unknown[] = []
    await readSSE(flux([]), (e) => out.push(e))
    expect(out).toEqual([])
  })

  it('mai multe evenimente într-un singur pachet', async () => {
    const out: unknown[] = []
    await readSSE(flux(['data: {"a":1}\n\ndata: {"b":2}\n\n']), (e) => out.push(e))
    expect(out).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('procesează ultimul eveniment chiar fără newline final', async () => {
    const out: unknown[] = []
    await readSSE(flux(['data: {"final":true}']), (e) => out.push(e))
    expect(out).toEqual([{ final: true }])
  })
})
