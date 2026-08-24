import test from 'node:test'
import assert from 'node:assert/strict'
import { analizeazaModul, calculeazaCodMort } from './verifica-exporturi.mjs'

test('extrage importuri, exporturi și încărcări dinamice fără comentarii', () => {
  const rezultat = analizeazaModul(`
    // export function fals() {}
    import principal, { Tip as Alias } from './dep.js'
    export const folosit = 1, nefolosit = 2
    export default function Exemplu() {}
    void import('./dinamic')
    new Worker(new URL('./worker.ts', import.meta.url))
  `, 'src/index.ts')
  assert.deepEqual(rezultat.exporturi.map((x) => x.nume), ['folosit', 'nefolosit', 'default'])
  assert.deepEqual(rezultat.dependente.map((x) => [x.specificator, x.nume]), [
    ['./dep.js', ['default', 'Tip']],
    ['./dinamic', ['*']],
    ['./worker.ts', ['*']],
  ])
})

test('graful nu lasă testele sau simpla existență să salveze producția moartă', () => {
  const rezultat = calculeazaCodMort([
    { fisier: 'app.ts', exporturi: [], dependenteRezolvate: [{ fisier: 'viu.ts', nume: ['folosit'] }] },
    { fisier: 'viu.ts', exporturi: [{ nume: 'folosit', linie: 1 }, { nume: 'mort', linie: 2 }], dependenteRezolvate: [] },
    { fisier: 'orfan.ts', exporturi: [{ nume: 'x', linie: 1 }], dependenteRezolvate: [] },
  ], ['app.ts'])
  assert.deepEqual(rezultat.fisiereInaccesibile, ['orfan.ts'])
  assert.deepEqual(rezultat.exporturiNefolosite, [{ fisier: 'viu.ts', nume: 'mort', linie: 2 }])
})
