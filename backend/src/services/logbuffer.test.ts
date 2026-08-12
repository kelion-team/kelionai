// ── TEUL DE LOG → SIMPTOM: orice eroare de server ajunge la self-heal ────────
//
// Adrian, 12 aug: „sensul absolut orice err, să o vadă din toate logurile".
// Testul dovedește că o linie de nivel EROARE care trece prin logger devine
// simptom (prin sink), că zgomotul de acces (info 2xx) NU, și că rate-limit-ul
// oprește o eroare în buclă să bombardeze baza.
import { describe, it, expect, beforeEach } from 'vitest'
import { makeLogTee, setLogSymptomSink } from './logbuffer.js'

function scrie(tee: NodeJS.WritableStream, obj: Record<string, unknown>): void {
  tee.write(Buffer.from(JSON.stringify(obj) + '\n'))
}

describe('makeLogTee → simptom pe orice eroare', () => {
  let got: string[]
  beforeEach(() => {
    got = []
    setLogSymptomSink((m) => got.push(m))
  })

  it('o linie de nivel eroare (50) devine simptom; zgomotul de acces (info 2xx) NU', () => {
    const tee = makeLogTee()
    scrie(tee, { time: Date.now(), level: 50, msg: 'ruta 5xx unică-A', err: { message: 'boom-A' } })
    scrie(tee, { time: Date.now(), level: 30, msg: 'request completed', res: { statusCode: 200 } })
    expect(got).toHaveLength(1)
    expect(got[0]).toContain('boom-A')
  })

  it('rate-limit: aceeași eroare la rând nu se raportează de două ori imediat', () => {
    const tee = makeLogTee()
    scrie(tee, { time: Date.now(), level: 50, msg: 'eroare-repetată-B' })
    scrie(tee, { time: Date.now(), level: 50, msg: 'eroare-repetată-B' })
    expect(got).toHaveLength(1)
  })

  it('nu se raportează pe sine (anti-buclă): linii despre client_errors/simptom', () => {
    const tee = makeLogTee()
    scrie(tee, { time: Date.now(), level: 50, msg: 'insert into client_errors a picat-C' })
    expect(got).toHaveLength(0)
  })
})
