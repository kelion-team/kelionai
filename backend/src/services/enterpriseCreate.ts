import { getGoogleRefreshToken, memoriePune, memorieIa, saveKv, loadKv } from '../db.js'
import { refreshGoogleAccessToken } from './google.js'
import { rosterViu, carteAgent, type AgentKelion } from './agentiKelion.js'

// ── CREAREA AGENȚILOR ÎN CONSOLA GEMINI ENTERPRISE, CU TOKENUL OWNERULUI ─────
//
// De ce (Adrian, 4 aug: „rezolvă real, nu-mi explica"): Google refuză contul de
// serviciu al aplicației la crearea agenților — verbatim, măsurat de 4 ori:
// „The user cannot create an agent since an active Gemini Enterprise license is
// not available." Licența e legată de un OM. Deci folosim identitatea
// OWNERULUI: la login-ul lui Google (scope cloud-platform adăugat în auth.ts),
// serverul primește un refresh token pe contul lui; îl schimbăm pe un access
// token și creăm cei 33 de agenți CA EL — contul lui e licențiat, deci trece.
// Zero secrete în afară, zero Cloud Shell: doar login-ul pe care oricum îl face.

const PROIECT = 'gen-lang-client-0460348646'
const B = 'https://discoveryengine.googleapis.com/v1alpha'
const COL = `projects/${PROIECT}/locations/global`
const ENG = `${COL}/collections/default_collection/engines/kelion-agenti`
const ASST = `${ENG}/assistants/default_assistant`

export interface RaportEnterprise {
  ok: boolean
  motiv?: string
  creati: number
  existau: number
  esuati: number
  lista: string[]
  primaEroare?: string
  /** Ce s-a întâmplat cu LICENȚA (măsurat): abonament găsit? loc alocat? */
  licenta?: string
}

interface RespApi {
  status: number
  j: Record<string, unknown>
  /** Retry-After (secunde), dacă Google l-a trimis la un 429. */
  retryAfter?: number
}

/** Rezultatul unei creări de agent: reușit sau eroarea verbatim (măsurat).
 *  `quota` = refuz 429 (fereastra abonamentului e închisă) — apelantul oprește
 *  ocolul întreg, nu mai trimite restul în zid. */
type RezCreare = { ok: true } | { ok: false; err: string; quota?: boolean }

function mesajEroare(j: Record<string, unknown>): string {
  const err = j.error as { message?: string } | undefined
  return String(err?.message ?? JSON.stringify(j)).slice(0, 300)
}

/** Nucleul comun de HTTP+JSON (folosit și de Discovery Engine și de Vertex AI):
 *  fetch cu bearer, corp JSON opțional, parsare tolerantă la corp gol. */
async function fetchJson(token: string, method: string, url: string, body?: unknown): Promise<RespApi> {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  let j: Record<string, unknown> = {}
  try {
    j = (await r.json()) as Record<string, unknown>
  } catch {
    /* corp gol/ne-JSON — j rămâne {} */
  }
  const ra = Number(r.headers.get('retry-after'))
  return { status: r.status, j, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined }
}

/** Discovery Engine (Gemini Enterprise): scurtătură peste `fetchJson` cu baza `B`. */
async function api(token: string, method: string, path: string, body?: unknown): Promise<RespApi> {
  return fetchJson(token, method, `${B}/${path}`, body)
}

/** Traduce răspunsul unui POST de creare într-un rezultat (200 = ok, altfel eroarea verbatim). */
function rezultatCreare(res: RespApi): RezCreare {
  return res.status === 200 ? { ok: true } : { ok: false, err: `HTTP ${res.status}: ${mesajEroare(res.j)}` }
}

/** Adună rezultatele creărilor paralele: câți creați, câți eșuați, prima eroare. */
function socoteste(rezultate: RezCreare[]): { creati: number; esuati: number; primaEroare?: string } {
  const creati = rezultate.filter((r) => r.ok).length
  const esuati = rezultate.length - creati
  const primaEroare = rezultate.find((r): r is { ok: false; err: string } => !r.ok)?.err
  return { creati, esuati, primaEroare }
}

