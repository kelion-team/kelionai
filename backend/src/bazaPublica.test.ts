import { describe, expect, it } from 'vitest'
import { bazaPublica, BAZA_PUBLICA_IMPLICITA } from './services/bazaPublica.js'

// „Nu poate afișa hărți" (10 aug): pe calea vocală creierul e chemat prin
// 127.0.0.1, iar Host-ul ăla devenea baza link-urilor de monitor — browserul
// omului încerca să ia harta de pe PROPRIUL calculator. Testele pinuiesc regula.
describe('bazaPublica — link-urile de ecran nu arată niciodată spre loopback', () => {
  it('Host public → rămâne al lui', () => {
    expect(bazaPublica('kelionai.app')).toBe('https://kelionai.app')
    expect(bazaPublica('www.kelionai.app')).toBe('https://www.kelionai.app')
  })
  it('loopback/intern → domeniul public (cazul căii vocale)', () => {
    expect(bazaPublica('127.0.0.1:8080')).toBe(BAZA_PUBLICA_IMPLICITA)
    expect(bazaPublica('localhost:5173')).toBe(BAZA_PUBLICA_IMPLICITA)
    expect(bazaPublica('10.0.0.7')).toBe(BAZA_PUBLICA_IMPLICITA)
    expect(bazaPublica('192.168.1.5:3000')).toBe(BAZA_PUBLICA_IMPLICITA)
    expect(bazaPublica('172.16.0.9')).toBe(BAZA_PUBLICA_IMPLICITA)
    expect(bazaPublica('[::1]:8080')).toBe(BAZA_PUBLICA_IMPLICITA)
  })
  it('Host absent → domeniul public', () => {
    expect(bazaPublica(undefined)).toBe(BAZA_PUBLICA_IMPLICITA)
    expect(bazaPublica('')).toBe(BAZA_PUBLICA_IMPLICITA)
  })
})
