import { GEMINI_DIRECT_PREFIX } from './geminiDirect.js'
import { OLLAMA_CLOUD_PREFIX } from './ollamaCloud.js'

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
  if (opt.modelChat.startsWith(OLLAMA_CLOUD_PREFIX)) return opt.modelChat
  return opt.creierDublu && opt.turaGrea
    ? `${GEMINI_DIRECT_PREFIX}${opt.modelProfund}`
    : opt.modelChat
}
