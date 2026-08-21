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

// ── MODELELE OFFLINE, ALESE DE OWNER (owner 21 aug: „vreau să pot seta eu modelul,
// inclusiv Gemma 2 sau plus, doar la offline… să le downloadez și să le pot încerca").
// Registru de capabilități CLIENT (WebGPU/WebLLM) — id-uri REALE din lista prebuilt
// WebLLM v0.2.84, VERIFICATE în node_modules (nu inventate, regula #1). Owner-ul alege
// PE DEVICE (localStorage), descarcă ce modele vrea și comută între ele la offline.
// Țintă: telefoane 2026+ (owner: „nu e criteriu telefoanele vechi") → putem urca la 7B/9B.
// hardcod-permis: id-uri de model client WebLLM (capabilități offline), nu valori de bani/tarif/prag; alese de owner, nu stare inventată.
export interface ModelOffline {
  id: string // id REAL din prebuiltAppConfig WebLLM (dat la CreateMLCEngine)
  nume: string // eticheta scurtă arătată owner-ului
  parametri: string // mărimea (FAPT din numele modelului: 2B/3B/7B/9B), nu o cifră inventată
}
export const MODELE_OFFLINE: ModelOffline[] = [
  { id: 'gemma-2-2b-it-q4f16_1-MLC', nume: 'Gemma 2', parametri: '2B' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', nume: 'Qwen 2.5', parametri: '3B' },
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', nume: 'Qwen 2.5', parametri: '7B' },
  { id: 'gemma-2-9b-it-q4f16_1-MLC', nume: 'Gemma 2', parametri: '9B' },
]
const MODEL_IMPLICIT = 'Qwen2.5-3B-Instruct-q4f16_1-MLC' // echilibrul de acum, până alege owner-ul
const IDURI_VALIDE = new Set(MODELE_OFFLINE.map((m) => m.id))

// Cheile: modelul ACTIV (pe care rulează offline) + SETUL de modele deja descărcate
// (owner descarcă mai multe și comută). Cheia veche ('kelion_model_offline') ținea UN
// singur model descărcat — o migrăm (dacă e un id valid, îl considerăm activ + descărcat).
const CHEIE_MODEL_ACTIV = 'kelion_model_offline_activ'
const CHEIE_MODELE_DESCARCATE = 'kelion_modele_descarcate'
const CHEIE_DESCARCAT_VECHE = 'kelion_model_offline'

function citesteActiv(): string {
  try {
    const v = localStorage.getItem(CHEIE_MODEL_ACTIV)
    if (v && IDURI_VALIDE.has(v)) return v
    const vechi = localStorage.getItem(CHEIE_DESCARCAT_VECHE) // migrare din cheia veche
    if (vechi && IDURI_VALIDE.has(vechi)) return vechi
  } catch {
    /* storage indisponibil */
  }
  return MODEL_IMPLICIT
}
/** Id-ul modelului offline ACTIV (ales de owner, sau implicitul). */
export function getModelOffline(): string {
  return citesteActiv()
}

function citesteDescarcate(): Set<string> {
  const s = new Set<string>()
  try {
    const raw = localStorage.getItem(CHEIE_MODELE_DESCARCATE)
    if (raw)
      for (const id of JSON.parse(raw) as unknown[])
        if (typeof id === 'string' && IDURI_VALIDE.has(id)) s.add(id)
    const vechi = localStorage.getItem(CHEIE_DESCARCAT_VECHE) // migrare
    if (vechi && IDURI_VALIDE.has(vechi)) s.add(vechi)
  } catch {
    /* nimic */
  }
  return s
}
/** Lista id-urilor de modele DEJA descărcate (în cache-ul browserului). */
export function modeleDescarcate(): string[] {
  return [...citesteDescarcate()]
}
function marcheazaDescarcat(id: string): void {
  const s = citesteDescarcate()
  s.add(id)
  try {
    localStorage.setItem(CHEIE_MODELE_DESCARCATE, JSON.stringify([...s]))
  } catch {
    /* storage indisponibil — se reconfirmă din Cache Storage */
  }
}

// „Generația" modelului: crește la fiecare comutare. O pregătire (descărcare/urcare în
// GPU) pornită pe modelul VECHI și terminată DUPĂ ce owner-ul a comutat NU trebuie să
// pună motorul vechi ca activ — verifică generația la final și se retrage dacă e stală.
let genModel = 0

/** Owner-ul alege modelul offline (doar din registru). Dacă e ALT model decât cel activ:
 *  coborâm motorul curent din GPU și resetăm starea — 'descarcat' dacă noul e deja luat,
 *  altfel 'neintrodus' (cere descărcare). Comutarea între modele descărcate e instantanee. */
export function setModelOffline(id: string): void {
  if (!IDURI_VALIDE.has(id)) return
  const curent = citesteActiv()
  try {
    localStorage.setItem(CHEIE_MODEL_ACTIV, id)
  } catch {
    /* storage indisponibil */
  }
  if (id === curent) return
  genModel++ // invalidează orice pregătire în curs pe modelul vechi (garda genModel)
  // Eliberează memoria GPU a motorului vechi (fără unload, fiecare comutare lăsa un
  // model încărcat în VRAM). NU atingem `pregatire`: dacă o descărcare e în curs pe
  // modelul vechi, o LĂSĂM să se termine (garda genModel îi aruncă rezultatul) — așa
  // NU pornesc DOUĂ CreateMLCEngine deodată (bugul de OOM/crash pe telefon).
  void motor?.unload?.()
  motor = null
  progres = 0
  motivEroare = ''
  stare = citesteDescarcate().has(id) ? 'descarcat' : 'neintrodus'
}

/** Owner ȘTERGE un model descărcat (owner 21 aug: „să pot da jos modelul care nu-mi
 *  place"). Îl scoate din setul de descărcate ȘI îi șterge fișierele din cache-ul
 *  browserului (ELIBEREAZĂ spațiul — gigabytes). Dacă era ACTIV: coboară motorul din
 *  GPU și trece pe alt model descărcat, ori pe implicit. Best-effort pe cache. */
export async function stergeModelOffline(id: string): Promise<void> {
  if (!IDURI_VALIDE.has(id)) return
  // 1) Scoate din setul de descărcate (persistat).
  const s = citesteDescarcate()
  s.delete(id)
  try {
    localStorage.setItem(CHEIE_MODELE_DESCARCATE, JSON.stringify([...s]))
    if (localStorage.getItem(CHEIE_DESCARCAT_VECHE) === id) localStorage.removeItem(CHEIE_DESCARCAT_VECHE)
  } catch {
    /* storage indisponibil */
  }
  // 2) Dacă era ACTIV, coboară motorul și mută activul pe alt descărcat sau pe implicit.
  if (getModelOffline() === id) {
    genModel++
    void motor?.unload?.()
    motor = null
    progres = 0
    motivEroare = ''
    const alt = [...s][0] ?? MODEL_IMPLICIT
    try {
      localStorage.setItem(CHEIE_MODEL_ACTIV, alt)
    } catch {
      /* storage indisponibil */
    }
    stare = s.has(alt) ? 'descarcat' : 'neintrodus'
  }
  // 3) Șterge fișierele din Cache Storage (eliberează spațiul real). Best-effort:
  //    dacă nu se poate, setul e deja curat, iar WebLLM revalidează la o re-descărcare.
  try {
    const webllm = await import('@mlc-ai/web-llm')
    const del = (webllm as unknown as { deleteModelAllInfoInCache?: (id: string) => Promise<void> })
      .deleteModelAllInfoInCache
    if (del) await del(id)
  } catch {
    /* cache-ul nu s-a putut atinge — spațiul se eliberează la evacuare/re-descărcare */
  }
}

// Optimist la pornire: dacă flag-ul spune că EXACT modelul curent a fost descărcat,
// pornim pe 'descarcat' (nu mai cerem descărcare). Se confirmă din Cache Storage prin
// sincronizeazaStareOffline(). Flag pe alt model = s-a schimbat → 'neintrodus' → auto-ia.
let stare: StareLocal = citesteDescarcate().has(getModelOffline()) ? 'descarcat' : 'neintrodus'
let progres = 0 // 0..1 la descărcarea modelului
let motivEroare = ''
// Motorul WebLLM, tipat lax ca să nu forțăm tipurile bibliotecii peste tot.
// `interruptGenerate` e cheia bugului „moare conversația după primul chat": la abort
// TREBUIE să întrerupem generarea și să GOLIM fluxul, nu să-l abandonăm (vezi jos).
let motor: {
  chat: { completions: { create: (o: unknown) => Promise<unknown> } }
  interruptGenerate?: () => Promise<void> | void
  unload?: () => Promise<void> | void // eliberează memoria GPU la comutarea modelului
} | null = null
let pregatire: Promise<boolean> | null = null

/** Starea + progresul curent (fără să forțeze ceva). Pentru UI/decizii. */
export function stareCreierLocal(): { stare: StareLocal; progres: number; motiv: string } {
  return { stare, progres, motiv: motivEroare }
}

/** Reconciliază starea modelului ACTIV cu evidența descărcărilor. SURSA DE ADEVĂR e
 *  SETUL din localStorage (scris la fiecare descărcare reușită), NU un probe de cache.
 *  BUG REPARAT (owner, 21 aug: modele descărcate arătau „nedescărcat" după reload, deci
 *  butonul „Folosește" nu apărea și nu le puteai selecta): vechea `sincronizeaza` ștergea
 *  TOT setul dacă `caches.has('webllm/model')` întorcea fals — dar WebLLM poate ține modelul
 *  în IndexedDB (nu Cache Storage), iar un fals-negativ RĂDEA lista de descărcate; la reload
 *  rămânea doar modelul implicit (reîncărcat singur). Nu mai ștergem nimic pe probe fragil:
 *  ce a descărcat owner-ul rămâne descărcat. Dacă fișierele chiar lipsesc, WebLLM re-descarcă
 *  la încărcare (cu net) sau spune cinstit offline. Nu atinge 'gata'/'se_pregateste'. */
export async function sincronizeazaStareOffline(): Promise<void> {
  if (stare === 'gata' || stare === 'se_pregateste') return
  const activ = getModelOffline()
  if (citesteDescarcate().has(activ)) {
    if (stare !== 'descarcat') stare = 'descarcat'
  } else if (stare === 'descarcat') {
    stare = 'neintrodus'
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
  // Ce model pregătim ACUM + generația: dacă owner-ul comută în timpul descărcării,
  // generația se schimbă și NU punem motorul (vechi) ca activ la final.
  const idTinta = getModelOffline()
  const genTinta = genModel
  // Marcăm „se pregătește" SINCRON (înainte de orice await): UI-ul vede imediat că o
  // descărcare e în curs și blochează celelalte butoane, fără fereastra de ~600ms în
  // care se putea porni a doua descărcare (bugul de OOM). Se corectează mai jos dacă
  // nu e WebGPU.
  stare = 'se_pregateste'
  progres = 0
  pregatire = (async () => {
    // TOT corpul e într-un SINGUR try/finally: `pregatire` se golește pe ORICE ieșire
    // (inclusiv ramura fără-WebGPU de mai jos) — altfel, cum `setModelOffline` nu mai
    // atinge `pregatire`, o ieșire timpurie ar lăsa slotul plin pe veci și creierul nu
    // s-ar mai încărca deloc în sesiunea aia (regresie prinsă de agentul de verificare).
    try {
      if (!(await webgpuDisponibil())) {
        stare = 'fara_webgpu'
        return false
      }
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
      const webllm = await import('@mlc-ai/web-llm')
      const eng = (await webllm.CreateMLCEngine(idTinta, {
        initProgressCallback: (r: { progress?: number }) => {
          progres = typeof r.progress === 'number' ? r.progress : progres
          onProgress?.(progres)
        },
      })) as unknown as typeof motor
      if (genModel !== genTinta) {
        // owner a COMUTAT sau a ȘTERS modelul între timp (ambele cresc genModel) → NU
        // punem motorul ăsta ca activ ȘI NU-l marcăm descărcat. Marcarea `marcheazaDescarcat`
        // era ÎNAINTE de gardă și RE-ADĂUGA în set un model tocmai șters (cursa prinsă de
        // agent) — acum e DUPĂ gardă, deci un „Șterge" în timpul descărcării câștigă.
        // Eliberăm memoria GPU a motorului stăl (altfel rămânea încărcat degeaba).
        void eng?.unload?.()
        stare = citesteDescarcate().has(getModelOffline()) ? 'descarcat' : 'neintrodus'
        return false
      }
      marcheazaDescarcat(idTinta) // s-a descărcat ȘI e încă modelul curent (negșters) → marcăm
      motor = eng
      stare = 'gata'
      progres = 1
      return true
    } catch (e) {
      stare = 'eroare'
      motivEroare = e instanceof Error ? e.message.slice(0, 200) : String(e)
      motor = null
      return false
    } finally {
      pregatire = null // ÎNTOTDEAUNA, pe orice cale de ieșire — nu lăsa slotul blocat
    }
  })()
  return pregatire
}

// Aduce DOAR chunk-ul de cod WebLLM (~6MB JS) în cache-ul service-worker-ului, FĂRĂ
// a-l urca în GPU. De chemat cât ești ONLINE când modelul e deja 'descarcat' — ca
// importul offline din `pregatesteModelOffline` să NU poată pica după un redeploy
// (chunk-ul e re-hash-uit la fiecare build, iar pre-încălzirea modelului nu-l
// re-aducea; audit 3 agenți, 21 aug: importul offline al chunk-ului neprins în cache
// era a doua cauză a bug-ului „nu comută offline"). Cheap + idempotent. Nu atinge GPU.
let codIncalzit = false
export async function incalzesteCodOffline(): Promise<void> {
  if (codIncalzit || stare === 'gata') return
  try {
    await import('@mlc-ai/web-llm')
    codIncalzit = true
  } catch {
    /* rămâne pe importul din pregatesteModelOffline */
  }
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
