// Script de verificare temporar pentru supervisor.ts — rulează:
//   npx tsx src/services/supervisor.verify.ts
// Acoperă toate cele 6 ramuri ale superviseDecision + cazurile limită
// ale escalationText. NU face parte din build (nu e importat nicăieri).

import { superviseDecision, escalationText, DEFAULT_SUPERVISE, SuperviseState } from './supervisor.js'

const cfg = DEFAULT_SUPERVISE // stallMs=240000 nudgeMs=240000 activeMs=90000 maxAttempts=1
const NOW = 1_000_000_000 // referință fixă

type Case = { name: string; r: SuperviseState; now: number; lastBuildBeat: number; expected: string }

const cases: Case[] = [
  {
    name: '1. nu a stagnat destul -> wait',
    r: { status: 'lucreaza', at: NOW - 1000, nudged: NOW - 10_000_000, attempts: 0 },
    now: NOW,
    lastBuildBeat: NOW - 10_000_000,
    expected: 'wait',
  },
  {
    name: '2. stagnat, dar a actionat recent (nudged) -> wait',
    r: { status: 'lucreaza', at: NOW - cfg.stallMs - 1000, nudged: NOW - 1000, attempts: 0 },
    now: NOW,
    lastBuildBeat: NOW - 10_000_000,
    expected: 'wait',
  },
  {
    name: "3. status incepe cu 'deploy pornit' -> deploy-check",
    r: { status: 'deploy pornit la ora X', at: NOW - cfg.stallMs - 1000, nudged: NOW - cfg.nudgeMs - 1000, attempts: 0 },
    now: NOW,
    lastBuildBeat: NOW - 10_000_000,
    expected: 'deploy-check',
  },
  {
    name: '4. constructorul a batut activitate recent -> active',
    r: { status: 'lucreaza', at: NOW - cfg.stallMs - 1000, nudged: NOW - cfg.nudgeMs - 1000, attempts: 0 },
    now: NOW,
    lastBuildBeat: NOW - 1000, // < activeMs
    expected: 'active',
  },
  {
    name: '5. impotmolit, mai are incercari -> reassign',
    r: { status: 'lucreaza', at: NOW - cfg.stallMs - 1000, nudged: NOW - cfg.nudgeMs - 1000, attempts: 0 },
    now: NOW,
    lastBuildBeat: NOW - cfg.activeMs - 1000,
    expected: 'reassign',
  },
  {
    name: '6. impotmolit, incercari epuizate -> giveup',
    r: { status: 'lucreaza', at: NOW - cfg.stallMs - 1000, nudged: NOW - cfg.nudgeMs - 1000, attempts: cfg.maxAttempts },
    now: NOW,
    lastBuildBeat: NOW - cfg.activeMs - 1000,
    expected: 'giveup',
  },
  // Priorități între ramuri (ordinea contează)
  {
    name: '7. deploy pornit ARE prioritate peste active (build beat recent)',
    r: { status: 'deploy pornit', at: NOW - cfg.stallMs - 1000, nudged: NOW - cfg.nudgeMs - 1000, attempts: 0 },
    now: NOW,
    lastBuildBeat: NOW - 1000,
    expected: 'deploy-check',
  },
  {
    name: '8. attempts == maxAttempts-1 -> tot reassign (limita inferioara)',
    r: { status: 'lucreaza', at: NOW - cfg.stallMs - 1000, nudged: NOW - cfg.nudgeMs - 1000, attempts: cfg.maxAttempts - 1 },
    now: NOW,
    lastBuildBeat: NOW - cfg.activeMs - 1000,
    expected: 'reassign',
  },
]

let pass = 0
let fail = 0

for (const c of cases) {
  const got = superviseDecision(c.r, c.now, c.lastBuildBeat, cfg)
  const ok = got === c.expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${c.name} | expected=${c.expected} got=${got}`)
}

// --- escalationText: cazuri limita ---
const maxAttempts = 3
const escCases: { attempt: number; expectContains: string }[] = [
  { attempt: 0, expectContains: 'Taie sarcina în bucăți mici' }, // clamp la 1
  { attempt: -5, expectContains: 'Taie sarcina în bucăți mici' }, // negativ -> clamp la 1
  { attempt: 1, expectContains: 'Taie sarcina în bucăți mici' },
  { attempt: 2, expectContains: 'Agentul anterior NU a dus-o la capăt' },
  { attempt: 3, expectContains: 'ULTIMA încercare automată' },
  { attempt: 4, expectContains: 'ULTIMA încercare automată' }, // peste maxAttempts -> clamp la ultimul pas
  { attempt: 100, expectContains: 'ULTIMA încercare automată' },
]

for (const c of escCases) {
  const text = escalationText(c.attempt, maxAttempts)
  const definedOk = typeof text === 'string' && text.length > 0
  const containsOk = text.includes(c.expectContains)
  const ok = definedOk && containsOk
  if (ok) pass++
  else fail++
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | escalationText(attempt=${c.attempt}, max=${maxAttempts}) | defined=${definedOk} contains("${c.expectContains}")=${containsOk} | got="${text}"`,
  )
}

console.log(`\nRezumat: ${pass} PASS, ${fail} FAIL din ${pass + fail} cazuri`)
if (fail > 0) process.exit(1)
