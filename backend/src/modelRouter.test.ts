import { describe, it, expect } from 'vitest'
import {
  taskDifficulty,
  requiredCapability,
  chooseModel,
  CAPABILITY_MARGIN,
  MODEL_FAST,
} from './services/modelRouter.js'

// CREIERUL — Kimi (primar) → GLM (rezervă). Third-party provider scos complet (Adrian, 12
// iul). Design NOU: Kimi acoperă ORICE cerere (nu mai există escaladare pe
// dificultate spre un al doilea provider); GLM e DOAR rezerva la eșecul lui Kimi
// (failover-ul din routes/chat.ts, brainModel()), nu o alegere a routerului.
describe('router creier — Kimi primar pentru orice cerere', () => {
  it('chatul simplu/scurt → Kimi (primar)', () => {
    expect(chooseModel('salut, ce faci?')).toBe(MODEL_FAST)
    expect(chooseModel('mulțumesc!')).toBe(MODEL_FAST)
    expect(chooseModel('cât e ceasul la Paris?')).toBe(MODEL_FAST)
  })

  it('cererile grele (raționament) → tot Kimi (primar, nu escaladează la alt provider)', () => {
    expect(chooseModel('analizează în detaliu argumentele pro și contra')).toBe(MODEL_FAST)
    expect(chooseModel('demonstrează pas cu pas de ce funcționează')).toBe(MODEL_FAST)
  })

  it('cererile de cod/depanare → tot Kimi (primar)', () => {
    expect(chooseModel('scrie un algoritm și fă debug la funcția asta')).toBe(MODEL_FAST)
    expect(chooseModel('optimizează programul, are un bug')).toBe(MODEL_FAST)
  })

  it('textul foarte lung → tot Kimi (primar)', () => {
    expect(chooseModel('x '.repeat(600))).toBe(MODEL_FAST)
  })

  it('taskDifficulty încă măsoară complexitatea (semnal pentru alte decizii)', () => {
    expect(taskDifficulty('bună')).toBeLessThan(taskDifficulty('analizează pas cu pas'))
    expect(taskDifficulty('salut')).toBeLessThanOrEqual(75)
    expect(taskDifficulty('scrie cod și fă debug la algoritm')).toBeGreaterThan(75)
  })

  it('aplică marja de +10% peste dificultate (păstrată pentru viitor)', () => {
    expect(CAPABILITY_MARGIN).toBe(1.1)
    expect(requiredCapability('salut')).toBeCloseTo(taskDifficulty('salut') * 1.1)
    expect(requiredCapability('scrie cod și fă debug la algoritm')).toBeLessThanOrEqual(100)
    // orice cerere rămâne pe Kimi (primar)
    expect(chooseModel('salut, ce faci?')).toBe(MODEL_FAST)
  })
})
