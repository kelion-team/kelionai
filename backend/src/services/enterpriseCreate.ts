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
  /** Retry-After (secunde), dacă Google l-a trimis la un 429. */
  retryAfter?: number
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

// MĂSURAT (4 aug, seara, apăsarea ownerului): 33 de POST-uri deodată → 2 create,
// 31 refuzate cu „HTTP 429: Agent creation quota exceeded". Google limitează
// RITMUL creării de agenți. Deci: unul câte unul, pauză între reușite, iar la
// 429 așteptăm (Retry-After dacă vine, altfel scara de mai jos) și reîncercăm.
const PAUZA_INTRE_MS = 1_500
const ASTEPTARI_429_S = [15, 30, 45, 60, 60]
const TERMEN_TOTAL_MS = 20 * 60_000
const zabava = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Creează UN agent, cu răbdare la quota de ritm: la 429 așteaptă și reîncearcă;
 *  orice alt răspuns se întoarce imediat (verbatim la eroare). */
async function creeazaUnAgent(T: string, ag: (typeof ROSTER)[number], anunta: (pas: string) => void): Promise<RezCreare> {
  const corp = {
    displayName: ag.nume,
    description: ag.rol,
    a2aAgentDefinition: { jsonAgentCard: JSON.stringify(carteAgent(ag)) },
  }
  for (let i = 0; ; i++) {
    const res = await api(T, 'POST', `${ASST}/agents`, corp)
    if (res.status !== 429 || i >= ASTEPTARI_429_S.length) return rezultatCreare(res)
    const s = res.retryAfter ?? ASTEPTARI_429_S[i] ?? 60
    anunta(`quota Google (429) la „${ag.nume}" — aștept ${s}s și reîncerc (${i + 1}/${ASTEPTARI_429_S.length})`)
    await zabava(s * 1000)
  }
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

  // 2) Cine există deja (idempotență pe displayName).
  anunta('citesc agenții existenți din consolă')
  const ex = await api(T, 'GET', `${ASST}/agents?pageSize=200`)
  const cunoscuti = new Set(((ex.j.agents as { displayName?: string }[] | undefined) ?? []).map((x) => x.displayName))

  // 3) Creează-i CU RITM, unul după altul. MĂSURAT (4 aug, seara): în paralel,
  //    Google a lăsat 2 și a tăiat 31 cu „429: Agent creation quota exceeded";
  //    secvențial în cererea HTTP nu se poate — gateway-ul taie la ~60s (504,
  //    măsurat tot azi). De-asta funcția rulează în FUNDAL (pornesteCrearea) și
  //    își permite pauze. Idempotent: sar peste cei existenți; un termen total
  //    oprește politicos dacă quota nu se mai deschide (restul: „apasă din nou").
  const deCreat = ROSTER.filter((ag) => !cunoscuti.has(ag.nume))
  const existau = ROSTER.length - deCreat.length
  const rezultate: RezCreare[] = []
  const start = Date.now()
  for (const [i, ag] of deCreat.entries()) {
    if (Date.now() - start > TERMEN_TOTAL_MS) {
      rezultate.push({ ok: false, err: `neîncercat: termenul total (${TERMEN_TOTAL_MS / 60_000} min) s-a epuizat — apasă din nou, continui de unde am rămas` })
      continue
    }
    anunta(`creez ${i + 1}/${deCreat.length}: ${ag.nume}`)
    const rez = await creeazaUnAgent(T, ag, anunta)
    rezultate.push(rez)
    if (rez.ok) await zabava(PAUZA_INTRE_MS)
  }
  const { creati, esuati, primaEroare } = socoteste(rezultate)

  // 4) Lista finală, citită din API (dovada).
  anunta('citesc lista finală din consolă (dovada)')
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

  // Locul poate fi DEJA al lui — MĂSURAT (4 aug, a doua apăsare): realocarea
  // întoarce 400 „Subscription reaches the limit of 1 licenses", adică unicul
  // loc e deja dat (chiar lui — dovadă: agenții s-au creat). Verificăm întâi,
  // ca raportul să spună adevărul, nu o eroare care sperie degeaba.
  const ul = await api(token, 'GET', `${COL}/userStores/default/userLicenses?pageSize=200`)
  const ale = (ul.j.userLicenses as { userPrincipal?: string }[] | undefined) ?? []
  if (ale.some((l) => l.userPrincipal === email)) {
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
}
const stare: StareEnterprise = { ruleaza: false, pas: 'nepornit' }

/** Starea creării din fundal — pagina de admin o citește la câteva secunde. */
export function stareCreare(): StareEnterprise {
  return stare
}

/** Pornește crearea în fundal (dacă nu rulează deja) și întoarce starea. */
export function pornesteCrearea(email: string): StareEnterprise {
  if (stare.ruleaza) return stare
  stare.ruleaza = true
  stare.raport = undefined
  stare.pas = 'pornesc'
  void creeazaAgentiEnterprise(email, (pas) => {
    stare.pas = pas
  })
    .then((r) => {
      stare.raport = r
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
