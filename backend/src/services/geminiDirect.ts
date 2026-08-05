import { config } from '../config.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrImage, OrMessage, OrToolCall } from './brainContract.js'
import { readSSE } from './sse.js'

// ── CREIERUL UNIC: GEMINI DIRECT DE LA GOOGLE ───────────────────────────────
// (Extirparea totală OpenRouter + OpenAI, 3 aug: „openrouter și open ai scos
// din toată aplicația".) Cheia Tier 2 a ownerului (AI Studio) dă
// gemini-2.5-flash/pro cu vedere+unelte+gândire. Aici e clientul direct pe
// API-ul Google (generativelanguage); formele de intrare/ieșire sunt
// contractul casei (services/brainContract.ts). Nu mai există niciun furnizor
// secundar: dacă Gemini pică, tura se încheie onest (mesajul neutru din
// chat.ts), nu cade pe alt creier.

const G_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function geminiDirectAvailable(): boolean {
  return Boolean(config.geminiKey)
}

// ── PASTILA GEMINI: STARE LIVE (Adrian, 3 aug: „vreau să văd că am bani la
// gemini") ──────────────────────────────────────────────────────────────────
// Creditul prepay real (£11.58) NU e expus de niciun API Google — se vede DOAR
// pe pagina de facturare (verificat 3 aug: Cloud Billing dă doar numele/starea
// contului, nu soldul; nu există endpoint pentru soldul prepay). Semnalul ONEST
// măsurabil e un ping mic la generateContent cu cheia: 200 = cheia Tier 2
// servește (deci ai credit și merge). Un cont prepay GOL răspunde „prepayment
// credits are depleted" → roșu. Deci verde ✓ = bani+merge, roșu ⚠ = epuizat/
// stricat. Cache 5 min: pastila se cere la 15s, dar pingul real pleacă cel mult
// o dată la 5 min (cost neglijabil, ~1 token in/out).
export interface GeminiLive {
  /** verificarea s-a putut face (cheie prezentă + rețea a răspuns) */
  ok: boolean
  /** Gemini a răspuns 200 — Tier 2 activ, credit prezent */
  serving: boolean
  reason?: 'depleted' | 'quota' | 'error' | 'no_key'
}
let geminiLiveCache: { at: number; val: GeminiLive } | null = null
const GEMINI_LIVE_TTL_MS = 5 * 60_000
export async function geminiLive(): Promise<GeminiLive> {
  if (!config.geminiKey) return { ok: false, serving: false, reason: 'no_key' }
  const now = Date.now()
  if (geminiLiveCache && now - geminiLiveCache.at < GEMINI_LIVE_TTL_MS) return geminiLiveCache.val
  let val: GeminiLive
  try {
    const r = await fetch(`${G_BASE}/models/${config.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) {
      val = { ok: true, serving: true }
    } else {
      const body = (await r.text().catch(() => '')).toLowerCase()
      const reason: GeminiLive['reason'] = /prepay|deplet/.test(body)
        ? 'depleted'
        : r.status === 429 || /resource_exhausted|free_tier|quota/.test(body)
          ? 'quota'
          : 'error'
      val = { ok: true, serving: false, reason }
    }
  } catch {
    // rețea/timeout — NECITIBIL (nu „nu merge"): pastila scrie „Gemini ⚠",
    // niciodată o stare inventată.
    val = { ok: false, serving: false, reason: 'error' }
  }
  geminiLiveCache = { at: now, val }
  return val
}

/** The internal prefix of every brain model id — the orchestrator refuses
 *  anything else (Gemini-only, 3 aug). */
export const GEMINI_DIRECT_PREFIX = 'google-direct/'

interface GPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  inline_data?: { mime_type: string; data: string }
  /** Gemini 3.x: semnătura de gândire de pe apelurile de unelte — se păstrează
   *  și se retrimite la replay (wo-msex5yey). */
  thoughtSignature?: string
}
interface GContent {
  role: 'user' | 'model'
  parts: GPart[]
}

// The tools' JSON schema → the schema Gemini accepts (we keep only the
// supported keys; the rest is silently dropped, it doesn't break the call).
function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema)
  if (!s || typeof s !== 'object') return s
  const keep = ['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable']
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (!keep.includes(k)) continue
    out[k] = k === 'properties' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, cleanSchema(pv)]))
      : cleanSchema(v)
  }
  return out
}

/** OrMessage[] (the house format) → the Gemini body. Exported for tests. */
export function toGeminiPayload(
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts = {},
  model = '',
): Record<string, unknown> {
  const sys: string[] = []
  const contents: GContent[] = []
  // functionResponse requires the function NAME; role:'tool' messages only
  // have the id — we rebuild the id→name map from the assistant's earlier
  // tool_calls.
  const idToName = new Map<string, string>()
  for (const m of messages) {
    for (const c of m.tool_calls ?? []) idToName.set(c.id, c.function.name)
  }
  for (const m of messages) {
    if (m.role === 'system') {
      sys.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      continue
    }
    if (m.role === 'tool') {
      const name = idToName.get(m.tool_call_id ?? '') ?? 'tool'
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: String(m.content ?? '') } } }],
      })
      continue
    }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user'
    const parts: GPart[] = []
    if (typeof m.content === 'string') {
      if (m.content) parts.push({ text: m.content })
    } else if (Array.isArray(m.content)) {
      // Multimodal in OpenAI format (text + image_url + audio_url, all as
      // data-URIs) → Gemini parts. AUDIO NATIV (Adrian, 3 aug: „deep learning
      // legat de creier direct"): Gemini 2.5 e nativ multimodal pe voce — primește
      // audio-ul BRUT (inline_data audio/*) și îl „aude" (ton, accent, pauze),
      // fără să depindă de un STT care poate stâlci („E surt hanspuskelion").
      // Fezabilitate dovedită pe cheia serverului (promptTokensDetails: AUDIO).
      for (const b of m.content as {
        type: string
        text?: string
        image_url?: { url?: string }
        audio_url?: { url?: string }
      }[]) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text })
        else if (b.type === 'image_url' && b.image_url?.url) {
          const mm = /^data:([^;]+);base64,(.+)$/.exec(b.image_url.url)
          if (mm) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } })
        } else if (b.type === 'audio_url' && b.audio_url?.url) {
          const mm = /^data:([^;]+);base64,(.+)$/.exec(b.audio_url.url)
          if (mm) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } })
        }
      }
    }
    for (const c of m.tool_calls ?? []) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
      } catch {
        /* corrupted arguments — we go with {} */
      }
      parts.push({ functionCall: { name: c.function.name, args } })
    }
    if (!parts.length) continue
    contents.push({ role, parts })
  }

  // GEMINI 3.x „gândește" cu tokeni care INTRĂ în maxOutputTokens (măsurat 5 aug:
  // gemini-3.1-pro la maxTok=200 → finish=MAX_TOKENS, text tăiat; la 2048 → STOP,
  // complet). Deci pe 3.x ridicăm PODEAUA de output la 2048, ca gândirea să nu
  // înfometeze textul (altfel răspunsul iese GOL — exact ce trebuie evitat când
  // creierul e Pro peste tot).
  const este3x = /gemini-3/.test(model)
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: este3x ? Math.max(opts.maxTokens ?? 1024, 2048) : (opts.maxTokens ?? 1024),
    temperature: opts.temperature ?? 0.7,
  }
  // gemini-2.5's internal thinking: small budget by default so the first word
  // comes FAST (the latency rule); more only on heavy turns.
  // ONLY for the 2.5 family: gemini-3.x REJECTS thinkingConfig.thinkingBudget
  // with HTTP 400 — measured live on 4 Aug ("[brain] gemini-3.6-flash failed
  // (gemini 400)" on EVERY chat turn, the app looked completely dead). Without
  // the field, 3.x answers 200 (also measured). Callers pass the model in.
  if (/gemini-2\.5/.test(model)) {
    generationConfig.thinkingConfig = {
      thinkingBudget: opts.reasoning === 'high' ? 4096 : opts.reasoning === 'medium' ? 1024 : opts.reasoning === 'low' ? 512 : 0,
    }
  } else if (este3x) {
    // Gemini 3.x nu acceptă thinkingBudget (400), DAR acceptă thinkingLevel
    // (măsurat 5 aug: thinkingLevel:'low' → HTTP 200). 'low' ține latența jos și
    // lasă bugetul de output pentru text; 'high' doar când se cere raționament greu.
    generationConfig.thinkingConfig = { thinkingLevel: opts.reasoning === 'high' ? 'high' : 'low' }
  }
  const body: Record<string, unknown> = { contents, generationConfig }
  if (sys.length) body.systemInstruction = { parts: [{ text: sys.join('\n\n') }] }
  if (tools.length) {
    // EMPTY-SCHEMA GUARD (wo-msex5yey, 4 Aug — mirrors constructor-agent.mjs):
    // a no-argument tool used to send `parameters:{type:'object',properties:{}}`;
    // gemini-2.5 tolerates it, newer models reject it with 400 ("properties:
    // should be non-empty for OBJECT type"). A function with no arguments is
    // valid WITHOUT the `parameters` field — so omit it when properties is empty.
    body.tools = [{
      functionDeclarations: tools.map((t) => {
        const d: Record<string, unknown> = { name: t.name, description: t.description }
        const p = cleanSchema(t.input_schema) as { properties?: Record<string, unknown> }
        if (p?.properties && Object.keys(p.properties).length) d.parameters = p
        return d
      }),
    }]
    body.toolConfig = { functionCallingConfig: { mode: opts.toolChoice === 'required' ? 'ANY' : 'AUTO' } }
  }
  return body
}

interface GResp {
  candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[]
  /** REAL token counts, present on the final response/chunk. */
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { code?: number; message?: string; status?: string }
}

function partsToResult(
  parts: GPart[],
  model: string,
  stop: string,
  usage?: GResp['usageMetadata'],
): OrChatResult {
  let text = ''
  const toolCalls: OrToolCall[] = []
  for (const p of parts) {
    if (p.text) text += p.text
    if (p.functionCall) {
      const tc: OrToolCall = {
        id: `g_${toolCalls.length}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
      }
      // Gemini 3.x cere semnătura înapoi la replay (wo-msex5yey) — o păstrăm.
      if (p.thoughtSignature) tc.thoughtSignature = p.thoughtSignature
      toolCalls.push(tc)
    }
  }
  // COSTUL PE CHEIA PLĂTITĂ (agenții de debug, 3 aug, verdict REAL: „costUsd: 0
  // hardcodat" era o cifră FALSĂ după trecerea pe Tier 2 — cheia nu mai e
  // gratuită, iar 0 se înregistra ca „măsurat" în jurnal). Google nu întoarce
  // dolari în răspuns; ce e MĂSURAT sunt tokenii (usageMetadata). Prețul e
  // tariful publicat, scris aici de mână → produsul e o ESTIMARE și e
  // etichetat așa în jurnal (db.ts a scos 'gemini' din COSTURI_MASURATE).
  // Tarife USD / 1M tokeni (Google, publicate): flash 0.30 in / 2.50 out;
  // pro 1.25 in / 10.00 out. Audio-ul la intrare costă mai mult (1.00 flash) —
  // numărăm tot promptul la tariful de text, deci turele cu voce sunt ușor
  // SUBestimate; e o estimare declarată, nu o factură.
  const inTok = Number(usage?.promptTokenCount ?? 0) || 0
  const outTok = Number(usage?.candidatesTokenCount ?? 0) || 0
  const ePro = /pro/i.test(model)
  const costUsd = (inTok * (ePro ? 1.25 : 0.3) + outTok * (ePro ? 10 : 2.5)) / 1_000_000
  return {
    text, toolCalls, costUsd, model, stop,
    inputTokens: inTok,
    outputTokens: outTok,
  }
}

