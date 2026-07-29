import { config } from '../config.js'
import { openrouterChat } from './openrouter.js'
import type { AnthropicTool, OrMessage } from './openrouter.js'
import type { Message } from './brain-types.js'

// ── CREIERUL — 100% OpenRouter ──────────────────────────────────────────────
// Kimi și GLM SCOASE DEFINITIV (Adrian: „0 kimi, 0 glm, niciodată"). Tot creierul
// trece printr-o singură cheie OpenRouter (GPT/Gemini/Claude). Modelul de chat
// selectabil e gestionat în chat.ts (orchestrator); aici rămân doar utilitarele
// non-streaming folosite în afara chatului: memorie (agents), rezumate scurte
// (mailbox/admin) și verificarea cheii.


// ── EXPERTUL FIABIL (Etapa 1, ordin owner 29 iul) ────────────────────────────
// CAUZA (confirmată în cod + logurile constructorului): brainComplete/WithTools
// chemau `workModel()` O SINGURĂ DATĂ; la 429/saturare `:free`, openrouterChat
// arunca, iar `catch { return '' }` întorcea gol → „expertul nu răspunde"
// (exact simptomul raportat de Kelion). Acum expertul trece printr-o SCARĂ de
// modele gratuite (work → top → rezerve), sare peste cele saturate/moarte și
// răspunde de pe prima treaptă liberă. Doar dacă TOATĂ scara pică, tace — dar
// abia după ce a încercat tot, nu din prima. Aceeași cură ca la constructor.

// Eroare TRECĂTOARE (furnizor saturat/căzut) — merită să treci la alt model.
// 400/401/404 (cererea/cheia noastră) NU sunt aici: nu-s trecătoare, dar tot
// trecem la modelul următor (un nume greșit nu are voie să omoare expertul).
export function isTransientBrainError(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err)
  return /\b429\b|rate.?limit|resourceexhausted|degraded|provider returned error|openrouter (5\d\d|408|409)|timed? ?out|econnreset|etimedout|fetch failed/i.test(
    s,
  )
}

