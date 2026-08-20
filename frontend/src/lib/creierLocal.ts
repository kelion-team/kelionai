// ── CREIERUL LOCAL OFFLINE (mod companion, faza 1) ───────────────────────────
// Owner: „funcționare fără semnal GSM/WiFi — un model de chat local minimalist,
// cu avatarul actual; la revenire, recomutare." Aici e creierul care ține
// compania când NU e net: rulează 100% în browser pe WebGPU (WebLLM), fără să
// atingă serverul. Calea online rămâne NEATINSĂ — asta se folosește DOAR când
// `esteConectat()` e fals (vezi ChatPanel.send).
//
// Ce e cinstit (regula #1 + LEGEA FAPTEI): offline NU are net, Google, căutare,
// hărți, vreme sau date live. E companion — vorbește, ține contextul, e uman —
// nu asistentul complet. O spune singur în persona, nu se preface că poate.
//
// Modelul se DESCARCĂ o dată cât ai net (WebLLM îl pune în cache-ul browserului),
// apoi merge offline. Fără cache = fără creier local: se spune, nu se inventează.

import type { Lang } from './i18n'
import { strings } from './i18n'

// Numele limbii, în engleză, pentru instrucțiunea de sistem a modelului („reply
// in Romanian"). Fapt static despre limbaj (nu o valoare afișată/tarifată).
const NUME_LIMBA: Record<Lang, string> = {
  en: 'English',
  ro: 'Romanian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
}

// Contractul minim al unui mesaj din chat — decuplat de tipul din ChatPanel, ca
// modulul să fie pur-testabil fără tot componentul.
export interface MesajLocal {
  role: string // 'user' | 'assistant' (orice altceva e ignorat)
  content: string
}

export type StareLocal =
  | 'neintrodus' // încă nu s-a cerut nimic
  | 'fara_webgpu' // dispozitivul nu are WebGPU → creierul local nu poate rula
  | 'se_pregateste' // se descarcă/încarcă modelul
  | 'gata' // model încărcat, poate răspunde offline
  | 'eroare' // a picat încărcarea (motiv reținut)

// Modelul local: capabilitate CLIENT (WebGPU), aleasă din lista prebuilt WebLLM —
// nu e o cifră de bani/tarif/prag și nici o stare inventată. ~3B Q4, multilingv
// (owner RO + userii pe 7 limbi), destul de mic cât să încapă pe telefon.
// hardcod-permis: id de model client WebLLM (capabilitate offline), nu valoare de afișat/tarifat; mutabil la config server în faza următoare.
const MODEL_LOCAL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC'

let stare: StareLocal = 'neintrodus'
let progres = 0 // 0..1 la descărcarea modelului
let motivEroare = ''
// Motorul WebLLM, tipat lax ca să nu forțăm tipurile bibliotecii peste tot.
let motor: { chat: { completions: { create: (o: unknown) => Promise<unknown> } } } | null = null
let pregatire: Promise<boolean> | null = null

/** Starea + progresul curent (fără să forțeze ceva). Pentru UI/decizii. */
export function stareCreierLocal(): { stare: StareLocal; progres: number; motiv: string } {
  return { stare, progres, motiv: motivEroare }
}

/** Are dispozitivul WebGPU? (Necesar pentru creierul local.) Măsurat, nu presupus. */
export async function webgpuDisponibil(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return Boolean(adapter)
  } catch {
    return false
  }
}

/** Persona OFFLINE a lui Kelion, în limba userului. PURĂ (testabilă). Cinstită:
 *  spune că e offline și ce NU poate, rămâne cald și scurt (companion, nu asistent). */
export function personaLocala(lang: Lang): string {
  // Instrucțiunea rămâne în engleză (limbajul de sistem al modelului), dar CERE
  // răspuns în limba userului.
  return (
    `You are Kelion, a warm human-like companion running fully OFFLINE on the user's device. ` +
    `There is NO internet right now: you have no web search, no Google, no maps, no weather, no live data, no email. ` +
    `You are a COMPANION, not a full assistant — talk, keep them company, remember the conversation so far, be human, brief and kind. ` +
    `If asked for something that truly needs the internet, say honestly you can't do it offline and that you'll handle it when the signal returns — never invent an answer or pretend to act. ` +
    `Reply in the user's language: ${NUME_LIMBA[lang]}. Keep replies short and natural, voice-first.`
  )
}

/** ChatMessage[] → mesajele pentru model, cu persona în față + ultimele N ture
 *  (PRELUAREA CONTEXTULUI, owner: „modelul offline preia contextul integral").
 *  PURĂ (testabilă). Filtrează rolurile necunoscute și mesajele goale. */
export function istoricPentruLocal(
  mesaje: MesajLocal[],
  lang: Lang,
  maxTure = 16,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const curate = mesaje
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-maxTure)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.trim() }))
  return [{ role: 'system' as const, content: personaLocala(lang) }, ...curate]
}

/** Descarcă + încarcă modelul (o dată; idempotent). De chemat cât AI NET, ca să
 *  fie gata offline. `onProgress` primește 0..1. Întoarce dacă e gata. */
export async function pregatesteModelOffline(onProgress?: (p: number) => void): Promise<boolean> {
  if (stare === 'gata') return true
  if (pregatire) return pregatire
  pregatire = (async () => {
    if (!(await webgpuDisponibil())) {
      stare = 'fara_webgpu'
      return false
    }
    stare = 'se_pregateste'
    try {
      const webllm = await import('@mlc-ai/web-llm')
      motor = (await webllm.CreateMLCEngine(MODEL_LOCAL, {
        initProgressCallback: (r: { progress?: number }) => {
          progres = typeof r.progress === 'number' ? r.progress : progres
          onProgress?.(progres)
        },
      })) as unknown as typeof motor
      stare = 'gata'
      progres = 1
      return true
    } catch (e) {
      stare = 'eroare'
      motivEroare = e instanceof Error ? e.message.slice(0, 200) : String(e)
      motor = null
      return false
    } finally {
      pregatire = null
    }
  })()
  return pregatire
}

/** RĂSPUNS OFFLINE, în flux (același contract ca `streamChat`: async iterable de
 *  bucăți de text). Dacă modelul nu e gata, spune CINSTIT — nu inventează. */
export async function* streamLocalRaspuns(
  istoric: MesajLocal[],
  lang: Lang,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const t = strings(lang)
  if (stare !== 'gata' || !motor) {
    // Nu e pregătit: un cuvânt cinstit, nu un răspuns fals.
    yield stare === 'fara_webgpu' ? t.offlineFaraWebgpu : t.offlineModelNepregatit
    return
  }
  const mesaje = istoricPentruLocal(istoric, lang)
  let flux: AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>
  try {
    flux = (await motor.chat.completions.create({
      messages: mesaje,
      stream: true,
      temperature: 0.7,
      max_tokens: 512,
    })) as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>
  } catch (e) {
    yield `${t.offlineEroareLocal} ${e instanceof Error ? e.message.slice(0, 120) : ''}`.trim()
    return
  }
  for await (const parte of flux) {
    if (signal?.aborted) return
    const buc = parte.choices?.[0]?.delta?.content
    if (buc) yield buc
  }
}
