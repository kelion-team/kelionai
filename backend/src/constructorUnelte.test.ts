import { describe, it, expect } from 'vitest'
import { UNELTE_CONSTRUCTOR } from './services/brainToolDefs.js'
import { SHARED_ADMIN_TOOLS, USER_SCOPED_TOOLS } from './services/adminTools.js'

// ── CONSTRUCTORUL ARE TOT (Adrian, 10 aug: „dă-i TOT, deblochează TOT; și să
// nu-i mai scoți nimic fără știrea mea") ────────────────────────────────────────
// Lista `UNELTE_CONSTRUCTOR` e sursa unică din care worker-ul (constructor-agent.mjs)
// își ia uneltele de dev/ops la pornire. Testul ăsta o LEAGĂ de sursa reală: dacă
// cineva scoate o unealtă de admin din constructor pe furiș, poarta se aprinde
// roșu. Adăugarea unei unelte noi de admin fără s-o dea și constructorului = tot roșu.
describe('constructorul are toate uneltele de dev/ops (sursa unică)', () => {
  const nume = new Set(UNELTE_CONSTRUCTOR.map((t) => t.name))

  it('acoperă TOT SHARED_ADMIN_TOOLS — nimic nu poate fi scos pe furiș (inclusiv repo_*/merge)', () => {
    // Adrian, 10 aug: „dă-i TOT" + „să fie capabil să dea PR-ul [să-l îmbine]".
    const lipsa = [...SHARED_ADMIN_TOOLS].filter((n) => !nume.has(n))
    expect(lipsa, `unelte de admin pe care constructorul NU le are: ${lipsa.join(', ')}`).toEqual([])
  })

  it('poate îmbina singur PR-ul (repo_merge_pr) și scrie/deschide PR (repo_write/repo_open_pr)', () => {
    for (const n of ['repo_write', 'repo_open_pr', 'repo_merge_pr'])
      expect(nume.has(n), `constructorul nu are ${n}`).toBe(true)
  })

  it('acoperă uneltele user-scoped care se execută prin uneltele() (memorie/loguri/inbox/cost/updates)', () => {
    // Cele rutate de uneltele() prin execUserScopedTool și incluse în TOATE_UNELTELE_ADMIN.
    const cerute = ['list_memories', 'forget_memory', 'server_logs', 'read_inbox', 'get_real_cost', 'list_updates', 'log_unsupported_request']
    const lipsa = cerute.filter((n) => !nume.has(n))
    expect(lipsa, `unelte user-scoped lipsă la constructor: ${lipsa.join(', ')}`).toEqual([])
    // referință folosită, ca să nu pară import mort dacă lista de mai sus se schimbă
    expect(USER_SCOPED_TOOLS.size).toBeGreaterThan(0)
  })

  it('include agenții (cheama_agent, agent_nou) și browserul', () => {
    for (const n of ['cheama_agent', 'agent_nou', 'browser_open', 'browser_read'])
      expect(nume.has(n), `constructorul nu are ${n}`).toBe(true)
  })

  it('fiecare unealtă are nume + descriere (nimic gol)', () => {
    for (const t of UNELTE_CONSTRUCTOR) {
      expect(t.name, 'nume gol').toBeTruthy()
      expect(t.description, `descriere goală la ${t.name}`).toBeTruthy()
    }
  })
})
