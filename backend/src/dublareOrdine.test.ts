// ORDINUL VERBATIM (owner, 15 aug): „ordinele de rezolvat nu au voie sa se
// dubleze nici o data". Ușa unică e createBuildJob: un ordin VIU cu aceeași
// amprentă → al doilea NU se naște (se întoarce id-ul celui viu). Un ordin
// ÎNCHEIAT nu blochează — „reia"-ul deliberat rămâne posibil.
//
// Ca la scutulDatelor: comportamentul care trăiește lângă pool-ul viu se ține
// prin lacăt pe SURSĂ; funcția pură (amprenta) se probează la rulare.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { amprentaOrdin, eEroarePermanenta, MARCAJ_P27 } from './db.js'

const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8')

describe('amprentaOrdin (proba la rulare)', () => {
  it('aceeași eroare cu ore/contoare diferite = ACELAȘI ordin', () => {
    const a = amprentaOrdin('AUTO-VINDECARE: [13:31:58] llm fatal — creier 502 (count=2, prag=2), încercarea 1')
    const b = amprentaOrdin('AUTO-VINDECARE: [09:05:11] llm fatal — creier 502 (count=7, prag=2), încercarea 3')
    expect(a).toBe(b)
  })

  it('ordine diferite au amprente diferite', () => {
    expect(amprentaOrdin('repară selectorul de limbă')).not.toBe(amprentaOrdin('repară bara de deploy'))
  })
})

describe('lacătul pe sursă: createBuildJob refuză dublurile', () => {
  it('caută ordinele VII (queued/running) înainte de INSERT', () => {
    const corp = db.slice(db.indexOf('export async function createBuildJob'))
    const cautare = corp.indexOf("status IN ('queued','running')")
    const insert = corp.indexOf('INSERT INTO build_jobs')
    expect(cautare).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(-1)
    expect(cautare).toBeLessThan(insert) // întâi dublurile, abia apoi nașterea
  })

  it('dublura vie întoarce id-ul ordinului existent, nu creează al doilea', () => {
    const corp = db.slice(db.indexOf('export async function createBuildJob'))
    expect(corp).toContain('amprentaOrdin(orderText)')
    expect(corp).toContain('return Number(dublura.id)')
  })

  it('ordinul verbatim al ownerului stă scris la ușă (să nu-l „optimizeze" nimeni)', () => {
    expect(db).toContain('ordinele de rezolvat nu au voie sa se dubleze nici o data')
  })
})

// ── P27 (owner, 15 aug, LEGE: „la constructor, trebuie 1 singur ordin, nu se
// fac mai multe ordine pe acelasi subiect, lege, se rezolva, se arhiveaza,
// sau se escaladeaza sau se raporteaza la kelion") ───────────────────────────
// Jurnalul #324, măsurat: „Your credit balance is too low" reîncercat orbește
// de 6 ori. Legea de aici: eroarea PERMANENTĂ omoară ordinul la PRIMUL raport,
// cu verdict pe nume, iar mortul se RAPORTEAZĂ lui Kelion — nu rămâne zombie.
describe('P27 — erorile PERMANENTE opresc reîncercarea din prima (proba la rulare)', () => {
  it('punga Anthropic goală (jurnalul #324) = permanentă, cu verdictul pe nume', () => {
    expect(eEroarePermanenta('API error: {"type":"error","error":{"message":"Your credit balance is too low..."}}')).toMatch(/cont fără credit API/)
    expect(eEroarePermanenta('fable5 FĂRĂ CREDIT API: contul Anthropic n-are credit')).toMatch(/cont fără credit API/)
  })

  it('cheia respinsă = permanentă; verdictul spune „config, nu codul"', () => {
    expect(eEroarePermanenta('401 authentication_error: invalid x-api-key')).toMatch(/config, nu codul/)
    expect(eEroarePermanenta('API key not valid. Please pass a valid API key.')).toMatch(/config, nu codul/)
  })

  it('panele TRECĂTOARE nu sunt permanente (au dreptul la reîncercare/vindecător)', () => {
    // 402-ul OpenRouter are vindecătorul lui de pungă (requeueMoneyFailedBuildJobs)
    expect(eEroarePermanenta('402 requires more credits')).toBeNull()
    expect(eEroarePermanenta('timeout: npm install a durat peste 10 min')).toBeNull()
    expect(eEroarePermanenta('creier 502 — indisponibil temporar')).toBeNull()
  })
})

describe('P27 — lacătele pe sursă: mortul pe nume nu mai e reluat orbește și se raportează', () => {
  it('reportBuildJob ștampilează verdictul și îngheață ordinul (attempts=99)', () => {
    const corp = db.slice(db.indexOf('export async function reportBuildJob'))
    expect(corp).toContain('eEroarePermanenta(log)')
    expect(corp).toContain("inghetat = ', attempts = 99'")
  })

  it('raportarea la Kelion: golul intră în triaj + panoul e anunțat, iar eșecul raportării se strigă', () => {
    const corp = db.slice(db.indexOf('export async function reportBuildJob'))
    expect(corp).toContain("logCapabilityGap('constructor'")
    expect(corp).toContain('notifyAdmin')
    expect(corp).toContain('[P27] raportarea la Kelion a picat:')
  })

  it('plasa stale-running și vindecătorul de pungă OCOLESC ordinele înghețate P27', () => {
    expect(db.match(/NOT LIKE '%\[P27: eroare PERMANENT%'/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('„reia"-ul deliberat al ownerului rămâne posibil (retryBuildJob dezgheață cu attempts=0)', () => {
    const corp = db.slice(db.indexOf('export async function retryBuildJob'))
    expect(corp).toContain("status='queued', attempts=0")
  })

  it('marcajul e o singură constantă (nu două texte care pot diverge)', () => {
    expect(MARCAJ_P27).toBe('[P27: eroare PERMANENTĂ')
  })
})
