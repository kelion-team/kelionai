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

function mesajEroare(j: Record<string, unknown>): string {
  const err = j.error as { message?: string } | undefined
  return String(err?.message ?? JSON.stringify(j)).slice(0, 300)
}

async function api(token: string, method: string, path: string, body?: unknown): Promise<RespApi> {
  const r = await fetch(`${B}/${path}`, {
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
      return res.status === 200 ? { ok: true as const } : { ok: false as const, err: `HTTP ${res.status}: ${mesajEroare(res.j)}` }
    }),
  )
  const creati = rezultate.filter((r) => r.ok).length
  const esuati = rezultate.length - creati
  const primaEroare = rezultate.find((r): r is { ok: false; err: string } => !r.ok)?.err

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
  const configs = (lc.j.licenseConfigs as { name?: string; state?: string; subscriptionTier?: string }[] | undefined) ?? []
  if (configs.length === 0) {
    return 'PROIECTUL NU ARE ABONAMENT Gemini Enterprise. Trebuie activat/cumpărat în consolă (Gemini Enterprise → abonament) — un loc nu se poate aloca dintr-un abonament inexistent.'
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

async function apiVertex(token: string, method: string, url: string, body?: unknown): Promise<RespApi> {
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
    /* corp gol/ne-JSON */
  }
  return { status: r.status, j }
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
  for (const cand of ['global', 'us-central1', 'us-central1']) {
    const url = `${vertexBaza(cand)}/v1/projects/${PROIECT}/locations/${cand}/agents?pageSize=1`
    const r = await apiVertex(T, 'GET', url)
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
  const ex = await apiVertex(T, 'GET', listUrl)
  const cunoscuti = new Set(
    ((ex.j.agents as { name?: string; id?: string }[] | undefined) ?? []).map((a) => a.id ?? String(a.name ?? '').split('/').pop()),
  )

  // 3) Creează cei 33 — în paralel.
  const deCreat = ROSTER.filter((a) => !cunoscuti.has(a.id))
  const existau = ROSTER.length - deCreat.length
  const createUrl = `${vertexBaza(loc)}/v1/${parent}`
  const rezultate = await Promise.all(
    deCreat.map(async (a) => {
      const res = await apiVertex(T, 'POST', createUrl, {
        id: a.id,
        base_agent: 'antigravity-preview-05-2026',
        description: a.rol,
        system_instruction: `Ești „${a.nume}", un agent specialist al lui Kelion. Specialitatea ta: ${a.rol} Răspunzi scurt, la obiect; ce nu poți proba spui „nu pot verifica".`,
      })
      return res.status === 200 ? { ok: true as const } : { ok: false as const, err: `HTTP ${res.status}: ${mesajEroare(res.j)}` }
    }),
  )
  const creati = rezultate.filter((r) => r.ok).length
  const esuati = rezultate.length - creati
  const primaEroare = rezultate.find((r): r is { ok: false; err: string } => !r.ok)?.err

  // 4) Lista finală din API (dovada).
  const fin = await apiVertex(T, 'GET', listUrl)
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