// The shared Gemini call (non-stream + stream): x-goog-api-key headers +
// toGeminiPayload body + timeout. It differs ONLY by the method suffix
// (generateContent vs streamGenerateContent?alt=sse). Single source (the
// permanent principle: unique, no duplicates).
function geminiFetch(
  model: string,
  method: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
): Promise<Response> {
  return fetch(`${G_BASE}/models/${model}:${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify(toGeminiPayload(messages, tools, opts, model)),
    signal: AbortSignal.timeout(120_000),
  })
}

export async function geminiDirectChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!config.geminiKey) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key', inputTokens: 0, outputTokens: 0 }
  const r = await geminiFetch(model, 'generateContent', messages, tools, opts)
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
  // Corp 200 dar ne-JSON (proxy/gateway stricat) → eroare NUMITĂ, nu SyntaxError
  // scăpat prin rotație ca „model mort" (agenții de debug, 3 aug — restul
  // clientului avea .catch, doar calea asta nu).
  const j = (await r.json().catch(() => {
    throw new Error('gemini_body_not_json')
  })) as GResp
  const cand = j.candidates?.[0]
  return partsToResult(cand?.content?.parts ?? [], model, cand?.finishReason ?? 'stop', j.usageMetadata)
}

// The STREAMING variant (SSE): the text flows through onText (first word
// instantly), the tool calls are collected from chunks — the same OrChatResult
// contract as the non-streaming call.
export async function geminiDirectChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!config.geminiKey) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key', inputTokens: 0, outputTokens: 0 }
  const r = await geminiFetch(model, 'streamGenerateContent?alt=sse', messages, tools, opts)
  if (!r.ok || !r.body) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)

  let text = ''
  const collected: GPart[] = []
  let stop = 'stop'
  let usage: GResp['usageMetadata']
  // The SSE stream reading comes from the shared source (services/sse.ts);
  // the event processing (Gemini format: candidates/parts) stays here.
  await readSSE(r.body, (raw) => {
    const ev = raw as GResp
    if (ev.usageMetadata) usage = ev.usageMetadata // the final chunk carries it
    const cand = ev.candidates?.[0]
    if (cand?.finishReason) stop = cand.finishReason
    for (const p of cand?.content?.parts ?? []) {
      if (p.text) {
        text += p.text
        onText(p.text)
      }
      if (p.functionCall) collected.push(p)
    }
  })
  const res = partsToResult(collected, model, stop, usage)
  return { ...res, text }
}

/** Free quota exhausted / service unavailable — a TRANSIENT provider state
 *  (worth a retry / a clear log line), not a broken request of ours. */
export function isGeminiQuotaError(e: unknown): boolean {
  return /gemini (429|500|503)|RESOURCE_EXHAUSTED|quota/i.test(String(e))
}

// ── IMAGE through GEMINI DIRECT (the owner's Gemini key; OpenRouter removed) ──
// Adrian, 3 aug: image generation moves off OpenRouter onto the SAME Google key
// that powers the brain (config.geminiKey) — total OpenRouter removal. Two
// endpoints are tried in order and the FIRST that returns real image bytes wins:
//   1) Imagen predict     — bytes at predictions[0].bytesBase64Encoded
//   2) Gemini image model — bytes inline at candidates[0].content.parts[].inlineData.data
// Return shape: OrImage (brainContract.ts) — mime + bytes, so image.ts's
// storage/URL logic is unchanged. costUsd is 0 — these endpoints report no
// per-call cost, and an unmeasured number would be a fabrication (rule no. 1).
const IMAGEN_MODEL = 'imagen-3.0-generate-002'
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image'

/** Imagen's predict endpoint. Bytes on success, null on any miss (missing key
 *  is handled by the caller). */
async function imagenPredict(prompt: string): Promise<{ mime: string; buf: Buffer } | null> {
  let r: Response
  try {
    r = await fetch(`${G_BASE}/models/${IMAGEN_MODEL}:predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    // Eșecul se NUMEȘTE în jurnal (agenții de debug, 3 aug: null la orice —
    // rețea, 403, 429 — făcea cauza de negăsit; „image_not_configured" mințea).
    console.error(`[imagine] Imagen predict a picat: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
  if (!r.ok) {
    console.error(`[imagine] Imagen predict HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    return null
  }
  const j = (await r.json().catch(() => ({}))) as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[]
  }
  const p = j.predictions?.[0]
  if (!p?.bytesBase64Encoded) return null
  return { mime: p.mimeType || 'image/png', buf: Buffer.from(p.bytesBase64Encoded, 'base64') }
}