// STRATEGIA VEGHERII (5 aug, după ce ownerul a prins povestea falsă „~1/zi"):
// limita de creare NU e o cotă de proiect (măsurat cu serviceusage: pe
// discoveryengine există doar cote de căutare/întrebări) — e un plafon de
// ABONAMENT, nedocumentat ca număr. Măsurat pe zilele trecute: ziua 1 → 2
// agenți, ziua 2 → 1; reușitele au venit după LINIȘTE, iar rafalele de cereri
// refuzate țin paharul plin (observația ownerului). Cotele Google se resetează
// la miezul nopții ORA PACIFICULUI (~10:00 ora României). De aici regulile:
//   1. VEGHE non-stop la REIA_MIN (15 min) — o singură încercare ușoară pe
//      ocol când fereastra e închisă; prindem orice deschidere în ≤15 min.
//   2. La reușită DRENĂM fereastra: următorul agent după un minut de respiro,
//      până Google închide iar.
//   3. La primul 429 ocolul se OPREȘTE întreg — nu mai trimitem și ceilalți
//      88 în zid (cererile refuzate umplu paharul degeaba).
//   4. Fiecare încercare intră în JURNAL cu ora ei — tiparul real al cotei se
//      învață din date, nu din documentație.
const PAUZA_INTRE_MS = 60_000
const zabava = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// JURNALUL COTEI (măsurat, nu ghicit): ultimele încercări cu ora și rezultatul
// lor — dovada vie a tiparului (când se deschide fereastra, câte lasă Google).
// PERSISTAT ÎN DB (Adrian, 5 aug: „bagă-l"): jurnalul + contoarele stăteau DOAR
// în memorie, deci se ștergeau la fiecare deploy și tiparul real al lui 429 nu
// se putea citi din afară a doua zi (raportul de dimineață îl GHICEA). Acum
// fiecare notare se scrie și în `kv_state` — chei publice, fără secrete (doar
// nume de agenți + rezultat), ca raportul să aibă 429-ul MĂSURAT.
const JURNAL_MAX = 60
const KV_JURNAL = 'enterprise:jurnal-cote'
const KV_MASURATORI = 'enterprise:masuratori-creare'
const jurnalCote: string[] = []
function noteazaInJurnal(ce: string): void {
  jurnalCote.push(`${new Date().toISOString().slice(0, 19)}Z ${ce}`)
  if (jurnalCote.length > JURNAL_MAX) jurnalCote.shift()
  void persistaMasuratori()
}

/** CONDIȚIA DE UNICAT (ownerul, 4 aug: „să compare permanent lista și să ia
 *  doar care nu e"): citește lista din consolă ACUM și spune dacă numele
 *  există deja. Citirile nu stau sub quota de creare — sunt ieftine și dese. */
async function existaInConsola(T: string, nume: string): Promise<boolean> {
  const r = await api(T, 'GET', `${ASST}/agents?pageSize=200`)
  if (r.status !== 200) return false // necitibil ACUM → decizia o ia POST-ul (Google e ultimul arbitru)
  return (((r.j.agents as { displayName?: string }[] | undefined) ?? []).some((x) => x.displayName === nume))
}

/** Creează UN agent — O SINGURĂ încercare (fără reîncercări în ocol: la 429
 *  fereastra abonamentului e închisă, iar cererile refuzate umplu paharul;
 *  vegherea de 15 min reia singură). ÎNAINTE de încercare compară lista din
 *  consolă — dacă agentul a apărut între timp, NU-l mai pune (unicatul
 *  ownerului: zero dubluri, orice s-ar fi întâmplat pe drum). */
