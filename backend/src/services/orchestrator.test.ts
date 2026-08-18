import { describe, expect, it } from 'vitest'
import { executaApeluriCoordonate } from './orchestrator.js'

describe('executaApeluriCoordonate', () => {
  it('păstrează ordinea efectelor din același grup', async () => {
    const ordine: string[] = []
    const rezultat = await executaApeluriCoordonate(
      ['scriere-1', 'scriere-2'],
      () => 'efect',
      async (apel) => {
        ordine.push(`start:${apel}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        ordine.push(`end:${apel}`)
        return apel
      },
    )
    expect(rezultat).toEqual(['scriere-1', 'scriere-2'])
    expect(ordine).toEqual(['start:scriere-1', 'end:scriere-1', 'start:scriere-2', 'end:scriere-2'])
  })

  it('nu introduce latență artificială între citirile independente', async () => {
    let active = 0
    let maxim = 0
    await executaApeluriCoordonate(
      ['citire-1', 'citire-2'],
      () => undefined,
      async () => {
        active += 1
        maxim = Math.max(maxim, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return 'ok'
      },
    )
    expect(maxim).toBe(2)
  })
})
