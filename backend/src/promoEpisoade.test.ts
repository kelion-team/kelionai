import { describe, it, expect } from 'vitest'
import { adaugaEpisodInLista, rezumaEpisoade, type EpisodPromo } from './services/promoEpisoade.js'

// JURNALUL SERIEI DE CLIPURI (11 aug, ownerul: „el trebuie să-și știe ce a filmat
// în fiecare videoclip ep1, 2… ca să știe unde a rămas"). Logica de listă e PURĂ.
describe('promoEpisoade — jurnalul seriei de clipuri', () => {
  it('numerotează automat episodul următor (max + 1)', () => {
    const l0 = adaugaEpisodInLista([], { subiect: 'lansare', rezumat: 'intro', durata: 30, data: '2026-08-11' })
    expect(l0).toEqual([{ ep: 1, subiect: 'lansare', rezumat: 'intro', durata: 30, data: '2026-08-11' }])
    const l1 = adaugaEpisodInLista(l0, { subiect: 'trading', rezumat: 'demo', durata: 60, data: '2026-08-12' })
    expect(l1.map((e) => e.ep)).toEqual([1, 2])
  })

  it('păstrează ultimele 100, dar numărul episodului continuă să crească', () => {
    let l: EpisodPromo[] = []
    for (let i = 0; i < 130; i++) l = adaugaEpisodInLista(l, { subiect: 's' + i, rezumat: '', durata: 15, data: 'd' })
    expect(l.length).toBe(100)
    expect(l[l.length - 1].ep).toBe(130)
  })

  it('rezumatul spune unde a rămas + care e următorul', () => {
    expect(rezumaEpisoade([])).toContain('ep1')
    const r = rezumaEpisoade([{ ep: 3, subiect: 'X', rezumat: 'y', durata: 30, data: 'd' }])
    expect(r).toContain('ep3')
    expect(r).toContain('ep4')
  })

  it('ignoră intrările stricate, nu crapă', () => {
    expect(rezumaEpisoade(null as unknown as EpisodPromo[])).toContain('Niciun episod')
    expect(adaugaEpisodInLista([{} as EpisodPromo], { subiect: 'a', rezumat: '', durata: 1, data: 'd' })[0].ep).toBe(1)
  })
})