async function creeazaUnAgent(T: string, ag: AgentKelion, anunta: (pas: string) => void): Promise<RezCreare> {
  const corp = {
    displayName: ag.nume,
    description: ag.rol,
    a2aAgentDefinition: { jsonAgentCard: JSON.stringify(carteAgent(ag)) },
  }
  if (await existaInConsola(T, ag.nume)) {
    anunta(`„${ag.nume}" e DEJA în consolă — îl sar (condiția de unicat)`)
    return { ok: true }
  }
  cereriTrimise += 1
  const res = await api(T, 'POST', `${ASST}/agents`, corp)
  if (res.status === 200) {
    ultimaReusita = `${ag.nume} (${new Date().toISOString().slice(11, 19)} UTC)`
    noteazaInJurnal(`REUȘIT: ${ag.nume}`)
    return { ok: true }
  }
  if (res.status === 429) {
    noteazaInJurnal(`429 la ${ag.nume} (fereastra închisă)`)
    return { ok: false, err: `HTTP 429: ${mesajEroare(res.j)}`, quota: true }
  }
  noteazaInJurnal(`EȘEC ${res.status} la ${ag.nume}`)
  return rezultatCreare(res)
}

/** Creează assistant-ul (dacă lipsește) + cei 33 de agenți, cu tokenul Google al
 *  ownerului (identitate licențiată). Idempotent pe displayName. Întoarce un
 *  raport MĂSURAT — dacă Google refuză, poartă eroarea verbatim. `anunta`
 *  primește pașii pe drum (pagina de admin îi arată viu). */
