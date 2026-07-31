import { describe, it, expect } from 'vitest'
import { UNELTELE_MAINILOR } from './services/autonomie.js'
import { SHARED_ADMIN_TOOLS, USER_SCOPED_TOOLS } from './services/adminTools.js'

// ── PAZNICUL: ORICE CREIER SE SCHIMBĂ, PRIMEȘTE ÎNTOTDEAUNA TOT ──────────────
//
// Adrian, 31 iul: „deci trebuie să te asiguri că orice creier se schimbă
// primește întotdeauna tot" · „cele 75 conștiente pentru creierul lui, oricare
// se pune".
//
// Cerința nu e despre un model anume — e despre INDEPENDENȚA de model. Astăzi
// creierul e OpenRouter, mâine Claude direct, poimâine altul. Capabilitățile
// nu au voie să depindă de care e pus: se derivă din registru și din executor,
// nu din lista pe care am scris-o eu de mână pentru un model anume.
//
// Bugul care a impus paznicul ăsta: executorul (`execSharedAdminTool` +
// `execUserScopedTool`) știa să ruteze un set întreg, dar lista dată MODELULUI
// era scrisă separat și rămăsese în urmă cu 7 unelte. Iar inventarul din prompt
// îi spunea că le are — deci creierul cerea o unealtă care nu exista în listă
// și primea un „nu pot" pentru ceva ce codul de dedesubt chiar putea face.
//
// Testul ăsta cade în clipa în care cele două diverg din nou.
describe('orice creier primește TOT ce știe executorul să ruleze', () => {
  const numeInMana = new Set(UNELTELE_MAINILOR.map((t) => t.name))

  // Unelte pe care executorul le rutează, dar care NU au ce căuta în mâna lui
  // autonomă — fiecare cu motivul scris. O excepție fără motiv e o scăpare.
  const DOAR_CU_OM_DE_FAȚĂ = new Map<string, string>([
    // Cere aprobarea ta cu un click în Admin → Unelte Kelion; în bucla de
    // noapte n-are cine aproba, deci ordinul ar aștepta la infinit.
    ['propose_tool', 'așteaptă aprobarea ownerului, nu se poate în buclă'],
    // Notează un gol pentru TINE, în conversație. Bucla are `cerinta_noua`.
    ['log_unsupported_request', 'e pentru conversație; bucla scrie în cerinte'],
  ])

  it('fiecare unealtă rutată de executor e ȘI în mâna lui — sau are motiv scris', () => {
    const rutate = [...SHARED_ADMIN_TOOLS, ...USER_SCOPED_TOOLS]
    const lipsa = rutate.filter((n) => !numeInMana.has(n) && !DOAR_CU_OM_DE_FAȚĂ.has(n))
    expect(
      lipsa,
      `Executorul le rutează, dar creierul nu le primește în mână: ${lipsa.join(', ')}. ` +
        `Ori le adaugi în UNELTELE_MAINILOR, ori le scrii motivul în DOAR_CU_OM_DE_FAȚĂ.`,
    ).toEqual([])
  })

  it('nicio unealtă în mână fără executor — altfel ar cere ceva ce nimeni nu execută', () => {
    // Browserul are executorul lui direct în `uneltele()` (switch pe
    // browser_*), fiindcă e per-user și nu trece prin dispatch-ul partajat.
    const orfane = [...numeInMana].filter(
      (n) => !n.startsWith('browser_') && !SHARED_ADMIN_TOOLS.has(n) && !USER_SCOPED_TOOLS.has(n),
    )
    expect(
      orfane,
      `I le dăm în mână, dar nimeni nu le rulează: ${orfane.join(', ')}`,
    ).toEqual([])
  })

  it('fiecare unealtă are nume și descriere — creierul alege după descriere', () => {
    for (const t of UNELTELE_MAINILOR) {
      expect(t.name, 'unealtă fără nume').toBeTruthy()
      expect(t.description, `${t.name} n-are descriere — creierul nu poate ști când s-o folosească`).toBeTruthy()
      expect(t.input_schema, `${t.name} n-are schemă de intrare`).toBeTruthy()
    }
  })

  it('fără duplicate — aceeași unealtă de două ori derutează creierul', () => {
    const nume = UNELTELE_MAINILOR.map((t) => t.name)
    expect(new Set(nume).size).toBe(nume.length)
  })
})
