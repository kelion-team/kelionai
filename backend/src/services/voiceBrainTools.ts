// ── §6 CREIER UNIC — UNELTELE + EXECUTORUL creierului de voce (DECUPLAT) ──────
// Pas 2 spre „vocea = același creier": setul de unelte și executorul lor, FĂRĂ
// dependență de HTTP (reply.raw). Deocamdată acoperă skill-urile Google
// (definiții din googleTools + executor runGoogleTool — deja decuplate în
// google.ts). Restul (introspecție/monitor) se adaugă când extragem definițiile
// lor din chat.ts, cu grijă. Se dau ca `tools`+`execTool` lui voiceBrainTurn.
//
// NECABLAT încă la sesiunea Realtime live — se construiește în paralel, verificat.

import { googleTools, runGoogleTool } from './google.js'
import type { AnthropicTool } from './openrouter.js'

// Definițiile uneltelor Google (format Anthropic) — sursa reală din google.ts.
export function googleBrainTools(): AnthropicTool[] {
  return googleTools as unknown as AnthropicTool[]
}

// Executor DECUPLAT: (name, argsJson) → rezultat text, prin runGoogleTool cu
// tokenul userului. Parsează argumentele în siguranță; respinge ce nu e Google.
export function makeGoogleExecTool(token: string): (name: string, argsJson: string) => Promise<string> {
  const known = new Set(googleTools.map((t) => t.name))
  return async (name: string, argsJson: string): Promise<string> => {
    if (!known.has(name)) return JSON.stringify({ error: 'unknown_tool', name })
    let args: unknown = {}
    try {
      args = JSON.parse(argsJson || '{}')
    } catch {
      /* argumente ne-JSON → obiect gol (nu aruncă, ca bucla de voce să nu cadă) */
    }
    return runGoogleTool(name, args, token)
  }
}
