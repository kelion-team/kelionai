import { getGoogleRefreshToken } from '../db.js'
import { refreshGoogleAccessToken } from './google.js'
import { ROSTER, carteAgent } from './agentiKelion.js'

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
}

/** Rezultatul unei creări de agent: reușit sau eroarea verbatim (măsurat). */
type RezCreare = { ok: true } | { ok: false; err: string }

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
  return { status: r.status, j }
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

/** Creează assistant-ul (dacă lipsește) + cei 33 de agenți, cu tokenul Google al
 *  ownerului (identitate licențiată). Idempotent pe displayName. Întoarce un
 *  raport MĂSURAT — dacă Google refuză, poartă eroarea verbatim. */
export async function creeazaAgentiEnterprise(email: string): Promise<RaportEnterprise> {
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
  const licenta = await asiguraLicenta(T, email)

  // 1) Assistant (cutia). Idempotent: GET; dacă 404 îl creăm; 409 = există.
  let a = await api(T, 'GET', ASST)
  if (a.status === 404) {
    a = await api(T, 'POST', `${ENG}/assistants?assistantId=default_assistant`, { displayName: 'Kelion' })
    if (a.status !== 200 && a.status !== 409) {
      return { ...gol, motiv: `assistant_esuat HTTP ${a.status}: ${mesajEroare(a.j)}` }
    }
  } else if (a.status !== 200) {
    return { ...gol, motiv: `assistant_get HTTP ${a.status}: ${mesajEroare(a.j)}` }
  }

  // 2) Cine există deja (idempotență pe displayName).
  const ex = await api(T, 'GET', `${ASST}/agents?pageSize=200`)
  const cunoscuti = new Set(((ex.j.agents as { displayName?: string }[] | undefined) ?? []).map((x) => x.displayName))

  // 3) Creează cei 33 — ÎN PARALEL. Secvențial (33 × ~1-2s) depășea timeout-ul
  //    gateway-ului și pagina primea un 504 HTML („Unexpected token '<'", 4 aug).
  //    În paralel durează ~2-5s. Idempotent: sar peste cei existenți.
  const deCreat = ROSTER.filter((ag) => !cunoscuti.has(ag.nume))
  const existau = ROSTER.length - deCreat.length
  const rezultate = await Promise.all(
    deCreat.map(async (ag) => {
      const card = carteAgent(ag)
      const res = await api(T, 'POST', `${ASST}/agents`, {
        displayName: ag.nume,
        description: ag.rol,
        a2aAgentDefinition: { jsonAgentCard: JSON.stringify(card) },
      })
      return rezultatCreare(res)
    }),
  )
  const { creati, esuati, primaEroare } = socoteste(rezultate)

  // 4) Lista finală, citită din API (dovada).
  const fin = await api(T, 'GET', `${ASST}/agents?pageSize=200`)
  const lista = ((fin.j.agents as { displayName?: string }[] | undefined) ?? []).map((x) => String(x.displayName ?? ''))

  return { ok: esuati === 0 && lista.length >= ROSTER.length, creati, existau, esuati, lista, primaEroare, licenta }
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

  const up = await api(token, 'POST', `${COL}/userStores/default:batchUpdateUserLicenses`, {
    inlineSource: {
      updateMask: 'license_config',
      userLicenses: [{ userPrincipal: email, licenseConfig: activ.name }],
    },
  })
  if (up.status === 200) {
    return `loc alocat pe abonamentul ${activ.subscriptionTier ?? activ.name.split('/').pop()} (poate dura câteva secunde să se propage)`
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

// ── CALEA A DOUA: VERTEX AI AGENTS (aiplatform) — FĂRĂ abonament Gemini ──────
//
// Discovery Engine (Gemini Enterprise) cere abonament plătit (măsurat, verbatim,
// pe contul ownerului). DAR există alt produs, „Agent Platform Studio" (unde a
// fost ownerul), pe API-ul aiplatform: `projects.locations.agents.create`. Ăsta
// e Vertex AI, pay-per-use, FĂRĂ abonament lunar. Agentul are chiar
// `system_instruction`. Îl creăm tot cu tokenul ownerului. Baza cerută (măsurat
// din discovery, singura valoare acceptată): `antigravity-preview-05-2026`.

function vertexBaza(loc: string): string {
  return loc === 'global' ? 'https://aiplatform.googleapis.com' : `https://${loc}-aiplatform.googleapis.com`
}

/** Creează cei 33 de agenți în Vertex AI (Agent Platform Studio), cu tokenul
 *  ownerului. Fără abonament. Alege singur o locație care răspunde (global →
 *  us-central1). Raport MĂSURAT: câți creați, verbatim la primul eșec. */
export async function creeazaAgentiVertex(email: string): Promise<RaportEnterprise> {
  const gol: RaportEnterprise = { ok: false, creati: 0, existau: 0, esuati: 0, lista: [] }

  const refresh = await getGoogleRefreshToken(email)
  if (!refresh) return { ...gol, motiv: 'nu_esti_conectat: apasă „Conectează Google (Enterprise)" mai întâi.' }
  const tok = await refreshGoogleAccessToken(refresh)
  if (!tok) return { ...gol, motiv: 'reconectare_necesara: apasă din nou „Conectează Google (Enterprise)".' }
  const T = tok.accessToken

  // 1) Găsește o locație unde API-ul răspunde (LIST = 200).
  let loc = ''
  let probaEroare = ''
  for (const cand of ['global', 'us-central1', 'us-east4']) {
    const url = `${vertexBaza(cand)}/v1/projects/${PROIECT}/locations/${cand}/agents?pageSize=1`
    const r = await fetchJson(T, 'GET', url)
    if (r.status === 200) {
      loc = cand
      break
    }
    if (!probaEroare) probaEroare = `HTTP ${r.status}: ${mesajEroare(r.j)}`
  }
  if (!loc) return { ...gol, motiv: `Vertex AI nu răspunde pe nicio locație. Prima eroare: ${probaEroare}` }

  const parent = `projects/${PROIECT}/locations/${loc}/agents`
  const listUrl = `${vertexBaza(loc)}/v1/${parent}?pageSize=200`

  // 2) Cine există deja (idempotență pe id).
  const ex = await fetchJson(T, 'GET', listUrl)
  const cunoscuti = new Set(
    ((ex.j.agents as { name?: string; id?: string }[] | undefined) ?? []).map((a) => a.id ?? String(a.name ?? '').split('/').pop()),
  )

  // 3) Creează cei 33 — în paralel.
  const deCreat = ROSTER.filter((a) => !cunoscuti.has(a.id))
  const existau = ROSTER.length - deCreat.length
  const createUrl = `${vertexBaza(loc)}/v1/${parent}`
  const rezultate = await Promise.all(
    deCreat.map(async (a) => {
      const res = await fetchJson(T, 'POST', createUrl, {
        id: a.id,
        base_agent: 'antigravity-preview-05-2026',
        description: a.rol,
        system_instruction: `Ești „${a.nume}", un agent specialist al lui Kelion. Specialitatea ta: ${a.rol} Răspunzi scurt, la obiect; ce nu poți proba spui „nu pot verifica".`,
      })
      return rezultatCreare(res)
    }),
  )
  const { creati, esuati, primaEroare } = socoteste(rezultate)

  // 4) Lista finală din API (dovada).
  const fin = await fetchJson(T, 'GET', listUrl)
  const lista = ((fin.j.agents as { name?: string; id?: string; description?: string }[] | undefined) ?? []).map(
    (a) => a.id ?? String(a.name ?? '').split('/').pop() ?? '',
  )

  return {
    ok: esuati === 0 && lista.length >= ROSTER.length,
    creati,
    existau,
    esuati,
    lista,
    primaEroare,
    licenta: `Vertex AI (Agent Platform), locație ${loc} — fără abonament Gemini Enterprise`,
  }
}
