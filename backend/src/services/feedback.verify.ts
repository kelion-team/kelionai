// Test izolat pentru logica PURĂ de feedback (rulează: npx tsx src/services/feedback.verify.ts)
// Dovadă că re-chemarea creierului și mesajul de rezervă se construiesc corect,
// FĂRĂ să atingem puntea live. Adrian: „tot cu dovadă și testat".
import { buildBrainReport, fallbackLine, type AgentOutcome } from './feedback.js'

let passed = 0
let failed = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const ready: AgentOutcome = {
  kind: 'ready',
  summary: 'endpoint /api/sdk-ping',
  proof: 'backend build OK (tsc 0 erori), tester PASS',
  queued: 1,
}
const pass: AgentOutcome = { kind: 'pass', summary: 'skill Google Contacts scriere', detail: 'add_contact răspunde 200' }
const fail: AgentOutcome = { kind: 'fail', summary: 'filtru zgomot', detail: 'build a picat: type error' }

console.log('buildBrainReport — re-cheamă creierul cu faptele:')
const rReady = buildBrainReport(ready)
check('ready: conține ce s-a făcut', rReady.includes('endpoint /api/sdk-ping'))
check('ready: conține dovada de build', rReady.includes('tsc 0 erori'))
check('ready: cere „da" pentru publicare', /„da"/.test(rReady) && /public/i.test(rReady))
check('ready: GARDA „nu executa/dispeceriza"', /NU executa/i.test(rReady) && /dispeceriza/i.test(rReady))
check('ready: arată câte la rând când queued>1', buildBrainReport({ ...ready, queued: 3 }).includes('3 la rând'))
check('ready: fără proof → folosește un text implicit, nu gol', buildBrainReport({ ...ready, proof: '' }).includes('build curat'))

const rPass = buildBrainReport(pass)
check('pass: numește cerința', rPass.includes('skill Google Contacts scriere'))
check('pass: spune tester PASS', /tester PASS/i.test(rPass))
check('pass: are garda „nu executa"', /NU executa/i.test(rPass))

const rFail = buildBrainReport(fail)
check('fail: spune că a PICAT', /PICAT/i.test(rFail))
check('fail: dă motivul', rFail.includes('type error'))
check('fail: spune că se reia automat', /automat/i.test(rFail))

console.log('fallbackLine — plasa de rezervă (creier offline), fără regresie:')
const fReady = fallbackLine(ready)
check('fallback ready: „Am reparat"', fReady.startsWith('Am reparat:'))
check('fallback ready: cu dovadă când există', fReady.includes('Dovada:') && fReady.includes('tester PASS'))
check('fallback ready: fără dovadă → textul vechi cinstit', fallbackLine({ ...ready, proof: '' }).includes('fără dovadă de build atașată'))
check('fallback pass: „CERTIFICAT"', fallbackLine(pass).includes('CERTIFICAT'))
check('fallback fail: „a picat"', fallbackLine(fail).includes('a picat'))

console.log('siguranță — intrări murdare nu sparg:')
check('summary gol → nu crapă', typeof buildBrainReport({ kind: 'ready', summary: '' }) === 'string')
check('proof uriaș → tăiat', buildBrainReport({ kind: 'ready', summary: 'x', proof: 'a'.repeat(9999) }).length < 1500)

console.log(`\nREZULTAT: ${passed} trecute, ${failed} picate`)
if (failed > 0) process.exit(1)
