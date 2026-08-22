import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── DOVADA LANȚULUI DEVIN, CAP-COADĂ (owner, 22 aug: „astept dovada ca devin
// functioneaza pina la deploy" + „full devin activ si funtional") ─────────────
//
// Ce se poate proba FĂRĂ cheia reală (cheia DEVIN_API_KEY trăiește doar pe
// VPS): fiecare za a lanțului, pe cod viu + testele executabile ale
// dispecerului (devinConstructor.test.ts — pornire, poll, PR în chat, un job
// pe rând). Ce rămâne onest „nu pot verifica" de aici: comportamentul REAL al
// API-ului Devin (câmpul PR, clonarea cu secretul) — se măsoară la primul
// ordin live al ownerului.
//
// Lanțul: ordin scris în chat → creier (/api/chat) → build_software →
// evalueazaOrdin (poarta calității) → createBuildJob (coada, dedup) →
// PORNIRE IMEDIATĂ tickDispecerDevin (nu aștepta ora buclei) → sesiune cu
// prompt strict → poll cu bară reală → PR + link ÎN CHAT (notifyAdmin).
//
// Pinurile se fac pe COD VIU: comentariile se aruncă întâi (lecția M6).
const aici = dirname(fileURLToPath(import.meta.url))
function codViu(rel: string): string {
  return readFileSync(join(aici, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}
const chat = codViu('routes/chat.ts')
const db = codViu('db.ts')
const autonomie = codViu('services/autonomie.ts')
const dispecer = codViu('services/devinConstructor.ts')
const index = codViu('index.ts')

describe('lanțul Devin — fiecare za, pe cod viu', () => {
  it('za 1: ordinul din chat intră prin build_software cu poarta calității + coada dedup', () => {
    expect(chat).toMatch(/case 'build_software':[\s\S]{0,1600}evalueazaOrdin\(order\)/)
    expect(chat).toMatch(/case 'build_software':[\s\S]{0,2600}createBuildJob\(email, order\)/)
  })

  it('za 2: comanda PORNEȘTE Devin imediat — nu așteaptă ora buclei de autonomie', () => {
    // Gaura măsurată (22 aug): pauza buclei urcă la 60 min pe „nimic de făcut",
    // iar ramura devinKey din porneculLucratorulConstructor era un simplu
    // return — ordinul zăcea în coadă până la o oră. Acum ramura cheamă
    // tickDispecerDevin în fundal.
    expect(chat).toMatch(/if \(config\.devinKey\) \{\s*void import\('\.\.\/services\/devinConstructor\.js'\)\s*\.then\(\(\{ tickDispecerDevin \}\) => tickDispecerDevin\(\)\)/)
    // ...și build_software chiar cheamă pornitorul.
    expect(chat).toMatch(/case 'build_software':[\s\S]{0,3400}porneculLucratorulConstructor\(\)/)
  })

  it('za 3: dispecerul rulează și pe bucla de autonomie, înaintea oricărui alt lucru', () => {
    expect(autonomie).toMatch(/tickDispecerDevin\(\)\.catch/)
    expect(index).toContain('startAutonomie()')
  })

  it('za 4: FĂRĂ bani dubli — un job cu sesiune Devin vie nu poate fi furat/repus', () => {
    // Watchdog-ul (requeue) nu repune jobul cu sesiune externă vie:
    expect(db).toMatch(/\[watchdog: repus în coadă[\s\S]{0,1400}AND devin_session_id IS NULL/)
    // ...și claim-ul nu fură running-stătut decât FĂRĂ sesiune Devin:
    expect(db).toMatch(/status='running' AND updated_at < now\(\) - interval '\$\{MIN_JOB_BLOCAT\} minutes' AND devin_session_id IS NULL\)\)/)
    // ...iar dispecerul însuși refuză jobul claimat-fără-sesiune (nu pornește a doua).
    expect(dispecer).toMatch(/if \(!run\.devinSessionId\) return/)
  })

  it('za 5: fără cheie, dispecerul e inert (nu pornește nimic în teste/medii fără Devin)', () => {
    expect(dispecer).toMatch(/if \(!config\.devinKey\) return/)
  })

  it('za 6: worker-ul local NU se bate cu Devin pe coadă (ruta /next gardată)', () => {
    const constructorRoute = codViu('routes/constructor.ts')
    expect(constructorRoute).toMatch(/if \(config\.devinKey\) return reply\.send\(\{ job: null, devin: true \}\)/)
  })

  it('za 7: terminarea ajunge ÎN CHAT cu linkul PR (nu doar pe monitor)', () => {
    expect(dispecer).toMatch(/PR gata: \$\{prog\.prUrl\}/)
    expect(dispecer).toMatch(/instiinteazaAdmin\('scris', `Devin a terminat ordinul/)
  })

  it('za 8: erorile NU pleacă la Jules — jules_task refuză cât cheia Devin e pusă', () => {
    // Owner, 22 aug, măsurat pe live: „kelion trimite catre jules err si nu
    // lui devin". Poarta e în COD (adminTools), nu în fișa uneltei — modelul
    // alegea singur jules_task pentru reparații.
    const adminTools = codViu('services/adminTools.ts')
    expect(adminTools).toMatch(/case 'jules_task': \{\s*if \(config\.devinKey\) \{/)
    expect(adminTools).toMatch(/constructorul_e_devin/)
    // ...iar fișa spune adevărul, ca modelul să nu-l mai aleagă:
    const defs = codViu('services/brainToolDefs.ts')
    expect(defs).toMatch(/NOT the constructor — DEVIN is/)
  })

  it('za 9: inventarul ȘTIE că Devin e constructorul (măsurat pe live: „Devin nu face parte din uneltele noastre")', () => {
    // Captura ownerului (V7.6): întrebat dacă Devin e prezent, modelul a negat
    // — corect după inventarul de ATUNCI: nicio unealtă nu purta numele Devin
    // (dispecerul stă în spatele lui build_software). Fișa + registrul spun
    // acum adevărul, iar negarea măsurată e în gardul anti-negare.
    const defs = codViu('services/brainToolDefs.ts')
    expect(defs).toMatch(/THIS IS HOW YOU CALL DEVIN/)
    const registru = codViu('services/brainCapabilities.ts')
    expect(registru).toMatch(/dă ordinul constructorului DEVIN/)
    const negare = codViu('services/negareUnelte.ts')
    expect(negare).toMatch(/devin\\s\+nu\\s\+face\\s\+parte\\s\+din\\s\+unelte/)
  })

  it('za 10: TOATE ușile de depunere pornesc Devin imediat — panoul admin, Reia și self-heal', () => {
    // Owner, 22 aug: „Devin handles all constructor tasks" — nu doar chat-ul.
    // Un ordin depus din panou nu are voie să zacă până la ora buclei.
    const rute = codViu('routes/constructor.ts')
    expect(rute).toMatch(/createBuildJob\(user\.email, order\)[\s\S]{0,700}pornesteDevinInFundal\(\)/)
    expect(rute).toMatch(/retryBuildJob\(id, req\.body\?\.order\)[\s\S]{0,700}pornesteDevinInFundal\(\)/)
    const heal = codViu('services/selfHeal.ts')
    expect(heal).toMatch(/pornesteDevinInFundal\(\)/)
  })

  it('za 11: self-heal NU mai pune mâna Aider cât Devin e constructorul (un singur constructor pe cauză)', () => {
    const heal = codViu('services/selfHeal.ts')
    expect(heal).toMatch(/if \(constructorulEsteDevin\(\)\) return ''/)
  })

  it('za 12: diagnosticul și panoul judecă DEVINUL, nu lanțul vechi, cât cheia e pusă', () => {
    // Fără asta, „aider_jos"/„lucrator_mort" ar fi alarme false exact când
    // ordinele pleacă la Devin — iar panoul ar minți că nimeni nu construiește.
    const diag = codViu('services/diagnosticConstructor.ts')
    expect(diag).toMatch(/devin_jos/)
    expect(diag).toMatch(/devinActiv: devinDisponibil\(\)/)
    const rute = codViu('routes/constructor.ts')
    expect(rute).toMatch(/probaDevin/)
  })
})
