import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── „DESCHID GMAIL…" NU MAI TRECE CA RĂSPUNS TERMINAT ──────────────────────
//
// Adrian, 3 aug: „el zice că preia sarcina audio sau în scris dar nu o dă
// creierului spre rezolvare — vreau dovezi că se întâmplă asta".
//
// Dovada (din cod): pe un creier gratuit slab, modelul POVESTEA acțiunea în
// prezent, la început de frază („Deschid Gmail.") fără să cheme nicio unealtă.
// Vechiul DEED_CLAIM_RE prindea doar faptele la trecut („am deschis") și câteva
// forme de prezent („îți deschid", „o să deschid", „deschid acum") — așa că un
// „Deschid Gmail" de la început de frază scăpa de AMÂNDOUĂ porțile și era
// acceptat ca tură terminată. Aici măsurăm regex-ul RECONSTRUIT din sursă pe
// exact propozițiile buguite — și pe cele care NU trebuie atinse (bonul „Am
// preluat sarcina", un răspuns real, un salut).
const orch = readFileSync(
  fileURLToPath(new URL('./services/orchestrator.ts', import.meta.url)),
  'utf8',
)

// Reconstruim litera regex din sursă și o testăm PE BUNE (nu doar că există).
const lit = /const DEED_CLAIM_RE\s*=\s*\n?\s*(\/[\s\S]*?\/[a-z]+)\s*\n/.exec(orch)?.[1] ?? ''
const taie = lit.lastIndexOf('/')
const re = new RegExp(lit.slice(1, taie), lit.slice(taie + 1))

describe('poarta faptei prinde și narațiunea de acțiune la prezent (gaura „Deschid Gmail")', () => {
  const prinse = [
    'Deschid Gmail.',
    'Deschid Gmail și caut ultimul mesaj de la client.',
    'Caut ultimul email de la client.',
    'Trimit mesajul acum.',
    'Pornesc căutarea în inbox.',
    'Salvez fișierul în drive.',
    'Repar bugul și revin.',
    "I'm opening Gmail now.",
    // formele vechi trebuie să rămână prinse (nu le-am stricat)
    'Am deschis Gmail și am trimis mesajul.',
    'O să caut în inbox.',
  ]
  for (const f of prinse) {
    it(`prinde: „${f}"`, () => expect(re.test(f)).toBe(true))
  }
})

describe('poarta faptei NU se aruncă pe bon, pe un răspuns real sau pe un salut', () => {
  const libere = [
    // BONUL de preluare — NU e o faptă falsă, e chitanța dinaintea creierului.
    'Am preluat sarcina.',
    'Am preluat sarcina. ',
    // un răspuns care chiar livrează / o constatare la trecut
    'Rezultatul e 804.',
    'Am analizat deja — cauza e la linia 218.',
    // un refuz sincer
    'Nu pot face asta: nu am acces la facturare.',
    // un salut (fixul de la pornire) — nu trebuie să declanșeze poarta
    'Bună ziua, Adrian.',
    'Bună dimineața!',
  ]
  for (const f of libere) {
    it(`NU prinde: „${f}"`, () => expect(re.test(f)).toBe(false))
  }
})

describe('poarta faptei rămâne activă în orchestrator și nu a înlocuit poarta analizei', () => {
  it('regex-ul e pe flag-uri i+m (ancora prinde și liniile următoare)', () => {
    expect(lit).toMatch(/\/[a-z]*m[a-z]*$/) // conține flag-ul m
  })
  it('poarta faptei și poarta analizei coexistă', () => {
    expect(orch).toMatch(/DEED_CLAIM_RE\.test/)
    expect(orch).toMatch(/ANALIZA_CLAIM_RE\.test/)
    expect(orch).toMatch(/POARTA FAPTEI/)
  })
})