export async function creeazaAgentiEnterprise(email: string, anunta: (pas: string) => void = () => {}): Promise<RaportEnterprise> {
  const gol: RaportEnterprise = { ok: false, creati: 0, existau: 0, esuati: 0, lista: [] }

  const refresh = await getGoogleRefreshToken(email)
  if (!refresh) {
    return { ...gol, motiv: 'nu_esti_conectat: apasă „Conectează Google (Enterprise)" mai întâi, ca serverul să primească permisiunea pe contul tău.' }
  }
  const tok = await refreshGoogleAccessToken(refresh)
  if (!tok) {
    return { ...gol, motiv: 'reconectare_necesara: tokenul Google a expirat/retras — apasă din nou „Conectează Google (Enterprise)".' }
  }
  const T = tok.accessToken

  // 0) LICENȚA — cauza reală (măsurat: chiar contul ownerului primește „active
  //    Gemini Enterprise license is not available"). Încercăm să-i alocăm un loc
  //    dintr-un abonament al proiectului. Dacă NU există niciun abonament, o
  //    spunem clar — un loc nu se poate aloca dintr-un abonament inexistent
  //    (acela e o cumpărare/activare, nu cod).
  anunta('verific licența (abonamentul Gemini Enterprise)')
  const licenta = await asiguraLicenta(T, email)

  // 1) Assistant (cutia). Idempotent: GET; dacă 404 îl creăm; 409 = există.
  anunta('verific assistant-ul (cutia agenților)')
  let a = await api(T, 'GET', ASST)
  if (a.status === 404) {
    a = await api(T, 'POST', `${ENG}/assistants?assistantId=default_assistant`, { displayName: 'Kelion' })
    if (a.status !== 200 && a.status !== 409) {
      return { ...gol, motiv: `assistant_esuat HTTP ${a.status}: ${mesajEroare(a.j)}` }
    }
  } else if (a.status !== 200) {
    return { ...gol, motiv: `assistant_get HTTP ${a.status}: ${mesajEroare(a.j)}` }
  }

  // 2) Cine există deja (idempotență pe displayName). REGULA #3 (4 aug,
  //    întrebarea ownerului „o ia iar de la 0?"): dacă citirea listei PICĂ,
  //    NU creăm orbește — am face dubluri pentru toți cei deja intrați.
  //    Ne oprim cinstit și spunem de ce; o apăsare nouă reia cu lista citită.
  anunta('citesc agenții existenți din consolă')
  const ex = await api(T, 'GET', `${ASST}/agents?pageSize=200`)
  if (ex.status !== 200) {
    return { ...gol, motiv: `nu pot citi lista agenților existenți (HTTP ${ex.status}: ${mesajEroare(ex.j)}) — nu creez orbește, ca să nu fac dubluri; apasă din nou`, licenta }
  }
  const cunoscuti = new Set(((ex.j.agents as { displayName?: string }[] | undefined) ?? []).map((x) => x.displayName))

  // 3) Creează-i CU RITM, unul după altul. MĂSURAT (4 aug, seara): în paralel,
  //    Google a lăsat 2 și a tăiat 31 cu „429: Agent creation quota exceeded";
  //    secvențial în cererea HTTP nu se poate — gateway-ul taie la ~60s (504,
  //    măsurat tot azi). De-asta funcția rulează în FUNDAL (pornesteCrearea) și
  //    își permite pauze. Idempotent: sar peste cei existenți; un termen total
  //    oprește politicos dacă quota nu se mai deschide (restul: „apasă din nou").
  // Rosterul VIU: codul + agenții puși de owner din admin (ei intră automat).
  const roster = await rosterViu()
  const deCreat = roster.filter((ag) => !cunoscuti.has(ag.nume))
  const existau = roster.length - deCreat.length
  const rezultate: RezCreare[] = []
  for (const ag of deCreat) {
    // Raportul cerut de owner (4 aug, de două ori: „trebuie să văd"): cifrele
    // stau PERMANENT în față — și pe mesajele de așteptare la quota, nu doar
    // când trecem la următorul (altfel, într-o seară cu 429 lung, nu se vedeau).
    const instalati = existau + rezultate.filter((x) => x.ok).length
    const eticheta = `instalați: ${instalati}/${roster.length} | rămași: ${roster.length - instalati}`
    anunta(`${eticheta} | acum îl pun pe: ${ag.nume}`)
    const rez = await creeazaUnAgent(T, ag, (pas) => anunta(`${eticheta} | ${pas}`))
    rezultate.push(rez)
    if (rez.ok) {
      await zabava(PAUZA_INTRE_MS) // respiro după reușită, apoi DRENĂM fereastra cu următorul
      continue
    }
    if (!rez.ok && rez.quota) {
      // Fereastra abonamentului s-a închis — ocolul se OPREȘTE aici. Nu-i mai
      // trimitem pe ceilalți în zid (cererile refuzate umplu paharul); vegherea
      // de REIA_MIN minute reia singură și prinde următoarea deschidere.
      anunta(`${eticheta} | fereastra Google s-a închis (429) — veghez la ${REIA_MIN} min și continui SINGUR`)
      break
    }
  }
  const { creati, esuati, primaEroare } = socoteste(rezultate)

  // 4) Lista finală, citită din API (dovada).
  anunta('citesc lista finală din consolă (dovada)')
  const fin = await api(T, 'GET', `${ASST}/agents?pageSize=200`)
  const lista = ((fin.j.agents as { displayName?: string }[] | undefined) ?? []).map((x) => String(x.displayName ?? ''))

  return { ok: esuati === 0 && lista.length >= roster.length, creati, existau, esuati, lista, primaEroare, licenta }
}

/** Asigură ownerului un LOC de licență Gemini Enterprise: listează abonamentele
 *  (licenseConfigs) proiectului și, dacă există unul, îi alocă un loc
 *  (batchUpdateUserLicenses). Întoarce un rezumat MĂSURAT pentru raport. Dacă nu
 *  există niciun abonament, spune clar — un loc nu se alocă din nimic. */
