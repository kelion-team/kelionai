import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executionTimeoutMsForOrder,
  gateTimeoutMs,
  parseRequestedAuditMinutes,
  smokeTimeoutMs,
} from './codex-worker.mjs'

test('durata explicită de audit devine timeout efectiv cu marjă de handoff', () => {
  assert.equal(parseRequestedAuditMinutes('audit pentru 90 de minute'), 90)
  assert.equal(parseRequestedAuditMinutes('auditează timp de 2 ore'), 120)
  assert.equal(parseRequestedAuditMinutes('30 min audit Constructor'), 30)
  assert.equal(parseRequestedAuditMinutes('ordin generic fără durată'), null)
  assert.equal(executionTimeoutMsForOrder('audit pentru 90 de minute', {}), 95 * 60_000)
  assert.equal(executionTimeoutMsForOrder('ordin generic', {}), 4 * 60 * 60_000)
})

test('timeout-urile configurabile refuză valori nesigure și plafonează auditul', () => {
  assert.equal(executionTimeoutMsForOrder('audit 500 minute', {}), 4 * 60 * 60_000)
  assert.equal(executionTimeoutMsForOrder('ordin generic', { CODEX_WORKER_EXEC_TIMEOUT_SECONDS: '3600' }), 60 * 60_000)
  assert.equal(gateTimeoutMs({ CODEX_WORKER_GATE_TIMEOUT_SECONDS: '3600' }), 60 * 60_000)
  assert.equal(smokeTimeoutMs({ CODEX_WORKER_SMOKE_TIMEOUT_SECONDS: '1800' }), 30 * 60_000)
  assert.throws(
    () => executionTimeoutMsForOrder('ordin generic', { CODEX_WORKER_EXEC_TIMEOUT_SECONDS: '60' }),
    /între 300 și 14400 secunde/,
  )
})
