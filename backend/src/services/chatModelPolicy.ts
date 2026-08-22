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
  return opt.creierDublu && opt.turaGrea
    ? `${GEMINI_DIRECT_PREFIX}${opt.modelProfund}`
    : opt.modelChat
}
