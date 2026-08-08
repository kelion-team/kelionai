import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ritmMasurat, fereastraInchisa, msPanaLaResetulCotei, ziuaPacific } from './services/enterpriseCreate.js'

// Probele rulează pe JURNALUL REAL din 8 aug 2026 (citit de Kelion din
// stare.jurnal, adus de owner): resetul cotei la miezul nopții Pacific a lăsat
// exact 2 agenți (00:09/00:10 ora Pacificului), apoi 429 — iar cele 8 rafale de
// 429 care au urmat s-au dovedit a fi REPORNIRILE de la deploy-urile mele
// (fiecare la ~7-9 min după un merge pe master), nu „cota misterioasă".
// Ownerul a avut dreptate: „nu e de la limitare, cauta greseli in soft".
const JURNAL_8_AUG = [
  '2026-08-08T07:09:28Z REUȘIT: Agent Memorie Date',
  '2026-08-08T07:10:29Z REUȘIT: Agent Browser',
  '2026-08-08T07:11:30Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T07:28:00Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T07:42:00Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T07:58:00Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T08:51:00Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T09:11:00Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T09:28:00Z 429 la Agent Documente: Agent creation quota exceeded',
  '2026-08-08T09:43:00Z 429 la Agent Documente: Agent creation quota exceeded',
]

describe('ritmMasurat — socoteala iese din jurnal, nu din documentație', () => {
  it('măsoară 2/zi pe jurnalul real din 8 aug (docs ziceau 1/zi — au mințit)', () => {
    expect(ritmMasurat(JURNAL_8_AUG)).toEqual({ peZi: 2, zi: '2026-08-08' })
  })

  it('fără nicio reușită întoarce undefined — „nu pot măsura", nu o cifră din docs', () => {
    expect(ritmMasurat([])).toBeUndefined()
    expect(ritmMasurat(JURNAL_8_AUG.slice(2))).toBeUndefined()
  })

  it('ia ULTIMA zi cu reușite, nu una veche', () => {
    const jurnal = ['2026-08-05T07:20:00Z REUȘIT: Agent Vechi', ...JURNAL_8_AUG]
    expect(ritmMasurat(jurnal)).toEqual({ peZi: 2, zi: '2026-08-08' })
  })
})

describe('fereastraInchisa — boot-ul nu mai bate în zidul măsurat', () => {
  it('după 429-ul zilei, fereastra e închisă (fix momentul rafalelor din 8 aug)', () => {
    expect(fereastraInchisa(JURNAL_8_AUG, new Date('2026-08-08T09:50:00Z'))).toBe(true)
  })

  it('după resetul de la miezul nopții Pacific, ziua e alta → fereastra se încearcă', () => {
    expect(fereastraInchisa(JURNAL_8_AUG, new Date('2026-08-09T07:15:00Z'))).toBe(false)
  })

  it('ultima veste = REUȘIT (restartul a tăiat drenarea) → reluăm imediat', () => {
    expect(fereastraInchisa(JURNAL_8_AUG.slice(0, 2), new Date('2026-08-08T07:20:00Z'))).toBe(false)
  })

  it('jurnal gol = nu știm nimic măsurat → încercăm (nu inventăm o închidere)', () => {
    expect(fereastraInchisa([], new Date('2026-08-08T09:50:00Z'))).toBe(false)
  })
})

describe('msPanaLaResetulCotei — resetul REAL (miezul nopții Pacific), nu o oră UTC bătută în cuie', () => {
  it('la 09:43 UTC vara (02:43 Pacific) mai sunt 21h17m până la reset', () => {
    expect(msPanaLaResetulCotei(new Date('2026-08-08T09:43:00Z'))).toBe(76_620_000)
  })

  it('iarna (PST) resetul cade la 08:00 UTC — 08:30 UTC înseamnă 23h30m rămase', () => {
    expect(msPanaLaResetulCotei(new Date('2026-01-15T08:30:00Z'))).toBe(84_600_000)
  })

  it('granița măsurată: 06:59 UTC e încă ziua Pacific de ieri, 07:01 e ziua nouă', () => {
    expect(ziuaPacific(new Date('2026-08-08T06:59:00Z'))).toBe('2026-08-07')
    expect(ziuaPacific(new Date('2026-08-08T07:01:00Z'))).toBe('2026-08-08')
  })
})

describe('gardul pe sursă — reparațiile măsurate nu se pierd la un refactor', () => {
  const aici = dirname(fileURLToPath(import.meta.url))
  const sursa = readFileSync(join(aici, 'services/enterpriseCreate.ts'), 'utf8')

  it('boot-ul consultă jurnalul înainte să tragă o rundă (bugul celor 8 rafale)', () => {
    expect(sursa).toContain('fereastraInchisa(jurnalCote')
  })

  it('după 429 veghea doarme până la reset, nu reîncearcă orbește la 60 min', () => {
    expect(sursa).toContain('r.oprit ? msPanaLaResetulCotei')
  })
})
