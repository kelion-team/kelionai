import { describe, it, expect } from 'vitest'
import { explicaEroare, rangSeveritate } from './explicaEroare.js'

describe('explicaEroare — Kelion își cunoaște defectele', () => {
  it('recunoaște căderea vocală cod 1006 ca problemă de Voce, nu răspuns generic', () => {
    const e = explicaEroare('sesiunea vocală s-a închis singură (cod 1006)')
    expect(e.categorie).toBe('Voce')
    expect(e.severitate).toBe('important')
    // Explicația trebuie să spună CE ESTE, nu „încearcă din nou".
    expect(e.ceEste.toLowerCase()).toContain('1006')
    expect(e.ceEste.length).toBeGreaterThan(30)
  })

  it('clasifică „Failed to fetch" drept problemă de Rețea', () => {
    expect(explicaEroare('TypeError: Failed to fetch').categorie).toBe('Rețea')
  })

  it('clasifică refuzul de microfon drept Permisiuni', () => {
    expect(explicaEroare('NotAllowedError: Permission denied').categorie).toBe('Permisiuni')
  })

  it('clasifică 5xx drept Server, critic', () => {
    const e = explicaEroare('POST /api/chat → 502 Bad Gateway')
    expect(e.categorie).toBe('Server')
    expect(e.severitate).toBe('critic')
  })

  it('ResizeObserver e benign', () => {
    expect(explicaEroare('ResizeObserver loop completed with undelivered notifications').categorie).toBe('Benign')
  })

  it('NU inventează: o eroare necunoscută e marcată neclasificată, nu o cauză plauzibilă falsă', () => {
    const e = explicaEroare('xyzzy plugh 42 whatever nonstandard thing')
    expect(e.categorie).toBe('Necunoscut')
    expect(e.ceEste.toLowerCase()).toContain('neclasificat')
  })

  it('eroare fără text nu crapă', () => {
    expect(explicaEroare('').categorie).toBe('Necunoscut')
  })

  it('rangSeveritate sortează critic înaintea important înaintea minor', () => {
    expect(rangSeveritate('critic')).toBeLessThan(rangSeveritate('important'))
    expect(rangSeveritate('important')).toBeLessThan(rangSeveritate('minor'))
  })
})
