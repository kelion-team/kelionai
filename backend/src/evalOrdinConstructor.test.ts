import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clasificaActiuneConstructor, evalueazaOrdin, AI_CONSTRUCTORI } from './services/evalOrdinConstructor.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

// Poarta de calitate + clasamentul pe capacitate (owner, 13 aug). Probele stau la
// capete: ordin gol/vag/în-afară RESPINS; cod în repo → constructorul local; mare
// izolat → Jules; analiză pură → creierul 2; creditul roșu coboară AI-ul.

describe('poarta de calitate — NU orice ordin trece', () => {
  it('ordin prea scurt e respins, cu motiv', () => {
    const e = evalueazaOrdin('fă')
    expect(e.trece).toBe(false)
    expect(e.motiv).toMatch(/scurt/i)
    expect(e.aiRecomandat).toBeNull()
  })

  it('cerință vagă (temă fără acțiune și fără țintă) e respinsă', () => {
    const e = evalueazaOrdin('ceva frumos acolo')
    expect(e.trece).toBe(false)
    expect(e.motiv).toMatch(/vag/i)
  })

  it('cerere din afara scopului (lumea reală) e respinsă cinstit', () => {
    const e = evalueazaOrdin('sună-l pe furnizor și comandă mâncare')
    expect(e.trece).toBe(false)
    expect(e.motiv).toMatch(/în afara|in afara/i)
  })

  it('ordin clar de cod trece și cere capacități', () => {
    const e = evalueazaOrdin('repară butonul din bara de sus și adaugă un test')
    expect(e.trece).toBe(true)
    expect(e.capacitatiNecesare.length).toBeGreaterThan(0)
    expect(e.aiRecomandat).not.toBeNull()
  })
})

describe('clasamentul pe capacitate + credit', () => {
  it('reparație de cod în repo → constructorul local sus', () => {
    const e = evalueazaOrdin('repară eroarea din endpoint-ul de login și rulează testele')
    expect(e.aiRecomandat).toBe('constructor')
    expect(e.clasament[0]?.cheie).toBe('constructor')
  })

  it('sarcină mare, izolată, în fundal → tot constructorul local (Jules e rezervă tăcută)', () => {
    // Owner, 15 aug: „Pune-l rezerva tacuta, invizibil" — Jules a ieșit din
    // clasament; sarcinile mari/asincrone cad la constructorul local, iar
    // Jules se cheamă DOAR prin uneltele jules_*, la ordin explicit.
    const e = evalueazaOrdin('refac complet tot modulul, o sarcină mare care poate rula în fundal peste noapte')
    expect(e.aiRecomandat).toBe('constructor')
    expect(e.clasament.some((r) => r.cheie === 'jules')).toBe(false)
  })

  it('cerință de analiză/planificare fără cod → creierul 2', () => {
    const e = evalueazaOrdin('analizează de ce se împotmolește și planifică pașii')
    expect(e.aiRecomandat).toBe('creier2')
  })

  it('creditul ROȘU coboară AI-ul recomandat (nu-l trimitem fără cu ce lucra)', () => {
    const ordin = 'repară butonul și rulează testele'
    const faraCredit = evalueazaOrdin(ordin)
    expect(faraCredit.aiRecomandat).toBe('constructor')
    // constructorul local pe roșu → nu mai e recomandat primul
    const cuRosu = evalueazaOrdin(ordin, { 'creierul constructorului': 'rosu' })
    expect(cuRosu.aiRecomandat).not.toBe('constructor')
    // becul e purtat în clasament, ca panoul să-l poată arăta
    const randConstructor = cuRosu.clasament.find((r) => r.cheie === 'constructor')
    expect(randConstructor?.bec).toBe('rosu')
  })

  it('clasamentul acoperă exact AI-urile VIZIBILE (Jules e rezervă tăcută, 15 aug)', () => {
    const e = evalueazaOrdin('adaugă un endpoint nou în backend')
    expect(e.clasament.map((r) => r.cheie).sort()).toEqual(['constructor', 'creier2'])
    expect(AI_CONSTRUCTORI).toHaveLength(2)
  })
})

describe('LACĂT — poarta e ENFORCED la intrarea ordinului (nu doar în panou)', () => {
  const rute = sursa('./routes/constructor.ts')

  it('POST /api/admin/constructor respinge ordinele care nu trec poarta, cu motiv', () => {
    // Dacă cineva scoate poarta din rută, un ordin gol/vag ar intra iar în coadă
    // și ar arde credit — exact ce a interzis ownerul („să treacă orice ordin?").
    expect(/evalueazaOrdin\(order\)/.test(rute)).toBe(true)
    expect(/if \(!ev\.trece\) return reply\.code\(400\)\.send\(\{ error: 'ordin_respins', motiv: ev\.motiv \}\)/.test(rute)).toBe(true)
  })

  it('endpointul de evaluare există și dă AI-urile + creditul live', () => {
    expect(/\/api\/admin\/constructor\/evalueaza/.test(rute)).toBe(true)
    expect(/hartaCreditConstructor\(\)/.test(rute)).toBe(true)
  })

  it('respinge actiunea directa de screenshot, inclusiv cand boilerplate-ul autonom vorbeste despre cod', () => {
    expect(clasificaActiuneConstructor('fă un screenshot proaspăt la monitor și focalizează pe bara de admin')).toBe('directa')
    expect(clasificaActiuneConstructor('fă un buton în bara de admin')).toBe('neclara')
    expect(evalueazaOrdin('fă un buton în bara de admin').trece).toBe(false)
    const direct = evalueazaOrdin('fă un screenshot proaspăt la monitor și focalizează pe bara de admin')
    expect(direct.trece).toBe(false)
    expect(direct.motiv).toContain('acțiune directă de ecran/browser')

    const ambalat = evalueazaOrdin(
      'NIVEL DE DIFICULTATE: 1/5\n\nCERINȚA OWNERULUI #57.\n\n' +
      'CE A CERUT: fă un screenshot proaspăt la monitor și focalizează pe bara de admin\n\n' +
      'Fă-o cap-coadă: rescrie codul și scrie teste.',
    )
    expect(ambalat.trece).toBe(false)
  })

  it.each([
    'repară butonul de login',
    'modifică fișierul backend/src/index.ts',
    'refactorizează modulul de autentificare',
    'implementează un endpoint API',
    'construiește tabela SQL pentru plăți neatribuite',
    'build the backend payment module',
    'fix the frontend login button',
    'refactor the backend module',
  ])('clasifică verbul tehnic + ținta repo drept cod: %s', (ordin) => {
    expect(clasificaActiuneConstructor(ordin)).toBe('cod')
  })

  it.each([
    'fă un screenshot la monitor',
    'deschide browserul',
    'dă click pe buton',
    'trimite un email',
    'take a screenshot of the admin bar',
    'open the browser',
  ])('clasifică acțiunea executată acum drept directă: %s', (ordin) => {
    expect(clasificaActiuneConstructor(ordin)).toBe('directa')
  })

  it('permite construirea explicita a unei functionalitati de screenshot', () => {
    const ordin = 'implementează în frontend funcționalitatea de screenshot pentru bara de admin și scrie teste automate'
    expect(clasificaActiuneConstructor(ordin)).toBe('cod')
    const r = evalueazaOrdin(ordin)
    expect(r.trece).toBe(true)
    expect(r.capacitatiNecesare).toContain('frontend')
  })

})
