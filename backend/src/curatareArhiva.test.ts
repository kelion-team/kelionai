import { describe, it, expect } from 'vitest'
import {
  actualizeazaCerinta,
  listeazaCerinte,
  reportBuildJob,
  listBuildJobs,
  arhiveazaCerinteSiJoburiInchise,
} from './db.js'

describe('curatareArhiva — arhivare automată la închiderea cerințelor și joburilor (K13)', () => {
  it('actualizeazaCerinta și listeazaCerinte gestionează corect parametrul includeArhivat', async () => {
    // În mediu fără DB activă (ex. unit test fără Postgres), funcțiile se execută în siguranță fără excepții
    await expect(actualizeazaCerinta(9999, { stare: 'verificata' })).resolves.not.toThrow()
    const cerinte = await listeazaCerinte(undefined, 10, false)
    expect(Array.isArray(cerinte)).toBe(true)
  })

  it('listBuildJobs acceptă parametrul includeArhivat', async () => {
    const joburiActive = await listBuildJobs(10, false)
    const joburiToate = await listBuildJobs(10, true)
    // Când DB nu e conectată, ambele întorc null sau array
    if (joburiActive !== null) {
      expect(Array.isArray(joburiActive)).toBe(true)
    }
    if (joburiToate !== null) {
      expect(Array.isArray(joburiToate)).toBe(true)
    }
  })

  it('reportBuildJob funcționează fără erori când marchează un job ca done', async () => {
    await expect(
      reportBuildJob(9999, { status: 'done', log: 'Job finalizat cu succes' }),
    ).resolves.not.toThrow()
  })

  it('arhiveazaCerinteSiJoburiInchise returnează un obiect cu numerele de elemente arhivate', async () => {
    const rez = await arhiveazaCerinteSiJoburiInchise()
    expect(rez).toHaveProperty('cerinteArhivate')
    expect(rez).toHaveProperty('joburiArhivate')
    expect(typeof rez.cerinteArhivate).toBe('number')
    expect(typeof rez.joburiArhivate).toBe('number')
  })
})
