// ?? CREIER DE RA?IONAMENT UNITAR (owner 17 aug) ?????????????????????????????
// LEGE: absolut TOATE rutele/serviciile care G?NDESC trec pe aici.
// Free sau pl?tit = acela?i contract de ra?ionament; difer? doar treapta/modelul.
// Execu?ia (Aider, unelte, TTS) r?m?ne ?n afar? ? m?na, nu al doilea creier.
//
// U?a unic?:
//   rationeaza()           ? text scurt (mailbox, cerin?e, constructor plan?)
//   rationeazaCuUnelte()   ? bucl? cu tools (autonomie, escaladare grea)
//   rationeazaMesaje()     ? mesaje multimodale / custom
//
// Interzis ?n restul app-ului: apel direct la API pentru ra?ionament de produs,
// f?r? a trece pe creierRationament. Vocea live trece prin OpenAI Realtime.

import { config } from '../config.js'
import {
  brainChat,
  brainCompleteWithTools,
  expertModelLadder,
  OPENAI_PREFIX,
  runBrainLadder,
} from './brain.js'
import { openaiResponsesStream } from './openaiResponses.js'
import type { BrainTool, BrainCallOpts, OrChatResult, OrMessage } from './brainContract.js'

export type TreaptaRationament = 'rapid' | 'lucru' | 'profund' | 'ultra' | 'plan'

export interface OptiuniRationament {
  /** Cine cheamă — obligatoriu pentru jurnal unitar (rută/serviciu). */
  ruta: string
  maxTokens?: number
  treapta?: TreaptaRationament
  onCost?: (usd: number) => void
  temperature?: number
  reasoning?: BrainCallOpts['reasoning']
  /** Forțează un model permis din familia GPT-5.6. Fără el = treapta. */
  model?: string
  toolChoice?: BrainCallOpts['toolChoice']
  allowedFunctionNames?: string[]
  timeoutMs?: number
  usageContext?: BrainCallOpts['usageContext']
}

function modelPentru(treapta: TreaptaRationament): string {
  if (treapta === 'rapid') return `${OPENAI_PREFIX}${config.openai.luna}`
  if (treapta === 'lucru' || treapta === 'plan') return `${OPENAI_PREFIX}${config.openai.medium}`
  return `${OPENAI_PREFIX}${config.openai.heavy}`
}

function codModel(m: string): string {
  return m.startsWith(OPENAI_PREFIX) ? m.slice(OPENAI_PREFIX.length) : m
}

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
  const r = await rationeazaMesaje([{ role: 'user', content: prompt }], {
    ruta: opts.ruta,
    maxTokens,
    treapta,
    onCost: opts.onCost,
    temperature: opts.temperature,
    reasoning: opts.reasoning ?? (treapta === 'rapid' ? 'low' : 'medium'),
    model: opts.model,
  })
  if (opts.onCost && typeof r.costUsd === 'number' && r.costUsd > 0) opts.onCost(r.costUsd)
  return (r.text || '').trim()
}


/**
 * Ra?ionament cu unelte ? autonomie, escalad?ri grele.
 * ?nlocuie?te brainCompleteWithTools() la apelan?i de produs.
 */
export async function rationeazaCuUnelte(
  prompt: string,
  tools: BrainTool[],
  execTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: OptiuniRationament & { maxRounds?: number; models?: string[] },
): Promise<string> {
  const treapta = opts.treapta ?? 'lucru'
  jurnal(opts.ruta, treapta, `tools=${tools.length} rounds=${opts.maxRounds ?? 6} model=${opts.model ?? 'default'}`)
  // Dacă e forțat un model, îl punem primul pe scară și cădem pe modelul de
  // lucru validat dacă epuizează cota sau refuză cererea.
  let models = opts.models ?? await expertModelLadder()
  if (opts.model) {
    const first = opts.model.startsWith(OPENAI_PREFIX) ? opts.model : `${OPENAI_PREFIX}${opts.model}`
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
 * Mesaje multimodale și tool calling prin Responses API.
 */
export async function rationeazaMesaje(
  messages: OrMessage[],
  opts: OptiuniRationament & { tools?: BrainTool[]; stream?: false; model?: string },
): Promise<OrChatResult> {
  const treapta = opts.treapta ?? 'lucru'
  // MODEL FORȚAT (17 aug): orchestratorul trecea modelul, dar ușa unitară îl
  // arunca și folosea mereu defaultul treptei → Creier 2 / creierDublu erau
  // moarte pe chat. Acum `opts.model` câștigă când e dat.
  const modelFull = opts.model
    ? (opts.model.startsWith(OPENAI_PREFIX) ? opts.model : `${OPENAI_PREFIX}${opts.model}`)
    : modelPentru(treapta)
  jurnal(opts.ruta, treapta, `mesaje=${messages.length} model=${modelFull}`)
  const callOpts: BrainCallOpts = {
    maxTokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature,
    reasoning: opts.reasoning ?? (treapta === 'rapid' ? 'low' : 'medium'),
    toolChoice: opts.toolChoice,
    allowedFunctionNames: opts.allowedFunctionNames,
    timeoutMs: opts.timeoutMs,
    usageContext: opts.usageContext,
  }
  // Scară: modelul treptei/forțat, apoi restul expert ladder (fără dubluri)
  const ladder = [modelFull, ...(await expertModelLadder()).filter((m) => m !== modelFull)]
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
    tools?: BrainTool[]
    model?: string
    toolChoice?: BrainCallOpts['toolChoice']
    allowedFunctionNames?: string[]
    timeoutMs?: number
  },
): Promise<OrChatResult> {
  const treapta = opts.treapta ?? 'lucru'
  const modelFull = opts.model
    ? (opts.model.startsWith(OPENAI_PREFIX) ? opts.model : `${OPENAI_PREFIX}${opts.model}`)
    : modelPentru(treapta)
  const model = codModel(modelFull)
  jurnal(opts.ruta, treapta, `stream mesaje=${messages.length} model=${modelFull}`)
  const callOpts: BrainCallOpts = {
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    reasoning: opts.reasoning ?? (treapta === 'lucru' ? 'high' : 'medium'),
    toolChoice: opts.toolChoice,
    allowedFunctionNames: opts.allowedFunctionNames,
    timeoutMs: opts.timeoutMs,
    usageContext: opts.usageContext,
  }
  return openaiResponsesStream(model, messages, opts.tools ?? [], onText, callOpts)
}

// (planificaPasiMici - protocolul JSON pentru Aider - a fost STERS cu toata
// masinaria constructorului local: owner, 22 aug, "sa-i stergi de tot".
// Constructorul rulează separat; promptul de execuție nu intră în procesul web.)
