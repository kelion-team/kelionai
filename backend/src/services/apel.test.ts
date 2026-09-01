import { afterEach, describe, it, expect, vi } from 'vitest'

// Directorul FALS de useri (identitatea reală e emailul; numele vin din
// local_accounts/voiceprints). Mock-uim doar căutarea din db — restul logicii de
// apel (prezență, sunat, accept/refuz/închidere) e pură și o probăm direct.
const DIRECTOR: { email: string; name: string }[] = [
  { email: 'adrian@x.com', name: 'Adrian' },
  { email: 'maria@x.com', name: 'Maria' },
  { email: 'ion@x.com', name: 'Ion Popescu' }, // „ion" prinde numele + emailul
  { email: 'ionel@x.com', name: 'Ionel' }, // „ion" prinde și aici → doi candidați
]
vi.mock('../db.js', () => ({
  cautaUtilizatorApel: vi.fn(async (termen: string) => {
    const t = termen.toLowerCase().trim()
    const val = DIRECTOR.filter(
      (u) => u.email.toLowerCase() === t || u.email.toLowerCase().includes(t) || u.name.toLowerCase().includes(t),
    )
    return { citit: true, valoare: val }
  }),
}))

const apel = await import('./apel.js')

// O „conexiune" de test care strânge mesajele primite.
function conexiune(): { trimite: (m: unknown) => void; mesaje: any[] } {
  const mesaje: any[] = []
  return { trimite: (m) => mesaje.push(m), mesaje }
}

const prezente: Array<[string, ReturnType<typeof conexiune>]> = []
function inregistreaza(email: string, con: ReturnType<typeof conexiune>): void {
  apel.inregistreazaPrezenta(email, con)
  prezente.push([email, con])
}

afterEach(() => {
  for (const [email, con] of prezente.splice(0).reverse()) apel.scoatePrezenta(email, con)
})

describe('services/apel.ts — messenger Kelion↔Kelion (prezență + semnalizare)', () => {
  it('prezența: un user devine online la înregistrare și offline când pleacă', () => {
    const c = conexiune()
    expect(apel.esteOnline('maria@x.com')).toBe(false)
    inregistreaza('maria@x.com', c)
    expect(apel.esteOnline('maria@x.com')).toBe(true)
    apel.scoatePrezenta('maria@x.com', c)
    expect(apel.esteOnline('maria@x.com')).toBe(false)
  })

  it('sunaUtilizator: user negăsit → motiv user_negasit', async () => {
    const r = await apel.sunaUtilizator('adrian@x.com', 'Cineva Inexistent')
    expect(r.ok).toBe(false)
    expect(r.motiv).toBe('user_negasit')
  })

  it('sunaUtilizator: mai mulți candidați → ambiguu, cu lista', async () => {
    // „ion" prinde și Ion Popescu, și Ionel → doi candidați distincți.
    const r = await apel.sunaUtilizator('adrian@x.com', 'ion')
    expect(r.ok).toBe(false)
    expect(r.motiv).toBe('ambiguu')
    expect((r.candidati ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('sunaUtilizator: ținta există dar e offline → motiv offline', async () => {
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    expect(r.ok).toBe(false)
    expect(r.motiv).toBe('offline')
    expect(r.cu?.email).toBe('maria@x.com')
  })

  it('sunaUtilizator: ținta online → invitația ajunge la ea', async () => {
    const cMaria = conexiune()
    inregistreaza('maria@x.com', cMaria)
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    expect(r.ok).toBe(true)
    expect(r.callId).toBeTruthy()
    const invite = cMaria.mesaje.find((m) => m.type === 'invite')
    expect(invite).toBeTruthy()
    expect(invite.callId).toBe(r.callId)
    expect(invite.from.email).toBe('adrian@x.com')
    expect(invite.from.name).toBe('Adrian') // numele apelantului, rezolvat din director
  })

  it('accept: ambele părți primesc „accepted"', async () => {
    const cA = conexiune()
    const cM = conexiune()
    inregistreaza('adrian@x.com', cA)
    inregistreaza('maria@x.com', cM)
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    apel.gestioneazaMesaj('maria@x.com', { type: 'accept', callId: r.callId })
    expect(cA.mesaje.some((m) => m.type === 'accepted' && m.callId === r.callId)).toBe(true)
    expect(cM.mesaje.some((m) => m.type === 'accepted' && m.callId === r.callId)).toBe(true)
  })

  it('decline: doar cel SUNAT poate refuza, iar apelantul e anunțat', async () => {
    const cA = conexiune()
    const cM = conexiune()
    inregistreaza('adrian@x.com', cA)
    inregistreaza('maria@x.com', cM)
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    // Apelantul NU poate refuza propriul apel (nu e „cel sunat").
    apel.gestioneazaMesaj('adrian@x.com', { type: 'decline', callId: r.callId })
    expect(cA.mesaje.some((m) => m.type === 'declined')).toBe(false)
    // Cel sunat refuză → apelantul primește „declined".
    apel.gestioneazaMesaj('maria@x.com', { type: 'decline', callId: r.callId })
    expect(cA.mesaje.some((m) => m.type === 'declined' && m.callId === r.callId)).toBe(true)
  })

  it('hangup: cealaltă parte primește „hangup" (nu cel care a închis)', async () => {
    const cA = conexiune()
    const cM = conexiune()
    inregistreaza('adrian@x.com', cA)
    inregistreaza('maria@x.com', cM)
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    apel.gestioneazaMesaj('maria@x.com', { type: 'accept', callId: r.callId })
    apel.gestioneazaMesaj('adrian@x.com', { type: 'hangup', callId: r.callId })
    expect(cM.mesaje.some((m) => m.type === 'hangup' && m.callId === r.callId)).toBe(true)
  })

  it('plecare bruscă: dacă un participant iese complet, celălalt e anunțat', async () => {
    const cA = conexiune()
    const cM = conexiune()
    inregistreaza('adrian@x.com', cA)
    inregistreaza('maria@x.com', cM)
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    apel.gestioneazaMesaj('maria@x.com', { type: 'accept', callId: r.callId })
    // Adrian închide tab-ul (fără hangup explicit) → Maria trebuie anunțată.
    apel.scoatePrezenta('adrian@x.com', cA)
    expect(cM.mesaje.some((m) => m.type === 'hangup' && m.callId === r.callId)).toBe(true)
  })

  it('un al doilea tab ține userul online — apelul nu pică la închiderea unuia', async () => {
    const cA1 = conexiune()
    const cA2 = conexiune()
    const cM = conexiune()
    inregistreaza('adrian@x.com', cA1)
    inregistreaza('adrian@x.com', cA2)
    inregistreaza('maria@x.com', cM)
    const r = await apel.sunaUtilizator('adrian@x.com', 'Maria')
    apel.gestioneazaMesaj('maria@x.com', { type: 'accept', callId: r.callId })
    apel.scoatePrezenta('adrian@x.com', cA1) // mai are un tab
    expect(apel.esteOnline('adrian@x.com')).toBe(true)
    expect(cM.mesaje.some((m) => m.type === 'hangup')).toBe(false)
  })
})
