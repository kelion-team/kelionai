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
  | 'descarcat' // modelul E în cache (descărcat înainte), dar nu încă încărcat în GPU
  | 'se_pregateste' // se descarcă/încarcă modelul
  | 'gata' // model încărcat, poate răspunde offline
  | 'eroare' // a picat încărcarea (motiv reținut)

// URMA „E DESCĂRCAT" (owner 20 aug: „daca ai descarcat pentru ofline trebuie sa vada
// ca a fost descarcat si sa nu te mai puna sa descarci daca nu sunt modificari"). La
// fiecare reload starea din memorie se pierde (redevine 'neintrodus') deși modelul stă
// în Cache Storage → panoul cerea IAR descărcarea. Reținem în localStorage CE model a
// fost descărcat; dacă e chiar modelul curent, pornim optimist pe 'descarcat' (fără să
// mai cerem descărcare). Dacă flag-ul e alt model (S-A SCHIMBAT ceva) → 'neintrodus' →
// se ia singur noul model (auto-update). Confirmăm/infirmăm din Cache Storage, fără să
// importăm biblioteca grea WebLLM la pornire.
const CHEIE_DESCARCAT = 'kelion_model_offline'
function citesteFlagDescarcat(): string | null {
  try {
    return localStorage.getItem(CHEIE_DESCARCAT)
  } catch {
    return null
  }
}
function scrieFlagDescarcat(id: string): void {
  try {
    localStorage.setItem(CHEIE_DESCARCAT, id)
  } catch {
    /* storage indisponibil — se reconfirmă din Cache Storage */
  }
}
function stergeFlagDescarcat(): void {
  try {
    localStorage.removeItem(CHEIE_DESCARCAT)
  } catch {
    /* nimic */
  }
}

// Modelul local: capabilitate CLIENT (WebGPU), aleasă din lista prebuilt WebLLM —
// nu e o cifră de bani/tarif/prag și nici o stare inventată. ~3B Q4, multilingv
// (owner RO + userii pe 7 limbi), destul de mic cât să încapă pe telefon.
// hardcod-permis: id de model client WebLLM (capabilitate offline), nu valoare de afișat/tarifat; mutabil la config server în faza următoare.
const MODEL_LOCAL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC'

// Optimist la pornire: dacă flag-ul spune că EXACT modelul curent a fost descărcat,
// pornim pe 'descarcat' (nu mai cerem descărcare). Se confirmă din Cache Storage prin
// sincronizeazaStareOffline(). Flag pe alt model = s-a schimbat → 'neintrodus' → auto-ia.
let stare: StareLocal = citesteFlagDescarcat() === MODEL_LOCAL ? 'descarcat' : 'neintrodus'
let progres = 0 // 0..1 la descărcarea modelului
let motivEroare = ''
// Motorul WebLLM, tipat lax ca să nu forțăm tipurile bibliotecii peste tot.
let motor: { chat: { completions: { create: (o: unknown) => Promise<unknown> } } } | null = null
let pregatire: Promise<boolean> | null = null

/** Starea + progresul curent (fără să forțeze ceva). Pentru UI/decizii. */
export function stareCreierLocal(): { stare: StareLocal; progres: number; motiv: string } {
  return { stare, progres, motiv: motivEroare }
}

/** E modelul în Cache Storage? Verificare UȘOARĂ, direct pe cache-ul `webllm/model`,
 *  FĂRĂ să importăm biblioteca grea WebLLM la pornire. Best-effort (false la orice
 *  eroare). Completitudinea reală o revalidează WebLLM la încărcare. */
export async function modelDescarcatInCache(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false
    if (!(await caches.has('webllm/model'))) return false
    const c = await caches.open('webllm/model')
    const chei = await c.keys()
    return chei.length > 0
  } catch {
    return false
  }
}

