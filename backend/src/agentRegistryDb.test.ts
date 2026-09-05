import { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,beforeEach,expect,it,vi } from 'vitest'

let db: PGlite
let unavailable = false
vi.mock('./dbPool.js',() => ({
  getPool:() => ({ query:(sql:string,params?:unknown[]) => unavailable
    ? Promise.reject(new Error('private database diagnostic')) : db.query(sql,params) }),
  conexiuneDb:vi.fn(),starePool:vi.fn(),inchidePool:vi.fn(),
}))
vi.mock('./config.js',async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js')
  return { ...actual,config:{ ...actual.config,databaseUrl:'postgres://fixture.invalid/registry' } }
})
const { listaAgentiCustom,adaugaAgentCustom } = await import('./db.js')
const { config } = await import('./config.js')

beforeAll(async () => {
  db = new PGlite()
  await db.exec('CREATE TABLE agenti_custom(id text PRIMARY KEY,nume text NOT NULL,rol text NOT NULL,efort text,doar_admin boolean NOT NULL DEFAULT false,creat timestamptz DEFAULT now())')
},30_000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  unavailable = false
  config.databaseUrl = 'postgres://fixture.invalid/registry'
  await db.exec('TRUNCATE agenti_custom')
})

it('persists explicit low/high and unspecified effort distinctly and reads the actual private flag',async () => {
  for (const [id,efort] of [['standard','low'],['deep','high'],['implicit',undefined]] as const) {
    expect(await adaugaAgentCustom({ id,nume:`Agent ${id}`,rol:'Rol de verificare',efort,doarAdmin:id === 'standard' })).toBeNull()
  }
  const actual = await listaAgentiCustom(true)
  expect(actual).toHaveLength(3)
  expect(actual.find((agent) => agent.id === 'standard')).toMatchObject({ efort:'low',doarAdmin:true })
  expect(actual.find((agent) => agent.id === 'deep')).toMatchObject({ efort:'high' })
  expect(actual.find((agent) => agent.id === 'implicit')?.efort).toBeUndefined()
  expect((await db.query('SELECT efort FROM agenti_custom WHERE id=$1',['standard'])).rows).toEqual([{ efort:'low' }])
})

it('distinguishes a genuinely empty custom registry from missing configuration or database failure',async () => {
  expect(await listaAgentiCustom(true)).toEqual([])
  unavailable = true
  await expect(listaAgentiCustom(true)).rejects.toThrow('agent_registry_unavailable')
  expect(await listaAgentiCustom()).toEqual([])
  config.databaseUrl = ''
  await expect(listaAgentiCustom(true)).rejects.toThrow('agent_registry_unavailable')
})
