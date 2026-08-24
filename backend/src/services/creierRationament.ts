// ?? CREIER DE RA?IONAMENT UNITAR (owner 17 aug) ?????????????????????????????
// LEGE: absolut TOATE rutele/serviciile care G?NDESC trec pe aici.
// Free sau pl?tit = acela?i contract de ra?ionament; difer? doar treapta/modelul.
// Execu?ia (Aider, unelte, TTS) r?m?ne ?n afar? ? m?na, nu al doilea creier.
//
// U?a unic?:
//   rationeaza()           ? text scurt (mailbox, cerin?e, constructor plan?)
//   rationeazaCuUnelte()   ? bucl? cu tools (autonomie, escaladare grea)
//   rationeazaMesaje()     ? mesaje multimodale / custom (jobs CV, agen?i, iscoad??)
//
// Interzis ?n restul app-ului: apel direct geminiDirectChat/brainComplete pentru
// ra?ionament de produs, f?r? a trece pe creierRationament (except: probe/ping
// tehnice ?i sesiunea LIVE WebSocket care e canal realtime, nu completion).

import { config } from '../config.js'
import {
  brainChat,
  brainComplete,
  brainCompleteWithTools,
  creierActivKv,
  expertModelLadder,
  runBrainLadder,
} from './brain.js'
import { GEMINI_DIRECT_PREFIX, geminiDirectChat, geminiDirectChatStream } from './geminiDirect.js'
import { openaiChatStream } from './openaiChat.js'
import { modelOpenAI } from './openaiModele.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage } from './brainContract.js'

export type TreaptaRationament = 'rapid' | 'lucru' | 'profund' | 'ultra' | 'plan'

export interface OptiuniRationament {
  /** Cine cheamă — obligatoriu pentru jurnal unitar (rută/serviciu). */
  ruta: string
  maxTokens?: number
  treapta?: TreaptaRationament
  onCost?: (usd: number) => void
  temperature?: number
  reasoning?: 'low' | 'medium' | 'high'
  /** Forțează modelul (google-direct/* sau ollama-cloud/*). Fără el = treapta. */
  model?: string
  toolChoice?: BrainCallOpts['toolChoice']
  allowedFunctionNames?: string[]
  timeoutMs?: number
}

// COMUTATOR REAL: modelPentru respectă creier_activ. Pe OpenAI returnează
// treptele OpenAI (luna/medium/heavy/max), pe Gemini pe cele Gemini.
async function modelPentru(treapta: TreaptaRationament, activ: string): Promise<string> {
  if (activ === 'openai') {
    const treaptaOpenAI = treapta === 'rapid'
      ? 'luna'
      : treapta === 'lucru'
        ? 'medium'
        : treapta === 'profund'
          ? 'heavy'
          : treapta === 'ultra'
            ? 'max'
            : 'medium'
    const model = await modelOpenAI(treaptaOpenAI)
    if (model) return `openai/${model}`
  }
  if (treapta === 'rapid') return config.brain.chatDefault
  if (treapta === 'lucru') return config.brain.workDefault
  if (treapta === 'profund') return config.brain.profundDefault
  if (treapta === 'ultra') return config.brain.ultraDefault
  return config.brain.workDefault
}

function codModel(m: string): string {
  return m.startsWith(GEMINI_DIRECT_PREFIX) ? m.slice(GEMINI_DIRECT_PREFIX.length) : m
}

// reutilizare-permis: jurnalul local atașează treapta și modelul la contractul
// unitar de raționament; jurnalul din rută are alt scop.
function jurnal(ruta: string, treapta: string, extra = ''): void {
  console.log(`[CREIER-UNITAR] ruta=${ruta} treapta=${treapta}${extra ? ' ' + extra : ''}`)
}

/**
 * Ra?ionament text unitar ? SINGURA u?? pentru completion f?r? unelte.
 * ?nlocuie?te brainComplete() ?n rute/servicii.
 */
export async function rationeaza(
  prompt: string,
  opts: OptiuniRationament,
): Promise<string> {
  const treapta = opts.treapta ?? 'lucru'
  const maxTokens = opts.maxTokens ?? 1024
  jurnal(opts.ruta, treapta, `maxTokens=${maxTokens} model=${opts.model ?? 'default'}`)
  if (treapta === 'rapid' || opts.model) {
    const r = await rationeazaMesaje([{ role: 'user', content: prompt }], {
      ruta: opts.ruta,
      maxTokens,
      treapta,
      onCost: opts.onCost,
      temperature: opts.temperature,
      reasoning: opts.reasoning ?? (treapta === 'rapid' ? 'low' : 'medium'),
      model: opts.model,
    })
    if (opts.onCost && r.costUsd > 0) opts.onCost(r.costUsd)
    return (r.text || '').trim()
  }
  return brainComplete(prompt, maxTokens, opts.onCost)
}


/**
 * Ra?ionament cu unelte ? autonomie, escalad?ri grele.
 * ?nlocuie?te brainCompleteWithTools() la apelan?i de produs.
 */
