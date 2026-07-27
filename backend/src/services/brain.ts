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

function workModel(): string {
  return config.openrouter.workDefault
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
      const r = await openrouterChat(params.model || workModel(), msgs, [], {
        maxTokens: params.max_tokens,
      })
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
    // de răspuns (Fable 5) — cerința lui Adrian „raționament adevărat, complet".
    const r = await openrouterChat(workModel(), [{ role: 'user', content: prompt }], [], {
      maxTokens,
      reasoning: 'medium',
    })
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
  opts: { maxTokens?: number; maxRounds?: number; onCost?: (usd: number) => void; forceFirstRound?: boolean } = {},
): Promise<string> {
  const maxRounds = opts.maxRounds ?? 6
  const messages: OrMessage[] = [{ role: 'user', content: prompt }]
  try {
    for (let round = 0; round < maxRounds; round++) {
      // FORȚAREA UNELTEI ȘI ÎN VOCE (Adrian, 27 iul: „inclusiv forțarea de
      // unelte"): pe turele de acțiune ale ownerului (instalează/construiește/
      // caută în sursă...), prima rundă e obligată să cheme o unealtă — execută,
      // nu doar descrie. Rundele următoare revin la 'auto'.
      const r = await openrouterChat(workModel(), messages, tools, {
        maxTokens: opts.maxTokens ?? 2000,
        reasoning: 'medium',
        toolChoice: opts.forceFirstRound && round === 0 && tools.length ? 'required' : undefined,
      })
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
    const last = await openrouterChat(workModel(), messages, [], { maxTokens: opts.maxTokens ?? 2000 })
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
