// ── MESSENGER KELION↔KELION — PREZENȚĂ + SEMNALIZARE APEL (Adrian, 11 aug) ───────
// „apelează-l pe X" (din chat scris SAU voce, în mașină SAU acasă) → celuilalt user
// îi SUNĂ aplicația; acceptă/refuză; canal securizat (WS autentificat pe cont);
// închizi oricând. Aici stă logica pură (prezență + registrul apelurilor +
// rezolvarea țintei); ruta `routes/apel.ts` doar leagă WebSocket-ul de ea, iar
// `chat.ts` cheamă `sunaUtilizator` din unealta de creier `apeleaza_user`.
//
// FAZA 1 (asta): sunat + acceptă/refuză + conectat + închide. FAZA 2: audio +
// traducere live se releуează tot pe aici (tipurile 'audio'/'sdp'/'ice'), peste
// canalul deja stabilit.
import { cautaUtilizatorApel, type UtilizatorApel } from '../db.js'

// O conexiune = un tab/device al unui user. Un user poate fi logat în mai multe.
export interface ConexiuneApel {
  trimite(mesaj: unknown): void
}

export interface Apel {
  id: string
  deLaEmail: string
  deLaNume: string
  catreEmail: string
  catreNume: string
  stare: 'suna' | 'conectat'
  creatLa: number
}

export interface RezultatApel {
  ok: boolean
  callId?: string
  cu?: { email: string; nume: string }
  motiv?: 'lipsa' | 'user_negasit' | 'ambiguu' | 'offline' | 'db'
  candidati?: UtilizatorApel[]
}

const prezenta = new Map<string, Set<ConexiuneApel>>()
const apeluri = new Map<string, Apel>()

// Ceas monoton pentru id-uri de apel — fără Date.now/Math.random în calea pură,
// ca testele să fie deterministe; routes-ul poate suprascrie generatorul dacă vrea.
let contorApel = 0
let genId: () => string = () => `apel_${++contorApel}`
/** Doar pentru rută/teste: setează cum se generează id-ul de apel. */
export function seteazaGeneratorId(fn: () => string): void {
  genId = fn
}

function normalizeaza(email: string): string {
  return email.toLowerCase().trim()
}

export function esteOnline(email: string): boolean {
  const set = prezenta.get(normalizeaza(email))
  return !!set && set.size > 0
}

/** Apelul activ după id (Faza 2: pipeline-ul de traducere are nevoie de ambele
 *  părți ca să afle limba fiecăruia și să relezе rezultatul). */
export function gasesteApel(callId: string): Apel | undefined {
  return apeluri.get(callId)
}

export function trimiteCatre(email: string, mesaj: unknown): number {
  const set = prezenta.get(normalizeaza(email))
  if (!set) return 0
  let n = 0
  for (const con of set) {
    try {
      con.trimite(mesaj)
      n++
    } catch {
      /* conexiune moartă — o sărim */
    }
  }
  return n
}

export function inregistreazaPrezenta(email: string, con: ConexiuneApel): void {
  const e = normalizeaza(email)
  let set = prezenta.get(e)
  if (!set) {
    set = new Set()
    prezenta.set(e, set)
  }
  set.add(con)
}

/** Scoate o conexiune; dacă userul rămâne complet offline, îi închide apelurile
 *  active și anunță cealaltă parte (ca să nu rămână un apel „agățat"). */
export function scoatePrezenta(email: string, con: ConexiuneApel): void {
  const e = normalizeaza(email)
  const set = prezenta.get(e)
  if (set) {
    set.delete(con)
    if (set.size === 0) prezenta.delete(e)
  }
  if (esteOnline(e)) return // mai are alt tab deschis — apelurile rămân
  for (const [id, a] of [...apeluri]) {
    if (a.deLaEmail === e || a.catreEmail === e) {
      apeluri.delete(id)
      const celalalt = a.deLaEmail === e ? a.catreEmail : a.deLaEmail
      trimiteCatre(celalalt, { type: 'hangup', callId: id, motiv: 'plecat' })
    }
  }
}

