import { describe, expect, it, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    videoModel: 'sora-2',
    videoPriceUsdMicrosPerSecond: 100_000,
    videoShutdownAt: Date.parse('2099-01-01T00:00:00.000Z'),
    videoAllowPaid: false,
    openai: { key: '', apiBaseUrl: 'https://api.openai.com/v1' },
  },
}))

vi.mock('./db.js', () => ({
  loadGeneratedMedia: vi.fn(async () => null),
  loadKv: vi.fn(async () => null),
  saveGeneratedMedia: vi.fn(async () => undefined),
  saveKv: vi.fn(async () => undefined),
}))

import {
  costVideoUsd,
  motivRefuzVideo,
  secundeVideoValide,
  verdictVideoPlatit,
} from './services/video.js'

describe('OpenAI Videos — preț și durată', () => {
  it('folosește numai modelul și prețul versionate în configurație', () => {
    expect(costVideoUsd('sora-2', 8)).toBe(0.8)
    expect(costVideoUsd('unknown', 8)).toBeNull()
  })

  it('normalizează la duratele acceptate 4/8/12', () => {
    expect(secundeVideoValide(3)).toBe(4)
    expect(secundeVideoValide(6)).toBe(4)
    expect(secundeVideoValide(7)).toBe(8)
    expect(secundeVideoValide(10)).toBe(8)
    expect(secundeVideoValide(11)).toBe(12)
    expect(secundeVideoValide(120)).toBe(12)
    expect(secundeVideoValide(NaN)).toBe(8)
  })
})

describe('OpenAI Videos — gardă de plată', () => {
  it('refuză fără cheie', () => {
    expect(motivRefuzVideo({ cheie: '', allowPaid: true, model: 'sora-2' })).toBe('fara_cheie_openai')
  })

  it('refuză fără aprobare și comunică estimarea', () => {
    const reason = motivRefuzVideo({ cheie: 'k', allowPaid: false, model: 'sora-2' })
    expect(reason).toMatch(/video_platit_neaprobat/)
    expect(reason).toContain('$0.80')
  })

  it('refuză un model fără preț, nu inventează unul', () => {
    expect(motivRefuzVideo({ cheie: 'k', allowPaid: true, model: 'other' })).toMatch(/model_fara_pret_cunoscut/)
  })

  it('oprește cheltuiala după retragerea permanentă anunțată de furnizor', () => {
    expect(motivRefuzVideo({
      cheie: 'k', allowPaid: true, model: 'sora-2',
      nowMs: 2_000, shutdownAt: 1_000,
    })).toBe('video_openai_retras_de_furnizor')
  })

  it('kv bate env; implicitul rămâne oprit', () => {
    expect(verdictVideoPlatit('1', false)).toEqual({ pornit: true, sursa: 'buton' })
    expect(verdictVideoPlatit('0', true)).toEqual({ pornit: false, sursa: 'buton' })
    expect(verdictVideoPlatit(null, false)).toEqual({ pornit: false, sursa: 'implicit' })
  })
})
