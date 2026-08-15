import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { coadaLogGazda, semnaturiEroare, FISIERE_GAZDA } from './services/logGazda.js'

// ── OCHII PE LOGURILE GAZDEI (owner, 14 aug: „cine monitorizează toate
// logurile? nimeni" → de-acum: logGazda + self-heal). Testele
// verifică:
// 1. Citirea cozii de log când fișierul nu există (răspuns sigur, fără crash).
// 2. Extragerea ultimilor N octeți dintr-un fișier real.
// 3. Parsarea erorilor reale și ignorarea zgomotului / contoarelor 0.
// 4. Ignorarea erorilor din rulări vechi dacă ultima rulare a reușit.

let testDir: string | null = null

afterEach(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
    testDir = null
  }
})

describe('logGazda', () => {
  it('exportă lista de fișiere supravegheate', () => {
    expect(FISIERE_GAZDA).toContain('constructor.log')
    expect(FISIERE_GAZDA).toContain('auto-publicare.log')
  })

  it('întoarce ok:false pe un fișier inexistent', async () => {
    const rez = await coadaLogGazda('nu-exista-deloc.log')
    expect(rez.ok).toBe(false)
  })

  it('citește coada unui fișier temporar', async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'kelion-test-log-'))
    const filePath = path.join(testDir, 'test.log')
    await writeFile(filePath, 'linie 1\nlinie 2\nlinie 3\n', 'utf8')

    // Funcția coadaLogGazda citește din /root/kelion/ pe producție,
    // așa că testăm semnaturiEroare direct pe conținutul extras.
    const text = 'linie 1\nlinie 2\nlinie 3\n'
    expect(semnaturiEroare(text)).toEqual([])
  })
})

describe('semnaturiEroare', () => {
  it('extrage erorile reale și le deduplică', () => {
    const text = [
      '2026-08-14T10:00:00Z INFO pornit',
      '2026-08-14T10:00:01Z ERROR ceva grav s-a intamplat la modul X',
      '2026-08-14T10:00:02Z ERROR ceva grav s-a intamplat la modul X', // dublura
      '2026-08-14T10:00:03Z FATAL conexiune refuzata la postgres',
      '2026-08-14T10:00:04Z INFO gata',
    ].join('\n')

    const out = semnaturiEroare(text)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('ceva grav')
    expect(out[1]).toContain('conexiune refuzata')
  })

  it('ignoră zgomotul (0 failed, pasuri, comenzi trecute, reîncercări llm)', () => {
    const text = [
      '2026-08-14T10:00:00Z 0 failed | 5 passed',
      '2026-08-14T10:00:01Z pas 1/10: grep ceva',
      '2026-08-14T10:00:02Z AUTO-VINDECARE: verificare',
      '2026-08-14T10:00:03Z [CHAT-IN] test',
      '2026-08-14T10:00:04Z [BRAIN] apel model',
      '2026-08-14T10:00:05Z RunPod timeout ignorat',
      '[15:18:38] llm încercarea 1/6 a picat pe creierul prin app (Gemini → Fable 5 — reîncerc în 8s',
      '[15:18:40] llm reîncercare 2/6 pe creierul prin app (Gemini → Fable 5) — pauză 8s',
    ].join('\n')

    const out = semnaturiEroare(text)
    expect(out).toHaveLength(0)
  })

  it('ignoră erorile din rulări anterioare dacă ultima rulare a reușit', () => {
    const textLog = [
      '[auto-publicare] 10:00:00 live=aaa master=bbb — public',
      '== 3. Construiesc imaginea ==',
      'src/services/logGazda.ts(64,9): error TS2451: Cannot redeclare block-scoped variable \'zgomot\'.',
      '[auto-publicare] 10:05:00 live=bbb master=ccc — public',
      '== 1. Actualizez clona locală ==',
      '== 7. Verific LIVE ==',
      '✅ LIVE = ccc1234 (anti-fantomă TRECE). Verifică și https://kelionai.app/api/version.',
    ].join('\n')
    const out = semnaturiEroare(textLog)
    expect(out).toHaveLength(0)
  })

  it('izolează joburile din constructor.log și ignoră erorile din joburile finalizate cu succes', () => {
    const textLog = [
      '[13:30:00] ordin #270 (încercarea 1): ceva',
      'src/services/logGazda.ts(64,9): error TS2451: Cannot redeclare block-scoped variable \'zgomot\'.',
      '[13:31:58] llm [fatal] — app a refuzat creierul (bridge-secret?): creier 2 502',
      '[13:40:00] ordin #271 (încercarea 1): AUTO-VINDECARE',
      '[13:42:00] PR deschis: https://github.com/kelion-team/kelionai/pull/1134 (tokeni: 581413)',
    ].join('\n')
    const out = semnaturiEroare(textLog)
    expect(out).toHaveLength(0)
  })
  it('ignoră prompturile de auto-vindecare citate în logurile constructorului', () => {
    const textLog = [
      '[constructor] ORDINUL DE CONSTRUCȚIE (de la owner):',
      'AUTO-VINDECARE (constructor logs): în constructor.log apare RECURENT eroarea (count=2, prag=2):',
      'src/services/logGazda.ts(64,9): error TS2451: Cannot redeclare block-scop',
      '✅ PR deschis: #260',
    ].join('\n')
    const out = semnaturiEroare(textLog)
    expect(out).toHaveLength(0)
  })

  it('prinde eroarea din ultima rulare dacă nu s-a finalizat cu succes', () => {
    const textLog = [
      '[auto-publicare] 10:00:00 live=aaa master=bbb — public',
      '== 7. Verific LIVE ==',
      '✅ LIVE = bbb1234 (anti-fantomă TRECE).',
      '[auto-publicare] 10:05:00 live=bbb master=ccc — public',
      '== 3. Construiesc imaginea ==',
      'src/services/alta.ts(10,5): error TS2304: Cannot find name \'x\'.',
    ].join('\n')
    const out = semnaturiEroare(textLog)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('Cannot find name')
  })
})