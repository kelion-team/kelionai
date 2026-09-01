import { describe, expect, it } from 'vitest'
import {
  RETETE_STUDIO,
  motivRefuzPromo,
  numeClip,
  planStudio,
  promptVideoDinIdee,
  setariPromoDinKv,
} from './services/studioClipuri.js'

describe('studioul de clipuri OpenAI-only', () => {
  it('creează un nume stabil și sigur pentru fișier', () => {
    expect(numeClip('Spot publicitar', 'Kelionai, asistentul tău', new Date(2026, 7, 15, 9, 5)))
      .toBe('Spot-publicitar-Kelionai-asistentul-tau-2026-08-15_09-05')
    expect(numeClip('Clip', '###', new Date(2026, 0, 1, 0, 0)))
      .toBe('Clip-Clip-2026-01-01_00-00')
  })

  it('refuză ideea goală și produce numai planul OpenAI configurat', () => {
    expect(planStudio('', undefined, new Date())).toMatchObject({ error: expect.stringContaining('fara_idee') })
    const plan = planStudio('spot pentru brutărie', 'Spot publicitar', new Date(2026, 7, 15, 12, 0))
    if ('error' in plan) throw new Error('plan neașteptat refuzat')
    expect(plan.cale).toBe('openai')
    expect(plan.videoPrompt).toContain('spot pentru brutărie')
    expect(plan.pasi[0]).toContain('lista_tarife')
    expect(plan.pasi[1]).toContain('confirmarea EXPLICITĂ')
    expect(plan.numeFisier).toMatch(/\.mp4$/)
    expect(JSON.stringify(plan)).not.toMatch(/promptFlow|promptVeo/)
  })

  it('păstrează cele șase rețete și stilul ales', () => {
    expect(RETETE_STUDIO).toHaveLength(6)
    expect(promptVideoDinIdee('idee simplă', 'Tutorial')).toContain('clean screen-style presentation')
  })
})

describe('programarea promo este fail-closed', () => {
  const settings = { pornit: true, ore: [9, 18], plafonUsdZi: 2, idee: 'Kelion' }
  const ready = {
    setari: settings,
    oraAcum: 9,
    dejaRulatOraAsta: false,
    videoPornit: true,
    cheltuitAziUsd: 0,
    costClipUsd: 0.8,
  }

  it('config absent sau invalid rămâne oprit', () => {
    expect(setariPromoDinKv(null).pornit).toBe(false)
    expect(setariPromoDinKv('{invalid').pornit).toBe(false)
  })

  it('rulează numai când toate porțile sunt satisfăcute', () => {
    expect(motivRefuzPromo(ready)).toBeNull()
    expect(motivRefuzPromo({ ...ready, videoPornit: false })).toMatch(/generarea_video_oprita/)
    expect(motivRefuzPromo({ ...ready, costClipUsd: null })).toMatch(/model_fara_pret_cunoscut/)
    expect(motivRefuzPromo({ ...ready, cheltuitAziUsd: 1.5 })).toMatch(/plafon_atins/)
  })
})
