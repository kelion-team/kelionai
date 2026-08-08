// ── THE MONEY RULES ARE OWNER SETTINGS, NOT CONSTANTS BURIED IN CODE ──────
//
// The top-up rules (£20 first top-up "brain activation", then any multiple
// of £5, auto top-up between £5 and £500 — Adrian, 24 Jul / Aug 1) lived as
// bare numbers inside routes/billing.ts: money values written in code,
// changeable only by deploy. They are OWNER DECISIONS — so they live in
// config.billing, documented and env-editable.
//
// Tested here: the validation OBEYS the config (change the setting, the rule
// changes — no code touched), and the defaults a new user gets for auto
// top-up come from the same place (not a `{ threshold: 20, topupAmount: 10 }`
// literal inside db.ts).
import { describe, it, expect, vi } from 'vitest'

// Mutable mock (the plataRevolut.test.ts pattern): each test sets the owner's
// settings it wants to prove the rule follows.
vi.mock('./config.js', () => ({
  config: {
    databaseUrl: '',
    geminiKey: '',
    billing: {
      currency: 'gbp',
      creditValue: 0.1,
      userShare: 0.75,
      firstTopupMin: 20,
      topupStep: 5,
      topupMin: 5,
      topupMax: 500,
      autoRechargeThreshold: 20,
      autoRechargeAmount: 10,
    },
  },
}))

const { config } = await import('./config.js')
const { validateAutoRecharge, validateTopUp } = await import('./routes/billing.js')
const { getAutoRecharge } = await import('./db.js')

const portofel = (topupRef: number) => async () => ({ citit: true as const, balance: 0, topupRef })
/** Portofel NECITIT — validarea nu are voie să treacă peste o citire picată. */
const portofelNecitit = async () => ({ citit: false as const, motiv: 'baza de date nu răspunde' })

describe('regula de alimentare urmează config.billing, nu constante din cod', () => {
  it('prima alimentare cere minimul ownerului (firstTopupMin)', async () => {
    expect(await validateTopUp(portofel(0), 'ion@test.ro', 15)).toBe('first_topup_min_20')
    expect(await validateTopUp(portofel(0), 'ion@test.ro', 20)).toBeNull()
  })

  it('portofel NECITIT: nu se validează nimic — nu i se cere „minim £20" unuia care alimentase deja', async () => {
    // `topupRef` picat pe 0 însemna „prima alimentare" pentru oricine, la orice
    // sughiț de bază de date. Măsurat 8 aug, pe familia „£0.00".
    expect(await validateTopUp(portofelNecitit, 'ion@test.ro', 20)).toBe('sold_necitit')
    expect(await validateTopUp(portofelNecitit, 'ion@test.ro', 5)).toBe('sold_necitit')
  })

  it('după prima alimentare: minimul și pasul ownerului (topupMin/topupStep)', async () => {
    expect(await validateTopUp(portofel(20), 'ion@test.ro', 3)).toBe('must_be_multiple_of_5')
    expect(await validateTopUp(portofel(20), 'ion@test.ro', 7)).toBe('must_be_multiple_of_5')
    expect(await validateTopUp(portofel(20), 'ion@test.ro', 5)).toBeNull()
  })

  it('schimbi setarea → se schimbă regula, FĂRĂ cod nou', async () => {
    config.billing.firstTopupMin = 30
    config.billing.topupStep = 10
    expect(await validateTopUp(portofel(0), 'ion@test.ro', 20)).toBe('first_topup_min_20')
    expect(await validateTopUp(portofel(0), 'ion@test.ro', 30)).toBeNull()
    expect(await validateTopUp(portofel(30), 'ion@test.ro', 5)).toBe('must_be_multiple_of_5')
    expect(await validateTopUp(portofel(30), 'ion@test.ro', 10)).toBeNull()
    config.billing.firstTopupMin = 20
    config.billing.topupStep = 5
  })

  it('validateAutoRecharge respectă topupMin/topupMax/topupStep din config', () => {
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 10 })).toEqual({
      enabled: true, threshold: 20, topupAmount: 10,
    })
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 7 })).toBeNull() // not a step multiple
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 2 })).toBeNull() // under min
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 5000 })).toBeNull() // over max
    config.billing.topupMax = 100
    expect(validateAutoRecharge({ enabled: true, threshold: 20, topupAmount: 500 })).toBeNull()
    config.billing.topupMax = 500
  })

  it('defaulturile de auto-alimentare ale unui user nou vin din config, nu dintr-un literal din db.ts', async () => {
    // databaseUrl is '' in this mock → the DB-disabled path returns the defaults.
    config.billing.autoRechargeThreshold = 33
    config.billing.autoRechargeAmount = 15
    expect(await getAutoRecharge('nou@test.ro')).toEqual({ enabled: false, threshold: 33, topupAmount: 15 })
    config.billing.autoRechargeThreshold = 20
    config.billing.autoRechargeAmount = 10
  })
})