/** Inițiază un apel: rezolvă ținta, verifică prezența, sună la ea. Cheamat de
 *  unealta de creier `apeleaza_user` (chat.ts), deci de pe calea scrisă ȘI de voce. */
export async function sunaUtilizator(deLaEmail: string, termen: string): Promise<RezultatApel> {
  const t = termen.trim()
  if (!t) return { ok: false, motiv: 'lipsa' }
  const rez = await cautaUtilizatorApel(t)
  if (!rez.citit) return { ok: false, motiv: 'db' }
  const eu = normalizeaza(deLaEmail)
  const gasiti = rez.valoare.filter((u) => u.email !== eu)
  if (gasiti.length === 0) return { ok: false, motiv: 'user_negasit' }
  if (gasiti.length > 1) return { ok: false, motiv: 'ambiguu', candidati: gasiti }
  const tinta = gasiti[0]
  if (!esteOnline(tinta.email)) {
    return { ok: false, motiv: 'offline', cu: { email: tinta.email, nume: tinta.name } }
  }
  // Numele apelantului, din același director (best-effort; altfel emailul).
  let deLaNume = eu
  const meRez = await cautaUtilizatorApel(eu)
  if (meRez.citit) {
    const meu = meRez.valoare.find((u) => u.email === eu)
    if (meu?.name) deLaNume = meu.name
  }
  const id = genId()
  const apel: Apel = {
    id,
    deLaEmail: eu,
    deLaNume,
    catreEmail: tinta.email,
    catreNume: tinta.name,
    stare: 'suna',
    creatLa: contorApel, // marcaj monoton; timpul real e pus în rută dacă e nevoie
  }
  apeluri.set(id, apel)
  trimiteCatre(tinta.email, {
    type: 'invite',
    callId: id,
    from: { email: eu, name: deLaNume },
  })
  return { ok: true, callId: id, cu: { email: tinta.email, nume: tinta.name } }
}

/** Semnalizarea venită de la un client pe WS: accept / refuz / închidere.
 *  Faza 2 va adăuga aici 'audio'/'sdp'/'ice' (releu între cei doi). */
export function gestioneazaMesaj(email: string, m: unknown): void {
  if (!m || typeof m !== 'object') return
  const msg = m as { type?: unknown; callId?: unknown }
  const tip = typeof msg.type === 'string' ? msg.type : ''
  const id = typeof msg.callId === 'string' ? msg.callId : ''
  const e = normalizeaza(email)
  const a = id ? apeluri.get(id) : undefined
  if (!a) return
  const eParte = a.deLaEmail === e || a.catreEmail === e
  if (!eParte) return
  const celalalt = a.deLaEmail === e ? a.catreEmail : a.deLaEmail
  switch (tip) {
    case 'accept': {
      if (a.catreEmail !== e) return // doar cel sunat acceptă
      a.stare = 'conectat'
      trimiteCatre(a.deLaEmail, { type: 'accepted', callId: id, cu: { email: a.catreEmail, name: a.catreNume } })
      trimiteCatre(a.catreEmail, { type: 'accepted', callId: id, cu: { email: a.deLaEmail, name: a.deLaNume } })
      break
    }
    case 'decline': {
      if (a.catreEmail !== e) return // doar cel sunat refuză
      apeluri.delete(id)
      trimiteCatre(a.deLaEmail, { type: 'declined', callId: id })
      break
    }
    case 'hangup': {
      apeluri.delete(id)
      trimiteCatre(celalalt, { type: 'hangup', callId: id, motiv: 'hangup' })
      break
    }
    default:
      break
  }
}

// Doar pentru teste: golește starea între cazuri.
export function _reset(): void {
  prezenta.clear()
  apeluri.clear()
  contorApel = 0
  genId = () => `apel_${++contorApel}`
}
