// Creier local folosit exclusiv în modul avion. Instalarea lui este declanșată
// explicit din Setări; calea online rămâne OpenAI prin backend.

import type { Lang } from './i18n'
import { strings } from './i18n'
import { offlineKitManifest } from './offlineKitManifest'
import { reconcileOfflineComponent } from './offlineKitIntegrity'
import { forgetOfflineComponent } from './offlineKitReadiness'

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

const MODEL_LOCAL = offlineKitManifest.components.brain.id

let stare: StareLocal = 'neintrodus'
let progres = 0 // 0..1 la descărcarea modelului
let motivEroare = ''
// Motorul WebLLM, tipat lax ca să nu forțăm tipurile bibliotecii peste tot.
// `interruptGenerate` e cheia bugului „moare conversația după primul chat": la abort
// TREBUIE să întrerupem generarea și să GOLIM fluxul, nu să-l abandonăm (vezi jos).
let motor: {
  chat: { completions: { create: (o: unknown) => Promise<unknown> } }
  interruptGenerate?: () => Promise<void> | void
  unload?: () => Promise<void>
} | null = null
let pregatire: Promise<boolean> | null = null

/** Starea + progresul curent (fără să forțeze ceva). Pentru UI/decizii. */
export function stareCreierLocal(): { stare: StareLocal; progres: number; motiv: string } {
  return { stare, progres, motiv: motivEroare }
}

/** Verifică fiecare artefact pinuit înainte de a considera modelul disponibil. */
export async function modelDescarcatInCache(): Promise<boolean> {
  return (await reconcileOfflineComponent('brain')).ok
}

/** Reconciliază starea din memorie cu markerul reviziei validate. */
export async function sincronizeazaStareOffline(verificat?: boolean): Promise<void> {
  if (stare === 'gata' || stare === 'se_pregateste') return
  stare = (typeof verificat === 'boolean' ? verificat : await modelDescarcatInCache())
    ? 'descarcat'
    : 'neintrodus'
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
  // răspuns în limba userului. `context` conține numai semnale măsurate furnizate.
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

/** Descarcă și verifică modelul după acordul explicit din Setări. La pornirea
 *  offline, aceeași funcție încarcă revizia deja marcată din cache. */
export async function pregatesteModelOffline(
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  if (stare === 'gata') return true
  if (pregatire) return pregatire
  pregatire = (async () => {
    if (signal?.aborted) return false
    if (!(await webgpuDisponibil())) {
      stare = 'fara_webgpu'
      return false
    }
    stare = 'se_pregateste'
    // Persistența reduce riscul de evacuare a kitului mare; refuzul browserului
    // nu este tratat drept confirmare de readiness.
    try {
      const stocare = (navigator as unknown as { storage?: { persist?: () => Promise<boolean> } }).storage
      if (stocare?.persist) await stocare.persist()
    } catch {
      /* indisponibil — modelul rămâne în cache, doar fără garanția anti-evacuare */
    }
    try {
      const webllm = await import('@mlc-ai/web-llm')
      const component = offlineKitManifest.components.brain
      const record = webllm.prebuiltAppConfig.model_list.find((item) => item.model_id === MODEL_LOCAL)
      if (!record) throw new Error('offline model missing from WebLLM runtime')
      const modelLibrary = component.artifacts.find((artifact) => artifact.cache === 'webllm/wasm')
      if (!modelLibrary?.url) throw new Error('offline model library missing from manifest')
      const appConfig = {
        ...webllm.prebuiltAppConfig,
        model_list: [{
          ...record,
          model: `${component.repository}/resolve/${component.revisionSha}/`,
          model_lib: modelLibrary.url,
        }],
      }
      const loaded = (await webllm.CreateMLCEngine(MODEL_LOCAL, {
        appConfig,
        initProgressCallback: (r: { progress?: number }) => {
          if (signal?.aborted) throw new DOMException('offline kit download cancelled', 'AbortError')
          progres = typeof r.progress === 'number' ? r.progress : progres
          onProgress?.(progres)
        },
      })) as unknown as NonNullable<typeof motor>
      if (signal?.aborted) {
        await loaded.unload?.().catch(() => {})
        stare = 'neintrodus'
        return false
      }
      motor = loaded
      stare = 'gata'
      progres = 1
      return true
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        stare = 'neintrodus'
        motivEroare = ''
        return false
      }
      stare = 'eroare'
      motivEroare = e instanceof Error ? e.message.slice(0, 200) : String(e)
      motor = null
      console.error('[creier-local] pregătirea modelului a picat:', motivEroare)
      return false
    } finally {
      pregatire = null
    }
  })()
  return pregatire
}