async function asiguraLicenta(token: string, email: string): Promise<string> {
  const lc = await api(token, 'GET', `${COL}/licenseConfigs`)
  if (lc.status !== 200) {
    return `nu pot citi abonamentele: HTTP ${lc.status}: ${mesajEroare(lc.j)}`
  }
  let configs = (lc.j.licenseConfigs as { name?: string; state?: string; subscriptionTier?: string }[] | undefined) ?? []
  if (configs.length === 0) {
    // REGULA #2 (4 aug, Adrian: „pe ăsta l-am luat de ieri și-mi spui că n-am
    // licență"): abonamentul CUMPĂRAT stă întâi pe CONTUL DE FACTURARE și
    // trebuie DISTRIBUIT proiectului — pasul care lipsea aici. Căutăm pe
    // billing account și distribuim automat către proiect.
    const dist = await distribuieDePeFacturare(token)
    if (dist) return dist // eroare clară — o purtăm în raport
    const relc = await api(token, 'GET', `${COL}/licenseConfigs`)
    configs = (relc.j.licenseConfigs as typeof configs) ?? []
  }
  if (configs.length === 0) {
    return 'NICIUN ABONAMENT Gemini Enterprise găsit — nici pe proiect, nici pe contul de facturare (011729-7DA3DA-87ED94). Ce ai activat ieri e alt produs (probabil Google AI Pro — planul de consumator din aplicația Gemini), nu Gemini Enterprise. Verifică: console.cloud.google.com/billing.'
  }
  const activ = configs.find((c) => c.state === 'ACTIVE') ?? configs[0]
  if (!activ?.name) return `abonamente găsite (${configs.length}) dar niciunul cu nume valid`

  // Locul poate fi DEJA al lui — MĂSURAT (4 aug, a doua apăsare): realocarea
  // întoarce 400 „Subscription reaches the limit of 1 licenses", adică unicul
  // loc e deja dat (chiar lui — dovadă: agenții s-au creat). Verificăm întâi,
  // ca raportul să spună adevărul, nu o eroare care sperie degeaba.
  const ul = await api(token, 'GET', `${COL}/userStores/default/userLicenses?pageSize=200`)
  const ale = (ul.j.userLicenses as { userPrincipal?: string }[] | undefined) ?? []
  // Tolerant la forma principalului (poate veni „user:email@..."), nu doar egal.
  if (ale.some((l) => (l.userPrincipal ?? '').toLowerCase().includes(email.toLowerCase()))) {
    return `locul e deja alocat contului ${email} (verificat în userLicenses)`
  }

  const up = await api(token, 'POST', `${COL}/userStores/default:batchUpdateUserLicenses`, {
    inlineSource: {
      updateMask: 'license_config',
      userLicenses: [{ userPrincipal: email, licenseConfig: activ.name }],
    },
  })
  if (up.status === 200) {
    return `loc alocat pe abonamentul ${activ.subscriptionTier ?? activ.name.split('/').pop()} (poate dura câteva secunde să se propage)`
  }
  // MĂSURAT (4 aug, de mai multe ori): 400 „Subscription reaches the limit of
  // 1 licenses" = unicul loc al abonamentului e DEJA dat (chiar ownerului —
  // dovada: agenții se creează). Nu-l mai raportăm ca eșec care sperie.
  if (up.status === 400 && /reaches the limit/i.test(mesajEroare(up.j))) {
    return 'locul e deja alocat (unicul loc al abonamentului e ocupat — al tău; agenții se creează cu el)'
  }
  return `abonament găsit dar alocarea locului a picat: HTTP ${up.status}: ${mesajEroare(up.j)}`
}

// Abonamentul cumpărat de owner stă pe CONTUL DE FACTURARE; îl distribuim
// proiectului (billingAccountLicenseConfigs → distributeLicenseConfig). Gol =
// nu s-a cumpărat Enterprise (ce a luat e alt produs). Eroare → o raportăm.
const CONT_FACTURARE = 'billingAccounts/011729-7DA3DA-87ED94'
async function distribuieDePeFacturare(token: string): Promise<string | null> {
  const bl = await api(token, 'GET', `${CONT_FACTURARE}/billingAccountLicenseConfigs`)
  if (bl.status !== 200) {
    return `nu pot citi abonamentele de pe contul de facturare: HTTP ${bl.status}: ${mesajEroare(bl.j)}`
  }
  const cfgs = (bl.j.billingAccountLicenseConfigs as { name?: string; state?: string }[] | undefined) ?? []
  if (cfgs.length === 0) return null // chiar nu există nimic cumpărat — verdictul îl dă apelantul
  const ales = cfgs.find((c) => c.state === 'ACTIVE') ?? cfgs[0]
  if (!ales?.name) return `abonamente pe facturare (${cfgs.length}) dar fără nume valid`
  const d = await api(token, 'POST', `${ales.name}:distributeLicenseConfig`, { project: `projects/${PROIECT}` })
  if (d.status !== 200) {
    return `abonament găsit pe facturare (${ales.name.split('/').pop()}) dar distribuirea către proiect a picat: HTTP ${d.status}: ${mesajEroare(d.j)}`
  }
  return null // distribuit — apelantul recitește lista proiectului
}