/** The Gemini image model (generateContent, IMAGE modality). The bytes arrive
 *  inline in a part; REST responses use camelCase `inlineData`, but we accept
 *  the snake_case form too so a shape change can't silently blank us out. */
async function geminiImageContent(prompt: string): Promise<{ mime: string; buf: Buffer } | null> {
  let r: Response
  try {
    r = await fetch(`${G_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    console.error(`[imagine] Gemini image a picat: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
  if (!r.ok) {
    console.error(`[imagine] Gemini image HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    return null
  }
  const j = (await r.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: {
      inlineData?: { data?: string; mimeType?: string }
      inline_data?: { data?: string; mime_type?: string }
    }[] } }[]
  }
  for (const part of j.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data ?? part.inline_data?.data
    if (data) {
      const mime = part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png'
      return { mime, buf: Buffer.from(data, 'base64') }
    }
  }
  return null
}

/** Image generation on the owner's Gemini key. Tries Imagen, then the Gemini
 *  image model, and returns the FIRST that yields bytes — as OrImage
 *  (brainContract.ts) so image.ts is unchanged.
 *  COSTUL (agenții de debug, 3 aug, verdict REAL: 0 hardcodat ținea imaginile
 *  în afara jurnalului — `if (costUsd > 0)` nu înregistra nimic pe cheia
 *  PLĂTITĂ): Google nu întoarce dolari; punem tariful PUBLICAT per imagine
 *  (Imagen 3: $0.03; jurnalul îl etichetează „estimare internă" — 'image' a
 *  ieșit din COSTURI_MASURATE în db.ts). All-fail → eroarea spune că
 *  GENERAREA a picat (cauzele exacte sunt în log, numite), nu că „nu e
 *  configurat" când cheia există. */
const IMAGE_USD_ESTIMAT = 0.03
export async function geminiImage(prompt: string): Promise<OrImage> {
  if (!config.geminiKey) return { error: 'image_not_configured' }
  const hit = (await imagenPredict(prompt)) ?? (await geminiImageContent(prompt))
  if (!hit) return { error: 'image_generation_failed' }
  return { mime: hit.mime, buf: hit.buf, costUsd: IMAGE_USD_ESTIMAT }
}
