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
const ENG = `projects/${PROIECT}/locations/global/collections/default_collection/engines/kelion-agenti`
const ASST = `${ENG}/assistants/default_assistant`

export interface RaportEnterprise {
  ok: boolean
  motiv?: string
  creati: number
  existau: number
  esuati: number
  lista: string[]
  primaEroare?: string
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

  return { ok: esuati === 0 && lista.length >= ROSTER.length, creati, existau, esuati, lista, primaEroare }
}
