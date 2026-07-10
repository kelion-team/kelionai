import { describe, it, expect } from 'vitest'
import {
  taskDifficulty,
  requiredCapability,
  chooseModel,
  CAPABILITY_MARGIN,
  MODEL_FAST,
  MODEL_TOP,
} from './services/modelRouter.js'

describe('router automat capabilitate↔cost', () => {
  it('chatul simplu/scurt → modelul RAPID (ieftin)', () => {
    expect(chooseModel('salut, ce faci?')).toBe(MODEL_FAST)
    expect(chooseModel('mulțumesc!')).toBe(MODEL_FAST)
    expect(chooseModel('cât e ceasul la Paris?')).toBe(MODEL_FAST)
  })

  it('cererile grele (raționament) → modelul PUTERNIC', () => {
    expect(chooseModel('analizează în detaliu argumentele pro și contra')).toBe(MODEL_TOP)
    expect(chooseModel('demonstrează pas cu pas de ce funcționează')).toBe(MODEL_TOP)
  })

  it('cererile de cod/depanare → modelul PUTERNIC', () => {
    expect(chooseModel('scrie un algoritm și fă debug la funcția asta')).toBe(MODEL_TOP)
    expect(chooseModel('optimizează programul, are un bug')).toBe(MODEL_TOP)
  })

  it('textul foarte lung → modelul PUTERNIC (complexitate)', () => {
    expect(chooseModel('x '.repeat(600))).toBe(MODEL_TOP)
  })

  it('dificultatea crește cu semnalele de complexitate', () => {
    expect(taskDifficulty('bună')).toBeLessThan(taskDifficulty('analizează pas cu pas'))
    expect(taskDifficulty('salut')).toBeLessThanOrEqual(75) // acoperit de modelul rapid
    expect(taskDifficulty('scrie cod și fă debug la algoritm')).toBeGreaterThan(75) // cere modelul top
  })

  it('aplică marja de +10% peste dificultate (ca să fie sigur rezolvat)', () => {
    expect(CAPABILITY_MARGIN).toBe(1.1)
    expect(requiredCapability('salut')).toBeCloseTo(taskDifficulty('salut') * 1.1)
    // necesarul cu marjă nu depășește 100
    expect(requiredCapability('scrie cod și fă debug la algoritm')).toBeLessThanOrEqual(100)
    // chatul simplu, chiar cu marjă, rămâne pe modelul rapid
    expect(chooseModel('salut, ce faci?')).toBe(MODEL_FAST)
  })
})
