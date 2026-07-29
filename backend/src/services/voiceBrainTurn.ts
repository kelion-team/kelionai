// ── §6 CREIER UNIC — VOCEA = URECHILE ȘI GURA ACELUIAȘI CREIER ───────────────
// Adrian: „vocea să ajungă la TOATE rutele; nimic separat, fără dispecer". Calea
// curată (spec §6): o tură de voce rulată prin ACELAȘI orchestrator ca scrisul,
// cu TOATE uneltele din registru — NU prin creierul de voce separat, plafonat la
// 31. Fluxul: text transcris (STT) → creierul complet → text de rostit (TTS).
//
// STARE: NECABLAT încă la sesiunea Realtime LIVE (se construiește în paralel,
// verificat cu test, apoi se comută — ca să NU cadă vocea live, lecția „owner
// testează live"). Uneltele și executorul se INJECTEAZĂ (dependency injection),
// deci modulul e decuplat de HTTP și de listele hardcodate: aceleași unelte pe
// care le folosește scrisul se pot da și aici, dintr-o singură sursă.

import { runOrchestrator } from './orchestrator.js'
import type { AnthropicTool, OrMessage } from './openrouter.js'

export interface VoiceBrainTurnDeps {
  /** Modelul creierului (același ca scrisul). */
  model: string
  /** Uneltele în format Anthropic — venite din registrul unic (brainCapabilities). */
  tools: AnthropicTool[]
  /** Execută o unealtă: (name, argsJson) → rezultat text. Decuplat de reply.raw. */
  execTool: (name: string, argsJson: string) => Promise<string>
  /** Persona/instrucțiunile creierului (aceleași ca scrisul, ancorate în realitate). */
  systemPrompt: string
  /** Istoricul conversației (memorie + replici recente). */
  history?: OrMessage[]
  /** Text difuzat pe măsură ce curge (pentru sinteză TTS incrementală). */
  onText?: (delta: string) => void
}

// O TURĂ COMPLETĂ DE VOCE prin creierul unic. Întoarce textul de rostit.
export async function voiceBrainTurn(transcript: string, deps: VoiceBrainTurnDeps): Promise<string> {
  const messages: OrMessage[] = [
    { role: 'system', content: deps.systemPrompt },
    ...(deps.history ?? []),
    { role: 'user', content: transcript },
  ]
  const res = await runOrchestrator(deps.model, messages, deps.tools, deps.execTool, {
    maxRounds: 6,
    maxTokens: 1500,
    // ACEEAȘI REGULĂ A FAPTEI ca scrisul: nu declara o acțiune fără s-o fi făcut.
    deedGate: true,
    onText: deps.onText,
  })
  return res.text
}
