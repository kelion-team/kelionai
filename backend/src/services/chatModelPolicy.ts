export function plafonUnelteFurnizor(model: string | null | undefined): 64 | 128 {
  return model?.startsWith('openai/') ? 128 : 64
}

export interface OptiuniModelOrchestrator {
  modelChat: string
  creierDublu: boolean
  turaGrea: boolean
  modelProfund: string
}

export function alegeModelOrchestrator(opt: OptiuniModelOrchestrator): string {
  // OpenAI-only: selectedBrainModel has already selected the right rung.
  return opt.modelChat
}
