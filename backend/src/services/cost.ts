// Real-cost metering. Costul REAL al apelurilor de creier vine acum direct din
// OpenRouter (usage.cost, în chat.ts) — nu se mai estimează pe tokeni. Aici rămân
// doar utilitarele reziduale: Gemini (folosit în corectură), Chirp TTS/STT,
// Serper, imagini. Cifrele sunt ADMIN-ONLY (banii reali dedesubt), separate de
// creditul afișat userului.

interface ModelPrice {
  input: number // $ per input token
  output: number // $ per output token
}

const PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
}

// Estimare reziduală pe tokeni (folosită doar unde nu avem costul real). Fără un
// preț cunoscut → 0 (costul real al creierului se ia din OpenRouter usage.cost).
export function brainCost(model: string, inputTokens: number, outputTokens: number): number {
  const base = model.replace(/-\d{6,}$/, '')
  const p = PRICES[base] ?? PRICES[model] ?? { input: 0, output: 0 }
  return inputTokens * p.input + outputTokens * p.output
}

export function geminiCost(inputTokens: number, outputTokens: number): number {
  const p = PRICES['gemini-2.5-flash']
  return inputTokens * p.input + outputTokens * p.output
}

export const TTS_USD_PER_CHAR = 30 / 1e6
export function ttsCost(chars: number): number {
  return chars * TTS_USD_PER_CHAR
}

export const ASR_USD_PER_CALL = 0.0015

export const SERPER_USD_PER_CALL = 0.001

export const IMAGE_USD_PER_CALL = 0.04

// TAXAREA VOCII PE MINUT (Adrian, 25 iul: „când userii folosesc voce/extra plăți,
// să le ia costurile din credite"). Audio-ul live OpenAI Realtime e cea mai
// scumpă componentă (STT+model+TTS pe minut). Clientul „pulsează" cât timp vocea
// e activă; serverul debitează pe secunde REAL conectate. Editabil din env.
export const VOICE_USD_PER_MINUTE = Number(process.env.VOICE_USD_PER_MINUTE ?? 0.35)