// ── RULAREA ÎN FUNDAL ────────────────────────────────────────────────────────
//
// Crearea cu ritm poate dura minute (agenți × pauze la 429), iar gateway-ul
// taie cererile HTTP la ~60s (504 măsurat 4 aug). Deci butonul din admin doar
// PORNEȘTE treaba; serverul o duce la capăt aici, în fundal, iar pagina
// întreabă starea la câteva secunde. Dacă serverul repornește la mijloc, o
// nouă apăsare continuă de unde a rămas (cei creați sunt săriți — idempotent).
//
// (Calea a doua de aici, Vertex AI „Agent Platform", a fost scoasă azi: era
// ocolul pentru LIPSA abonamentului, dar ownerul a cumpărat Gemini Enterprise
// Standard — măsurat: licența se alocă și agenții se creează pe calea asta.)

interface StareEnterprise {
  ruleaza: boolean
  pas: string
  raport?: RaportEnterprise
  /** CONTROLUL ownerului (4 aug: „deci nu am control că merge") — cifre care
   *  se mișcă mereu: câte cereri de creare am trimis de la boot și ultima
   *  reușită cu ora ei. Chiar și când Google refuză, `cereri` crește. */
  cereri?: number
  ultimaReusita?: string
  /** JURNALUL MĂSURAT al încercărilor (oră + rezultat) — de aici se citește
   *  tiparul REAL al cotei de abonament, nu din documentație. */
  jurnal?: string[]
}
const stare: StareEnterprise = { ruleaza: false, pas: 'nepornit' }
let cereriTrimise = 0
let ultimaReusita = ''

// PERSISTAREA MĂSURĂTORILOR (5 aug, „bagă-l"): jurnalul cotei + contoarele,
// scrise în `kv_state` best-effort la fiecare notare — supraviețuiesc
// deploy-urilor și se pot citi din DB FĂRĂ sesiunea ownerului (raportul de
// dimineață măsoară 429-ul real, nu îl ghicește). Chei publice: doar nume de
// agenți + rezultat, ZERO secrete. Best-effort: dacă DB pică, crearea merge mai
// departe.
async function persistaMasuratori(): Promise<void> {
  try {
    await saveKv(KV_JURNAL, JSON.stringify(jurnalCote))
    await saveKv(
      KV_MASURATORI,
      JSON.stringify({
        cereri: cereriTrimise,
        ultimaReusita: ultimaReusita || null,
        pas: stare.pas,
        actualizat: new Date().toISOString(),
      }),
    )
  } catch {
    /* măsurătoarea e best-effort — nu oprește crearea dacă DB pică */
  }
}

// La boot: reîncarcă jurnalul + contoarele persistate, ca `stareCreare()` și
// raportul de dimineață să arate ISTORIA de dinainte de deploy, nu o pagină
// goală (memoria procesului s-a șters la repornire).
async function incarcaMasuratori(): Promise<void> {
  try {
    const j = await loadKv(KV_JURNAL)
    if (j) {
      const arr: unknown = JSON.parse(j)
      if (Array.isArray(arr)) {
        jurnalCote.length = 0
        for (const x of arr.slice(-JURNAL_MAX)) if (typeof x === 'string') jurnalCote.push(x)
      }
    }
    const s = await loadKv(KV_MASURATORI)
    if (s) {
      const o = JSON.parse(s) as { cereri?: number; ultimaReusita?: string | null }
      if (typeof o.cereri === 'number' && Number.isFinite(o.cereri)) cereriTrimise = o.cereri
      if (o.ultimaReusita) ultimaReusita = String(o.ultimaReusita)
    }
  } catch {
    /* dacă nu se pot reîncărca, pornim de la zero — nu blocăm bootul */
  }
}