/** Elimină numai cache-urile WebLLM ale originului și markerul acestei revizii. */
export async function stergeModelOffline(): Promise<void> {
  try {
    await motor?.unload?.()
  } catch {
    // Motorul poate fi deja pierdut; cache-ul poate fi totuși eliminat.
  }
  motor = null
  pregatire = null
  if (typeof caches !== 'undefined') {
    await Promise.all(['webllm/model', 'webllm/config', 'webllm/wasm'].map((name) => caches.delete(name).catch(() => false)))
  }
  forgetOfflineComponent('brain')
  stare = 'neintrodus'
  progres = 0
  motivEroare = ''
}

/** Eliberează GPU-ul după instalare, fără să șteargă artefactele verificate. */
export async function elibereazaCreierLocal(): Promise<void> {
  const loaded = motor
  motor = null
  pregatire = null
  try {
    await loaded?.unload?.()
  } catch {
    // Cache-ul verificat rămâne valid chiar dacă adaptorul s-a pierdut înainte de unload.
  }
  if (stare === 'gata' || stare === 'se_pregateste') stare = 'descarcat'
  progres = stare === 'descarcat' ? 1 : 0
}

/** RĂSPUNS OFFLINE, în flux (același contract ca `streamChat`: async iterable de
 *  bucăți de text). Dacă modelul nu e gata, spune CINSTIT — nu inventează. */
export async function* streamLocalRaspuns(
  istoric: MesajLocal[],
  lang: Lang,
  signal?: AbortSignal,
  context?: string,
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
    // DEVICE LOST: presiunea de memorie poate pierde adaptorul GPU. Marcăm
    // eroarea ca să nu reîncercăm automat pe același dispozitiv.
    const msg = e instanceof Error ? e.message : String(e)
    if (/device.*lost|GPUDeviceLost|insufficient.*memory/i.test(msg)) {
      stare = 'eroare'
      motivEroare = 'GPU device lost — memorie video insuficientă'
      motor = null
    }
    yield `${t.offlineEroareLocal} ${msg.slice(0, 120)}`.trim()
    return
  }
  // ABORT FĂRĂ SĂ SCURGEM LOCK-UL (owner 20 aug: „dupa primul chat moare conversatia").
  // WebLLM ține un LOCK per-model pe care îl eliberează DOAR la finalul NORMAL al
  // fluxului. Dacă ieșim din buclă cu `return`/`break`, generatorul e abandonat
  // (`.return()`) → release() nu se mai cheamă → lock-ul rămâne blocat PE VECI →
  // următorul `create()` se blochează la `acquire()`, iar `send()` atârnă în `await`
  // (busy rămâne true) → chatul moare definitiv. FIX: la abort NU ieșim; întrerupem
  // generarea O DATĂ și GOLIM fluxul (`continue`) până se termină singur → WebLLM ajunge
  // la release() și tura următoare pornește curat.
  let intrerupt = false
  for await (const parte of flux) {
    if (signal?.aborted) {
      if (!intrerupt) {
        intrerupt = true
        try {
          await motor?.interruptGenerate?.()
        } catch {
          /* best-effort — oricum drenăm restul mai jos */
        }
      }
      continue
    }
    const buc = parte.choices?.[0]?.delta?.content
    if (buc) yield buc
  }
}
