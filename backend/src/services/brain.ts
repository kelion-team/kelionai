import { config } from '../config.js'
import { openrouterChat } from './openrouter.js'
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
export async function describeScene(imageDataUrl: string, question?: string): Promise<string> {
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
    return r.text.trim()
  } catch {
    return ''
  }
}

// Un răspuns text scurt de la creier (mailbox, admin). Gol la eșec — nu aruncă.
export async function brainComplete(prompt: string, maxTokens = 1024): Promise<string> {
  try {
    const r = await openrouterChat(workModel(), [{ role: 'user', content: prompt }], [], {
      maxTokens,
    })
    return r.text.trim()
  } catch {
    return ''
  }
}

// Verifică modelele implicite (chat + work) cu un ping real prin OpenRouter.
export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (model: string): Promise<string> => {
    try {
      const r = await openrouterChat(model, [{ role: 'user', content: 'Reply with the single word: ok' }], [], {
        maxTokens: 16,
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
