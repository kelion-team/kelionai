import type { TextBlock } from './brain-types.js'
import { config } from '../config.js'
import { getMemories, searchMemories, semanticMemories, addMemory, recordCost } from '../db.js'
import { brainCostUsd } from './cost.js'
import { brain } from './brain.js'

// Memory runs on the default chat model (Gemini direct — OpenRouter extirpat, 3 aug).
const MEMORY_MODEL = config.brain.chatDefault

/** Aduce memoriile unui agent: cele recente + (când e `hint`) cele relevante pe
 *  cuvinte + cele semantice, dedup pe conținut păstrând ordinea. Sursă UNICĂ
 *  pentru ambele recall-uri (general 'kelion' și trading 'tranzactii') — înainte
 *  fiecare avea propria copie a aceleiași aduceri (dublură prinsă de jscpd). */
async function aduMemorii(
  email: string,
  agent: string,
  hint: string,
  recentN: number,
  cuvinteN: number,
  semanticN: number,
): Promise<Awaited<ReturnType<typeof getMemories>>> {
  const recent = await getMemories(email, recentN, agent)
  if (!hint.trim()) return recent
  const words = [...new Set(hint.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
  const [relevant, semantic] = await Promise.all([
    searchMemories(email, agent, words, cuvinteN),
    semanticMemories(email, agent, hint, semanticN),
  ])
  const seen = new Set(recent.map((m) => m.content))
  const mems = [...recent]
  for (const m of [...relevant, ...semantic]) {
    if (!seen.has(m.content)) {
      seen.add(m.content)
      mems.push(m)
    }
  }
  return mems
}

export async function recallMemories(email: string, agent = 'kelion', hint = ''): Promise<string> {
  const mems = await aduMemorii(email, agent, hint, 40, 12, 8)
  if (mems.length === 0) return ''
  const lines = mems.map((m) => `- ${m.content}`).join('\n')
  return (
    `\n\nWhat you already know about this user from earlier conversations. ` +
    `Use it naturally to stay continuous, and when the user asks about one of ` +
    `these facts, answer with it directly — just never volunteer recitations of ` +
    `this list unprompted:\n${lines}`
  )
}

/** REAMINTIRE TRADING (N val 2d, ownerul: „în conversație normală nu era
 *  reamintită memoria de tranzacții — doar butonul Analiză o citea"). Schimburile
 *  trecute stau într-un namespace SEPARAT ('tranzactii', scris de chat.ts cât
 *  Centrul de Tranzacționare e pe ecran) — deci recall-ul general (namespace
 *  'kelion') nu le vede niciodată. Când tabul de trading e ancorat, aducem ȘI
 *  memoria asta în conversație, ca răspunsul să fie continuu pe simbolul de pe
 *  ecran. Framing distinct: astea-s discuții de trading, nu fapte durabile
 *  despre om. Gol când nu există nimic măsurat — nu inventăm un istoric. */
export async function recallMemoriiTranzactii(email: string, hint = ''): Promise<string> {
  const mems = await aduMemorii(email, 'tranzactii', hint, 20, 10, 6)
  if (mems.length === 0) return ''
  const lines = mems.map((m) => `- ${m.content}`).join('\n')
  return (
    `\n\nDISCUȚIILE VOASTRE ANTERIOARE DE TRADING (memoria separată a Centrului de ` +
    `Tranzacționare — schimburi trecute pe simboluri). Folosește-le ca să rămâi ` +
    `continuu pe ce ați discutat, dar NU le recita nechemat, iar cifrele vechi NU ` +
    `sunt prețul de acum:\n${lines}`
  )
}

export async function learnFromTurn(
  email: string,
  userMsg: string,
  assistantMsg: string,
  agent = 'kelion',
): Promise<void> {
  if (!config.geminiKey || (!userMsg.trim() && !assistantMsg.trim())) return
  const explicit = userMsg.match(
    /(?:re[țt]ine(?:\s+pentru\s+viitor)?|[țt]ine\s+minte|nu\s+uita|memoreaz[ăa]|remember(?:\s+this|\s+that)?|keep\s+in\s+mind)[:,]?\s+(.{6,300})/i,
  )
  // Cererea EXPLICITĂ a omului („ține minte…") = memorie importantă, prin definiție.
  if (explicit?.[1]) await addMemory(email, explicit[1].trim(), agent, { importanta: 0.9 })
  try {
    const existing = await getMemories(email, 80, agent)
    const known = existing.map((m) => m.content).join('\n') || '(nothing yet)'
    const res = await brain.messages.create({
      model: MEMORY_MODEL,
      max_tokens: 400,
      system:
        'You maintain long-term memory about ONE user for a personal assistant. ' +
        'From the latest exchange, extract only DURABLE, reusable facts about the ' +
        'user — identity, stable preferences, relationships, ongoing projects, ' +
        'recurring context. Ignore ephemeral/one-off details and anything already ' +
        "known. Write each fact in the USER'S OWN language (the language they " +
        'speak in the exchange), so their own words can find it again later. ' +
        'EXCEPTION to "already known": if the user EXPLICITLY asks to remember ' +
        'something ("remember this", "reține", "ține minte"), ALWAYS output that ' +
        'fact even if it is already known — restating refreshes it. Output ONLY a ' +
        'JSON array of OBJECTS, each {"fact": string, "type": one of ' +
        '"identity"|"preference"|"relationship"|"project"|"episodic"|"fact", ' +
        '"importance": number between 0 and 1}. type = the KIND of fact (who the ' +
        'user IS -> identity; how they LIKE things -> preference; people in their ' +
        'life -> relationship; ongoing work -> project; a one-time happening -> ' +
        'episodic; any other durable fact -> fact). importance = how much it should ' +
        'weigh in future recall (identity/preferences high ~0.9; a passing episode ' +
        'low ~0.3). Example: [{"fact":"Locuiește în Witney, UK","type":"identity",' +
        '"importance":0.95},{"fact":"Prefers concise answers","type":"preference",' +
        '"importance":0.85}]. Output [] if there is nothing new and nothing ' +
        'explicitly asked to be remembered.',
      messages: [
        {
          role: 'user',
          content:
            `Already known about the user:\n${known}\n\n` +
            `Latest exchange:\nUser: ${userMsg}\nAssistant: ${assistantMsg}`,
        },
      ],
    })
    // REAL COST FIRST (the owner's rule: "show real, stop fabricating"): the
    // adapter returns the provider's own `usage.cost` for the call that
    // answered — booked as 'memory', a MEASUREMENT (db.ts COSTURI_MASURATE).
    // Only when the provider didn't itemize it do we estimate, and then under
    // a different kind ('memory_est') so the ledger never mixes the two.
    if (typeof res.costUsd === 'number' && res.costUsd > 0) {
      void recordCost(email, 'memory', res.costUsd)
    } else {
      const est = await brainCostUsd(res.model || MEMORY_MODEL, res.usage.input_tokens, res.usage.output_tokens).catch(() => null)
      if (est && est.usd > 0) void recordCost(email, 'memory_est', est.usd)
    }
    const text = res.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    for (const f of parseFacts(text).slice(0, 6)) {
      await addMemory(email, f.fact, agent, { tip: f.tip, importanta: f.importanta })
    }
  } catch {
    // Memory is best-effort — a failure must never affect the conversation.
  }
}

/** Un fapt învățat + metadatele lui smart (tip + importanță). Toleră AMBELE forme:
 *  obiectul nou {fact,type,importance} ȘI vechiul șir simplu (dacă modelul mai
 *  întoarce string-uri, ele devin fapte generice — nimic nu se pierde). PURĂ. */
export interface FaptInvatat {
  fact: string
  tip: string | null
  importanta: number | null
}
export function parseFacts(text: string): FaptInvatat[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown
    if (!Array.isArray(arr)) return []
    const out: FaptInvatat[] = []
    for (const x of arr) {
      if (typeof x === 'string') {
        const s = x.trim()
        if (s.length > 2 && s.length < 240) out.push({ fact: s, tip: null, importanta: null })
      } else if (x && typeof x === 'object') {
        const o = x as { fact?: unknown; type?: unknown; importance?: unknown }
        const s = String(o.fact ?? '').trim()
        if (s.length > 2 && s.length < 240) {
          const imp = Number(o.importance)
          out.push({
            fact: s,
            tip: typeof o.type === 'string' ? o.type : null,
            importanta: Number.isFinite(imp) ? imp : null,
          })
        }
      }
    }
    return out
  } catch {
    return []
  }
}
