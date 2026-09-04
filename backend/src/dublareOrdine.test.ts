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
import { amprentaOrdin, seamanaOrdinele } from './db.js'

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

describe('ACELAȘI SUBIECT în alte cuvinte = dublură (owner, 16 aug: „am cerut unicitate pe ordin, e normal sa ma ignori?")', () => {
  // Textele REALE din coada lui — trei ordine VII pe același audit de hardcod.
  const O334 = 'Perform full codebase audit for hardcoded values and UI bubble formatting fixes'
  const O335 = 'Perform a comprehensive audit of the entire codebase to detect and eliminate any hardcoded values, static fallback strings'
  const O338 = 'Scan the entire codebase (frontend and backend) for remaining hardcoded values, static fallback strings, fixed'

  it('tripleta din captura lui se prinde: 335~338, 334~335', () => {
    expect(seamanaOrdinele(O335, O338)).toBe(true)
    expect(seamanaOrdinele(O334, O335)).toBe(true)
  })

  it('ordine chiar DIFERITE nu se confundă (fals-pozitivul ar bloca lucrul real)', () => {
    const websocket = 'Audio Chat: Implement robust websocket reconnection logic for code 1006'
    const vindecare = 'AUTO-VINDECARE (server logs): în server.logbuffer apare RECURENT eroarea count=2 prag=2'
    expect(seamanaOrdinele(O335, websocket)).toBe(false)
    expect(seamanaOrdinele(O335, vindecare)).toBe(false)
    expect(seamanaOrdinele(websocket, vindecare)).toBe(false)
  })

  it('ordinele scurte nu intră la ghicit (sub 4 cuvinte de conținut = fără verdict)', () => {
    expect(seamanaOrdinele('repară login', 'repară login acum')).toBe(false)
  })

  it('lacăt pe sursă: ușa unică folosește și asemănarea de subiect, nu doar amprenta exactă', () => {
    expect(db).toMatch(/seamanaOrdinele\(rand\.order_text, orderText\)/)
    expect(db).toMatch(/același subiect refuzat/)
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
    expect(corp).toContain('return { id: Number(dublura.id), created: false, status: dublura.status }')
  })

  it('serializes SELECT plus INSERT and scans every live order', () => {
    const corp = db.slice(db.indexOf('export async function createBuildJob'), db.indexOf('export interface ConstructorIncidentKnowledge'))
    expect(corp).toContain("pg_advisory_xact_lock(hashtext('constructor:create-build-job'))")
    expect(corp).not.toMatch(/WHERE status IN \('queued','running'\)[\s\S]{0,80}LIMIT 200/)
    expect(corp).toContain("await client.query('ROLLBACK')")
  })

  it('ordinul verbatim al ownerului stă scris la ușă (să nu-l „optimizeze" nimeni)', () => {
    expect(db).toContain('ordinele de rezolvat nu au voie sa se dubleze nici o data')
  })

  it('persistă identitatea executorului local chiar de la nașterea unui job nou', () => {
    const corp = db.slice(db.indexOf('export async function createBuildJob'))
    expect(corp).toContain('INSERT INTO build_jobs (ordered_by, order_text, brain) VALUES ($1, $2, $3)')
    expect(corp).toContain('[accountKey, orderText, CONSTRUCTOR_LOCAL_ACTOR]')
  })
})

// ── 16 aug 05:47 (ownerul, cu #330 „Lucrează" în față: „aici nu esti tu" /
// „cine e acolo?"): AUTORUL fiecărui ordin stă LA VEDERE pe card. ─────────────
describe('autorul ordinului, pe față (cine e acolo?)', () => {
  it('cineACerut traduce ordered_by în etichete pe românește', async () => {
    const { cineACerut } = await import('./services/numeOrdin.js')
    expect(cineACerut('codex-worker')).toBe('codex-worker')
    expect(cineACerut('owner@example.test')).toBe('👤 owner')
    expect(cineACerut('')).toBe('necunoscut')
  })

  it('ambele afișaje (monitor + panoul admin) poartă cerutDe', () => {
    const constructorRuta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
    expect((constructorRuta.match(/cerutDe: cineACerut\(j\.orderedBy\)/g) ?? []).length).toBe(2)
    const stage = readFileSync(fileURLToPath(new URL('../../frontend/src/pages/Stage.tsx', import.meta.url)), 'utf8')
    expect(stage).toMatch(/\{j\.cerutDe && \(\s*<span className="build-ci" title="cine a cerut ordinul">\s*\{j\.cerutDe\}\s*<\/span>\s*\)\}/)
  })
})
