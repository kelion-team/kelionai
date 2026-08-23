import { GEMINI_DIRECT_PREFIX } from './geminiDirect.js'

export function plafonUnelteFurnizor(model: string | null | undefined): 64 | 128 {
  return model?.startsWith(GEMINI_DIRECT_PREFIX) ? 128 : 64
}

export interface OptiuniModelOrchestrator {
  modelChat: string
  creierDublu: boolean
  turaGrea: boolean
  modelProfund: string
}

export function alegeModelOrchestrator(opt: OptiuniModelOrchestrator): string {
  // COMUTATOR DE CREIER (23 aug 2026): creierDublu (Gemini Pro) se aplică DOAR
  // când modelul de chat e Gemini. Pe OpenAI, modelul ales de selectedBrainModel
  // e deja treapta corectă (luna/medium/heavy/max) — nu-l suprascriem cu Gemini.
  if (opt.modelChat.startsWith(GEMINI_DIRECT_PREFIX) && opt.creierDublu && opt.turaGrea) {
    return `${GEMINI_DIRECT_PREFIX}${opt.modelProfund}`
  }
  return opt.modelChat
}
