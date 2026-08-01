import { describe, it, expect } from 'vitest'
import { UNELTELE_MAINILOR } from './services/autonomie.js'
import { SHARED_ADMIN_TOOLS, USER_SCOPED_TOOLS } from './services/adminTools.js'

// ── THE GUARD: WHATEVER BRAIN GETS SWAPPED IN, IT ALWAYS GETS EVERYTHING ───
//
// Adrian, Jul 31: "so you must make sure that whatever brain gets swapped in
// always receives everything" · "the 75 aware ones for its brain, whichever
// is put in".
//
// The requirement is not about a specific model — it's about MODEL
// INDEPENDENCE. Today the brain is OpenRouter, tomorrow Claude directly, the
// day after another. The capabilities must not depend on which one is in:
// they derive from the registry and the executor, not from a list I wrote by
// hand for a specific model.
//
// The bug that imposed this guard: the executor (`execSharedAdminTool` +
// `execUserScopedTool`) knew how to route a whole set, but the list given to
// the MODEL was written separately and had fallen 7 tools behind. And the
// inventory in the prompt told it it had them — so the brain asked for a tool
// that didn't exist in the list and got a "can't" for something the code
// underneath really could do.
//
// This test falls the moment the two diverge again.
describe('orice creier primește TOT ce știe executorul să ruleze', () => {
  const numeInMana = new Set(UNELTELE_MAINILOR.map((t) => t.name))

  // Tools the executor routes, but which have NO business in its autonomous
  // hand — each with the reason written. An exception without a reason is a
  // leak.
  const DOAR_CU_OM_DE_FAȚĂ = new Map<string, string>([
    // It asks for your approval with a click in Admin → Kelion Tools; in the
    // night loop there is nobody to approve, so the order would wait forever.
    ['propose_tool', 'așteaptă aprobarea ownerului, nu se poate în buclă'],
    // It logs a gap for YOU, in conversation. The loop has `cerinta_noua`.
    ['log_unsupported_request', 'e pentru conversație; bucla scrie în cerinte'],
    // The guest-voice trio needs the HOLDER PRESENT: he asks for the window,
    // the guest speaks into the room's microphone, he confirms the print. In
    // the night loop there is no microphone and no guest.
    ['allow_guest_voice', 'fereastra se deschide la cererea titularului, cu microfonul în cameră'],
    ['approve_guest_voice', 'confirmarea aparține titularului, în conversație'],
    ['forget_guest', 'decizia de uitare aparține titularului, în conversație'],
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
    // The browser has its executor directly in `uneltele()` (a switch on
    // browser_*), because it's per-user and doesn't go through the shared
    // dispatch.
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
