// ── TESTELE CITITORULUI DE FLUX SSE (calea vorbirii în timp real) ───────────
//
// `readSSE` e sursa unică prin care curge răspunsul creierului, cuvânt cu cuvânt
// (OpenRouter ȘI Gemini). Dacă greșește parsarea, userul vede text rupt sau
// nimic — și nu dă eroare de compilare. Avea zero teste.
//
// Cazurile care CHIAR se întâmplă în rețea: un eveniment tăiat în două pachete,
// linii goale de heartbeat, `[DONE]`, JSON stricat.
import { describe, it, expect } from 'vitest'
import { readSSE } from './services/sse.js'

/** Un flux ca cel real, livrat în bucățile date (pot tăia un eveniment în două). */
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
    await readSSE(flux(['data: {"n":1}\n', 'data: {"n":2}\n', 'data: {"n":3}\n']), (e) => out.push(e))
    expect(out).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it('reasamblează un eveniment TĂIAT între două pachete de rețea', async () => {
    // Cazul real care rupe parserele naive: JSON-ul vine în două bucăți.
    const out: unknown[] = []
    await readSSE(flux(['data: {"text":"buc', 'ată"}\n']), (e) => out.push(e))
    expect(out).toEqual([{ text: 'bucată' }])
  })

  it('ignoră [DONE], liniile goale și heartbeat-urile', async () => {
    const out: unknown[] = []
    await readSSE(flux(['\n', ': ping\n', 'data: {"a":1}\n', 'data: [DONE]\n', '\n']), (e) => out.push(e))
    expect(out).toEqual([{ a: 1 }])
  })

  it('sare peste JSON stricat și CONTINUĂ (o bucată coruptă nu taie răspunsul)', async () => {
    const out: unknown[] = []
    await readSSE(flux(['data: {rup\n', 'data: {"ok":true}\n']), (e) => out.push(e))
    expect(out).toEqual([{ ok: true }])
  })

  it('flux gol → niciun eveniment, fără eroare', async () => {
    const out: unknown[] = []
    await readSSE(flux([]), (e) => out.push(e))
    expect(out).toEqual([])
  })

  it('mai multe evenimente într-un singur pachet', async () => {
    const out: unknown[] = []
    await readSSE(flux(['data: {"a":1}\ndata: {"b":2}\n']), (e) => out.push(e))
    expect(out).toEqual([{ a: 1 }, { b: 2 }])
  })
})
