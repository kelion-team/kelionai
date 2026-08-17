// ?? CREIER DE RA?IONAMENT UNITAR (owner 17 aug) ?????????????????????????????
// LEGE: absolut TOATE rutele/serviciile care G?NDESC trec pe aici.
// Free sau pl?tit = acela?i contract de ra?ionament; difer? doar treapta/modelul.
// Execu?ia (Aider, unelte, TTS) r?m?ne ?n afar? ? m?na, nu al doilea creier.
//
// U?a unic?:
//   rationeaza()           ? text scurt (mailbox, cerin?e, constructor plan?)
//   rationeazaCuUnelte()   ? bucl? cu tools (autonomie, escaladare grea)
//   rationeazaMesaje()     ? mesaje multimodale / custom (jobs CV, agen?i, iscoad??)
//   planificaPasiMici()    ? plan FILES/STEPS/CHECK pentru Aider (free SAU pl?tit)
//
// Interzis ?n restul app-ului: apel direct geminiDirectChat/brainComplete pentru
// ra?ionament de produs, f?r? a trece pe creierRationament (except: probe/ping
// tehnice ?i sesiunea LIVE WebSocket care e canal realtime, nu completion).

import { config } from '../config.js'
import {
  brainComplete,
  brainCompleteWithTools,
  expertModelLadder,
  runBrainLadder,
} from './brain.js'
import { GEMINI_DIRECT_PREFIX, geminiDirectChat, geminiDirectChatStream } from './geminiDirect.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage } from './brainContract.js'

export type TreaptaRationament = 'rapid' | 'lucru' | 'plan'

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

function modelPentru(treapta: TreaptaRationament): string {
  if (treapta === 'rapid') return config.brain.chatDefault
  // lucru + plan: creierul de munc? (Pro / unic) ? acela?i pentru chat greu, autonomie, plan constructor
  return config.brain.workDefault
}

function codModel(m: string): string {
  return m.startsWith(GEMINI_DIRECT_PREFIX) ? m.slice(GEMINI_DIRECT_PREFIX.length) : m
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
  jurnal(opts.ruta, treapta, `maxTokens=${maxTokens}`)
  if (treapta === 'rapid') {
    const r = await rationeazaMesaje([{ role: 'user', content: prompt }], {
      ruta: opts.ruta,
      maxTokens,
      treapta: 'rapid',
      onCost: opts.onCost,
      reasoning: 'low',
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
  jurnal(opts.ruta, treapta, `tools=${tools.length} rounds=${opts.maxRounds ?? 6}`)
  return brainCompleteWithTools(prompt, tools, execTool, {
    maxTokens: opts.maxTokens ?? 2000,
    maxRounds: opts.maxRounds,
    onCost: opts.onCost,
    models: opts.models ?? expertModelLadder(),
  })
}

/**
 * Ra?ionament pe mesaje (multimodal / system+user).
 * ?nlocuie?te geminiDirectChat() ?n rutele de produs.
 */
export async function rationeazaMesaje(
  messages: OrMessage[],
  opts: OptiuniRationament & { tools?: AnthropicTool[]; stream?: false; /** model forțat (google-direct/* sau ollama-cloud/*) */ model?: string },
): Promise<OrChatResult> {
  const treapta = opts.treapta ?? 'lucru'
  // MODEL FORȚAT (17 aug): orchestratorul trecea modelul, dar ușa unitară îl
  // arunca și folosea mereu defaultul treptei → Creier 2 / creierDublu erau
  // moarte pe chat. Acum `opts.model` câștigă când e dat.
  const modelFull = opts.model || modelPentru(treapta)
  const model = codModel(modelFull)
  jurnal(opts.ruta, treapta, `mesaje=${messages.length} model=${modelFull}`)
  const callOpts: BrainCallOpts = {
    maxTokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature,
    reasoning: opts.reasoning ?? (treapta === 'rapid' ? 'low' : 'medium'),
    toolChoice: opts.toolChoice,
    allowedFunctionNames: opts.allowedFunctionNames,
    timeoutMs: opts.timeoutMs,
  }
  // Cloud Ollama (Creier 2) — o singură încercare pe modelul ales; fără scară Gemini.
  if (modelFull.startsWith('ollama-cloud/')) {
    const { ollamaCloudChat } = await import('./ollamaCloud.js')
    return ollamaCloudChat(modelFull, messages, opts.tools ?? [], callOpts)
  }
  // Scară: modelul treptei/forțat, apoi restul expert ladder (fără dubluri)
  const ladder = [modelFull, ...expertModelLadder().filter((m) => m !== modelFull)]
  return runBrainLadder(ladder, async (m) => {
    const cod = codModel(m)
    return geminiDirectChat(cod, messages, opts.tools ?? [], callOpts)
  })
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
  const modelFull = opts.model || modelPentru(treapta)
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
  if (modelFull.startsWith('ollama-cloud/')) {
    const { ollamaCloudChatStream } = await import('./ollamaCloud.js')
    return ollamaCloudChatStream(modelFull, messages, opts.tools ?? [], onText, callOpts)
  }
  return geminiDirectChatStream(model, messages, opts.tools ?? [], onText, callOpts)
}

export interface PlanPasiMici {
  plan: string
  files: string[]
  ok: boolean
}

/**
 * Plan FILES/STEPS/CHECK ? folosit de constructor pe free ?I pl?tit,
 * ?i de orice rut? care preg?te?te munc? pentru Aider/m?ini.
 */
export async function planificaPasiMici(
  ordin: string,
  esuat = '',
  ruta = 'constructor.plan',
): Promise<PlanPasiMici> {
  const o = String(ordin || '').trim().slice(0, 2500)
  if (!o) return { plan: '', files: [], ok: false }
  const prompt =
    'You are the SINGLE unitary reasoning brain of Kelion.\n' +
    'Help Aider (local free OR paid cloud) with SMALL specific steps.\n' +
    'Format EXACTLY:\n' +
    'FILES:\n- path/one.ts\n- path/two.ts\n' +
    'STEPS:\n1) ...\n2) ...\n' +
    'CHECK:\n- command or condition\n' +
    'Rules: max 6 files, max 10 steps, minimal diff, no second philosophy, no OpenRouter.\n\n' +
    `ORDER:\n${o}\n\n` +
    (esuat ? `WHAT FAILED / LOG TAIL:\n${String(esuat).slice(0, 1500)}\n` : '')
  const plan = (await rationeaza(prompt, { ruta, maxTokens: 700, treapta: 'plan' })).trim().slice(0, 2500)
  const files = [
    ...plan.matchAll(/(?:^|\n)\s*[-*]?\s*([\w./-]+\.(?:ts|tsx|js|mjs|cjs|json|md|css|yml|yaml))/g),
  ]
    .map((m) => m[1])
    .filter((f, i, a) => a.indexOf(f) === i)
    .slice(0, 6)
  return { plan, files, ok: !!plan }
}

/** Re-export trepte pentru panou/status ? o singur? surs?. */
export function trepteCreier(): { rapid: string; lucru: string } {
  return {
    rapid: config.brain.chatDefault,
    lucru: config.brain.workDefault,
  }
}