// „REMEDIAZĂ ERR ASTA CU RELUAREA DE LA 0" (Adrian, 4 aug seara): crearea nu
// mai depinde de apăsări repetate și nu mai moare la restart. Steagul din
// memorie (memorie_proiect) supraviețuiește repornirii → la boot reluăm
// SINGURI; iar când un ocol se termină fără toți agenții (quota 429, termen),
// următorul ocol pornește SINGUR peste REIA_MIN minute. „Din listă iese cine
// e confirmat": fiecare ocol RE-CITEȘTE lista din consolă și îi sare pe cei
// intrați — de-creat rămâne mereu doar restul (măsurat: „existau: 2").
const CHEIA_CREARE = 'enterprise-creare-in-mers'
const REIA_MIN = 15
let ceasReluare: NodeJS.Timeout | null = null

/** Starea creării din fundal — pagina de admin o citește la câteva secunde. */
export function stareCreare(): StareEnterprise {
  return { ...stare, cereri: cereriTrimise, ultimaReusita: ultimaReusita || undefined, jurnal: [...jurnalCote] }
}

/** Pornește crearea în fundal (dacă nu rulează deja) și întoarce starea.
 *  Nu se mai oprește singură până nu intră TOȚI: la ocol parțial se re-armează
 *  peste REIA_MIN minute; la restart de server, reiaCreareaDupaRepornire. */
export function pornesteCrearea(email: string): StareEnterprise {
  if (stare.ruleaza) return stare
  if (ceasReluare) {
    clearTimeout(ceasReluare)
    ceasReluare = null
  }
  stare.ruleaza = true
  stare.raport = undefined
  stare.pas = 'pornesc'
  void memoriePune(CHEIA_CREARE, email).catch(() => {})
  void creeazaAgentiEnterprise(email, (pas) => {
    stare.pas = pas
  })
    .then((r) => {
      stare.raport = r
      if (r.ok) {
        // Toți în consolă — steagul jos, nimic de reluat.
        void memoriePune(CHEIA_CREARE, '').catch(() => {})
      } else if (!r.motiv) {
        // Ocol parțial — vegherea continuă MEREU la REIA_MIN minute, non-stop.
        // LECȚIA (5 aug, ownerul a prins-o): povestea „~1/zi din documentație"
        // era neverificată — pe ea dormea 6 ORE la ocol gol și rata ferestrele
        // (resetul cotelor Google e la miezul nopții ORA PACIFICULUI, ~10:00 la
        // noi). Un ocol închis pe 429 costă O SINGURĂ cerere refuzată, deci
        // veghea deasă nu umple paharul; tiparul real se citește din jurnal.
        ceasReluare = setTimeout(() => {
          ceasReluare = null
          pornesteCrearea(email)
        }, REIA_MIN * 60_000)
      }
      // r.motiv (ne-conectat, listă necitibilă...) = nu reluăm orbește pe timer;
      // steagul rămâne, deci un restart sau o apăsare reiau când e cazul.
    })
    .catch((e: unknown) => {
      stare.raport = { ok: false, creati: 0, existau: 0, esuati: 0, lista: [], motiv: `prăbușit: ${String(e).slice(0, 200)}` }
    })
    .finally(() => {
      stare.ruleaza = false
      stare.pas = 'gata'
    })
  return stare
}

/** La boot: dacă un restart a tăiat o creare în mers (steagul e sus), o reluăm
 *  singuri — ownerul nu mai apasă nimic după deploy-uri. */
export async function reiaCreareaDupaRepornire(): Promise<void> {
  await incarcaMasuratori() // reîncarcă jurnalul + contoarele de dinainte de deploy
  const v = await memorieIa(CHEIA_CREARE)
  const m = /\]\s*(\S+@\S+)\s*$/.exec(v.trim())
  if (m?.[1]) pornesteCrearea(m[1])
}