// Scara de modele a expertului: work → top → rezerve gratuite. Editabilă din env
// (OPENROUTER_EXPERT_FALLBACKS) fără deploy. Deduplicată, ordinea păstrată.
export function expertModelLadder(): string[] {
  const extra = (
    process.env.OPENROUTER_EXPERT_FALLBACKS ??
    'nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,cohere/north-mini-code:free'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const m of [config.openrouter.workDefault, config.openrouter.topDefault, ...extra]) {
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

// Rulează un apel pe scara de modele: încearcă fiecare treaptă, sare peste cele
// saturate/moarte, întoarce PRIMUL rezultat bun; aruncă ultima eroare doar dacă
// TOATE au picat. `sleep`/`now` injectabile pentru test. Buget total scurt —
// userul așteaptă expertul, nu-l ținem agățat pe toată scara la nesfârșit.
export async function runBrainLadder<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  opts: { budgetMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? ((): number => Date.now())
  const budgetMs = opts.budgetMs ?? 30_000
  const start = now()
  let lastErr: unknown = new Error('expert indisponibil (scară goală)')
  for (let i = 0; i < models.length; i++) {
    if (i > 0 && now() - start > budgetMs) break
    try {
      return await call(models[i])
    } catch (e) {
      lastErr = e
      // Pauză mică DOAR pe saturare (429) — dă furnizorului o clipă; pe eroare
      // definitivă (model greșit) trecem instant la următorul.
      if (i < models.length - 1 && isTransientBrainError(e)) await sleep(500)
    }
  }
  throw lastErr
}

// Adaptor minimal compatibil cu vechiul client (folosit de services/agents.ts):
// `.messages.create({ model, max_tokens, system?, messages })` → Message cu un
// singur bloc de text. Fără streaming (memorie/rezumate rulează în fundal).
export const brain = {
  messages: {
    create: async (params: {
      model?: string
      max_tokens?: number
      system?: string
      messages: { role: string; content: string }[]
    }): Promise<Message> => {
      const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
      if (params.system) msgs.push({ role: 'system', content: params.system })
      for (const m of params.messages) {
        msgs.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        })
      }
      // Scara de modele și aici (memorie/rezumate în fundal): un 429 nu mai lasă
      // memoria fără să învețe. Dacă s-a cerut un model anume, îl încearcă primul.
      const ladder = params.model
        ? [params.model, ...expertModelLadder().filter((m) => m !== params.model)]
        : expertModelLadder()
      const r = await runBrainLadder(ladder, (m) => openrouterChat(m, msgs, [], { maxTokens: params.max_tokens }))
      return {
        id: '',
        role: 'assistant',
        model: r.model,
        content: [{ type: 'text', text: r.text }],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Message
    },
  },
}

// VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"). În sesiunea Realtime (doar audio)
// Kelion n-avea ochi. Clientul capturează un cadru din cameră și-l trimite aici;
// îl dăm unui model cu vedere (GPT/Gemini prin OpenRouter) și întoarcem o
// descriere scurtă, naturală, de rostit cu voce. Gol la eșec — nu aruncă.
export async function describeScene(
  imageDataUrl: string,
  question?: string,
  onCost?: (usd: number) => void,
): Promise<string> {
  try {
    const r = await openrouterChat(
      config.openrouter.chatDefault,
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                question?.trim() ||
                'Privește prin camera utilizatorului și spune scurt și natural ce vezi ACUM, ca și cum te-ai uita chiar acum. Fără liste, fără markdown.',
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      [],
      { maxTokens: 400 },
    )
    if (onCost && r.costUsd > 0) onCost(r.costUsd)
    return r.text.trim()
  } catch {
    return ''
  }
}

// Un răspuns text scurt de la creier (mailbox, admin). Gol la eșec — nu aruncă.
// onCost (25 iul): vocea trebuie să DEBITEZE costul real al escaladării — fără
// callback, costul se pierdea și userul consuma creier gratis.
export async function brainComplete(
  prompt: string,
  maxTokens = 1024,
  onCost?: (usd: number) => void,
): Promise<string> {
  try {
    // reasoning medium (25 iul): creierul de escaladare GÂNDEȘTE real înainte
    // de răspuns — cerința lui Adrian „raționament adevărat, complet".
    // SCARA de modele (29 iul): la 429 pe treapta curentă, trece la următoarea,
    // nu mai tace din prima.
    const r = await runBrainLadder(expertModelLadder(), (m) =>
      openrouterChat(m, [{ role: 'user', content: prompt }], [], { maxTokens, reasoning: 'medium' }),
    )
    if (onCost && r.costUsd > 0) onCost(r.costUsd)
    return r.text.trim()
  } catch {
    return ''
  }
}

// ESCALADAREA CU UNELTE (Adrian, 27 iul: „Kelion nu poate vedea tot codul
// sursă al lui, de ce?" — vocea escalada spre un creier FĂRĂ unelte, care
// nega accesul). Buclă mică de tool-calling pe același model de lucru:
// modelul cheamă uneltele primite (sursă/DB/constructor...), primește
// rezultatele și abia apoi formulează răspunsul final.
export async function brainCompleteWithTools(
  prompt: string,
  tools: AnthropicTool[],
  execTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: { maxTokens?: number; maxRounds?: number; onCost?: (usd: number) => void } = {},
): Promise<string> {
  const maxRounds = opts.maxRounds ?? 6
  const messages: OrMessage[] = [{ role: 'user', content: prompt }]
  // Aceeași scară de modele ca brainComplete — fiecare RUNDĂ o încearcă, deci un
  // 429 pe o treaptă nu mai rupe toată bucla de unelte a expertului.
  const ladder = expertModelLadder()
  try {
    for (let round = 0; round < maxRounds; round++) {
      const r = await runBrainLadder(ladder, (m) =>
        openrouterChat(m, messages, tools, { maxTokens: opts.maxTokens ?? 2000, reasoning: 'medium' }),
      )
      if (opts.onCost && r.costUsd > 0) opts.onCost(r.costUsd)
      if (!r.toolCalls.length) return r.text.trim()
      messages.push({ role: 'assistant', content: r.text || '', tool_calls: r.toolCalls })
      for (const c of r.toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
        } catch {
          /* argumente stricate → unealta primește obiect gol */
        }
        const out = await execTool(c.function.name, args).catch((e: Error) => JSON.stringify({ error: e.message }))
        messages.push({ role: 'tool', tool_call_id: c.id, content: out.slice(0, 60_000) })
      }
    }
    // plafonul de runde atins — cerem răspunsul final fără alte unelte
    const last = await runBrainLadder(ladder, (m) =>
      openrouterChat(m, messages, [], { maxTokens: opts.maxTokens ?? 2000 }),
    )
    if (opts.onCost && last.costUsd > 0) opts.onCost(last.costUsd)
    return last.text.trim()
  } catch {
    return ''
  }
}

// Verifică modelele implicite (chat + work) cu un ping real prin OpenRouter.
export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (model: string): Promise<string> => {
    try {
      // 64, nu 16: modelele cu raționament intern (ex. claude-fable-5) consumă
      // tokeni din buget PE GÂNDIRE înainte de răspuns — dovadă live, 25 iul:
      // cu 16 tokeni, 11 s-au dus pe „reasoning_tokens" și conținutul a ieșit gol
      // (finish_reason:"length"), deci ping-ul raporta fals „fail" pe un model viu.
      const r = await openrouterChat(model, [{ role: 'user', content: 'Reply with the single word: ok' }], [], {
        maxTokens: 64,
      })
      return r.text ? `ok (served by ${r.model})` : 'fail'
    } catch {
      return 'fail'
    }
  }
  return {
    [config.openrouter.chatDefault]: await ping(config.openrouter.chatDefault),
    [config.openrouter.workDefault]: await ping(config.openrouter.workDefault),
  }
}

// Verifică cheia OpenRouter (o singură cheie pentru tot creierul).
export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  if (!config.openrouter.key) {
    return { primary: 'not_configured', reserve: 'not_configured', diag: { openrouterKeyLen: 0 } }
  }
  let primary = 'fail'
  try {
    const r = await openrouterChat(config.openrouter.chatDefault, [{ role: 'user', content: 'ping' }], [], {
      maxTokens: 1,
    })
    primary = r.model ? 'ok' : 'fail'
  } catch {
    primary = 'fail'
  }
  return { primary, reserve: primary, diag: { openrouterKeyLen: config.openrouter.key.length } }
}