/** Reconciliază starea cu realitatea din cache (owner: „să vadă că e descărcat, să nu
 *  mai ceară dacă nu sunt modificări"). Model curent în cache → 'descarcat'; flag pe alt
 *  model sau cache evacuat → 'neintrodus' (se ia din nou = auto-update la schimbare). Nu
 *  atinge 'gata'/'se_pregateste' (deja încărcat/în lucru). */
export async function sincronizeazaStareOffline(): Promise<void> {
  if (stare === 'gata' || stare === 'se_pregateste') return
  const inCache = await modelDescarcatInCache()
  const potrivit = inCache && citesteFlagDescarcat() === MODEL_LOCAL
  if (potrivit) {
    if (stare !== 'descarcat') stare = 'descarcat'
    scrieFlagDescarcat(MODEL_LOCAL)
  } else {
    if (stare === 'descarcat') stare = 'neintrodus'
    // flag invalid (cache evacuat SAU alt model decât cel curent) → curăță-l
    if (!inCache || citesteFlagDescarcat() !== MODEL_LOCAL) stergeFlagDescarcat()
  }
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
export function personaLocala(lang: Lang, context?: string): string {
  // Instrucțiunea rămâne în engleză (limbajul de sistem al modelului), dar CERE
  // răspuns în limba userului. `context` (faza 2) = GPS/viteză/vedere MĂSURATE.
  const baza =
    `You are Kelion, a warm human-like companion running fully OFFLINE on the user's device. ` +
    `There is NO internet right now: you have no web search, no Google, no maps, no weather, no live data, no email. ` +
    `You are a COMPANION, not a full assistant — talk, keep them company, remember the conversation so far, be human, brief and kind. ` +
    `If asked for something that truly needs the internet, say honestly you can't do it offline and that you'll handle it when the signal returns — never invent an answer or pretend to act. ` +
    `Reply in the user's language: ${NUME_LIMBA[lang]}. Keep replies short and natural, voice-first.`
  return context ? `${baza}\n${context}` : baza
}

/** ChatMessage[] → mesajele pentru model, cu persona în față + ultimele N ture
 *  (PRELUAREA CONTEXTULUI, owner: „modelul offline preia contextul integral").
 *  PURĂ (testabilă). Filtrează rolurile necunoscute și mesajele goale. */
export function istoricPentruLocal(
  mesaje: MesajLocal[],
  lang: Lang,
  maxTure = 16,
  context?: string,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const curate = mesaje
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-maxTure)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.trim() }))
  return [{ role: 'system' as const, content: personaLocala(lang, context) }, ...curate]
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
    // STOCARE PERSISTENTĂ (owner 20 aug: „fiecare update să fie preluat și după ce s-a
    // downloadat, nu să șteargă ce e existent"). Update-ul ESTE preluat normal (se
    // reîncarcă versiunea nouă), dar modelul (~2 GB în Cache Storage sub webllm/*) e deja
    // ferit de ștergere (updateCheck + sw.js). Aici punem al doilea zid: cerem browserului
    // să marcheze stocarea PERSISTENTĂ, ca modelul să nu fie evacuat nici sub presiune de
    // spațiu. Best-effort — dacă browserul refuză, descărcarea merge oricum înainte.
    try {
      const stocare = (navigator as unknown as { storage?: { persist?: () => Promise<boolean> } }).storage
      if (stocare?.persist) await stocare.persist()
    } catch {
      /* indisponibil — modelul rămâne în cache, doar fără garanția anti-evacuare */
    }
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
      scrieFlagDescarcat(MODEL_LOCAL) // reținem că FIX acest model e descărcat (nu recerem)
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
  context?: string, // faza 2: GPS/viteză/vedere MĂSURATE, injectate în persona
): AsyncGenerator<string> {
  const t = strings(lang)
  if (stare !== 'gata' || !motor) {
    // Nu e pregătit: un cuvânt cinstit, nu un răspuns fals.
    yield stare === 'fara_webgpu' ? t.offlineFaraWebgpu : t.offlineModelNepregatit
    return
  }
  const mesaje = istoricPentruLocal(istoric, lang, 16, context)
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