export async function rationeazaCuUnelte(
  prompt: string,
  tools: AnthropicTool[],
  execTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: OptiuniRationament & { maxRounds?: number; models?: string[] },
): Promise<string> {
  const treapta = opts.treapta ?? 'lucru'
  jurnal(opts.ruta, treapta, `tools=${tools.length} rounds=${opts.maxRounds ?? 6} model=${opts.model ?? 'default'}`)
  // Dacă e forțat un model, îl punem primul pe scară și cădem pe modelul de
  // lucru validat dacă epuizează cota sau refuză cererea.
  let models = opts.models ?? await expertModelLadder()
  if (opts.model) {
    // Respectă prefixul modelului forțat (poate fi openai/ sau google-direct/)
    const first = opts.model.startsWith('openai/') || opts.model.startsWith(GEMINI_DIRECT_PREFIX)
      ? opts.model
      : `${GEMINI_DIRECT_PREFIX}${codModel(opts.model)}`
    models = [first, ...models.filter((m) => m !== first)]
  }
  return brainCompleteWithTools(prompt, tools, execTool, {
    maxTokens: opts.maxTokens ?? 2000,
    maxRounds: opts.maxRounds,
    onCost: opts.onCost,
    models,
  })
}

/**
 * Ra?ionament pe mesaje (multimodal / system+user).
 * ?nlocuie?te geminiDirectChat() ?n rutele de produs.
 */
export async function rationeazaMesaje(
  messages: OrMessage[],
  opts: OptiuniRationament & { tools?: AnthropicTool[]; stream?: false; /** model forțat (google-direct/*) */ model?: string },
): Promise<OrChatResult> {
  const treapta = opts.treapta ?? 'lucru'
  // MODEL FORȚAT (17 aug): orchestratorul trecea modelul, dar ușa unitară îl
  // arunca și folosea mereu defaultul treptei → Creier 2 / creierDublu erau
  // moarte pe chat. Acum `opts.model` câștigă când e dat.
  const activ = opts.model
    ? (opts.model.startsWith('openai/') ? 'openai' : 'google-direct')
    : await creierActivKv()
  const modelFull = opts.model || await modelPentru(treapta, activ)
  jurnal(opts.ruta, treapta, `mesaje=${messages.length} model=${modelFull}`)
  const callOpts: BrainCallOpts = {
    maxTokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature,
    reasoning: opts.reasoning ?? (treapta === 'rapid' ? 'low' : 'medium'),
    toolChoice: opts.toolChoice,
    allowedFunctionNames: opts.allowedFunctionNames,
    timeoutMs: opts.timeoutMs,
  }
  // Scară: modelul treptei/forțat, apoi restul expert ladder (fără dubluri)
  const ladder = [modelFull, ...(await expertModelLadder()).filter((m) => m !== modelFull)]
  // COMUTATOR REAL: brainChat dispatch pe prefix (openai/ sau google-direct/)
  // — nu mai chemăm geminiDirectChat direct, ca să respecte creier_activ.
  return runBrainLadder(ladder, async (m) => {
    return brainChat(m, messages, opts.tools ?? [], callOpts)
  })
}

export async function rationeazaMesajeSigur(
  messages: OrMessage[],
  opts: Parameters<typeof rationeazaMesaje>[1],
): Promise<string | null> {
  try {
    return (await rationeazaMesaje(messages, opts)).text.trim() || null
  } catch {
    return null
  }
}

/**
 * Stream unitar pentru orchestratorul de chat (aceea?i scar?, acela?i jurnal).
 */
export async function rationeazaMesajeStream(
  messages: OrMessage[],
  onText: (delta: string) => void,
  opts: OptiuniRationament & {
    tools?: AnthropicTool[]
    model?: string
    toolChoice?: BrainCallOpts['toolChoice']
    allowedFunctionNames?: string[]
    timeoutMs?: number
  },
): Promise<OrChatResult> {
  const treapta = opts.treapta ?? 'lucru'
  const activ = opts.model
    ? (opts.model.startsWith('openai/') ? 'openai' : 'google-direct')
    : await creierActivKv()
  const modelFull = opts.model || await modelPentru(treapta, activ)
  const model = codModel(modelFull)
  jurnal(opts.ruta, treapta, `stream mesaje=${messages.length} model=${modelFull}`)
  const callOpts: BrainCallOpts = {
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    reasoning: opts.reasoning ?? (treapta === 'lucru' ? 'high' : 'medium'),
    toolChoice: opts.toolChoice,
    allowedFunctionNames: opts.allowedFunctionNames,
    timeoutMs: opts.timeoutMs,
  }
  // COMUTATOR REAL: stream-ul respectă prefixul modelului. Pe OpenAI folosim
  // openaiChatStream, pe Gemini geminiDirectChatStream.
  if (modelFull.startsWith('openai/')) {
    return openaiChatStream(codModel(modelFull), messages, opts.tools ?? [], onText, callOpts)
  }
  return geminiDirectChatStream(model, messages, opts.tools ?? [], onText, callOpts)
}

// (planificaPasiMici - protocolul JSON pentru Aider - a fost STERS cu toata
// masinaria constructorului local: owner, 22 aug, "sa-i stergi de tot".
// Constructorul e DEVIN; promptul lui se construieste in devinConstructor.ts.)
