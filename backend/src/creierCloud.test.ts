// ── COMUTATORUL CREIER 2 (cloud) + SURSA CONSTRUCTORULUI (free/plătit) ───────
// Owner, 16 aug: „ramine chatul live gemeni… creier 2 → Kimi K3 cu comutator
// Qwen3.5 Max… constructor = FREE (local pe VPS) ↔ PLĂTIT (același model ca creier
// 2)… un abonament $20/lună… se aprinde când lipesc cheia".
// Owner, 19 aug: „asigură-te că ORICE mod de comutare (constructor free/plătit,
// identic la creier free/plătit) funcționează real, INCLUSIV între ele — aștept
// dovezile". De-aceea decizia e o funcție PURĂ, probată aici pe FIECARE combinație
// + pe TRANZIȚII, nu doar prin citirea codului.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// KV în memorie pentru testele de persistență/tranziții (fără Postgres real).
const { kv } = vi.hoisted(() => ({ kv: new Map<string, string>() }))
vi.mock('./db.js', () => ({
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
}))

import {
  tagModelCloud,
  bazaOllamaCloud,
  MODELE_CLOUD,
  decideConfigConstructor,
  getConfigCreier,
  setConfigCreier,
} from './services/creierCloud.js'

const aici = dirname(fileURLToPath(import.meta.url))
const s = (rel: string): string => readFileSync(join(aici, rel), 'utf8')

describe('creierCloud — alegerea modelului cloud (Kimi K3 ↔ Qwen3.5 Max)', () => {
  it('gemini → fără tag cloud; kimi-k3/qwen3.5 → tag-ul de model real', () => {
    expect(tagModelCloud('gemini')).toBe('')
    expect(tagModelCloud('kimi-k3')).toBe(MODELE_CLOUD['kimi-k3'])
    expect(tagModelCloud('qwen3.5')).toBe(MODELE_CLOUD['qwen3.5'])
  })
  it('baza cloud e Ollama, suprascriabilă din env', () => {
    expect(bazaOllamaCloud()).toMatch(/^https?:\/\//)
  })

  it('proba AUTENTIFICĂ real (POST /v1/chat/completions), nu se bazează pe /v1/models public', () => {
    // Măsurat 16 aug: GET /v1/models răspunde 200 și FĂRĂ cheie → nu dovedește
    // cheia. Proba trebuie să RULEZE un token și să citească codul HTTP.
    const src = s('./services/creierCloud.ts')
    expect(src).toContain('/v1/chat/completions')
    expect(src).toContain('max_tokens')
    expect(src).toContain('r.status === 200')
    expect(src).toContain('r.status === 401') // cheie invalidă
    expect(src).toContain('r.status === 402') // cheie bună, model pe extra usage (nu-i în plan)
    // Dovada „exact modelul ales": pe 200 citește modelul CONFIRMAT de Ollama
    // (câmpul `model` din răspuns), nu doar cel cerut (owner: „vad clar… kimi 3").
    expect(src).toContain('j?.model')
    // Fetch-ul NU mai lovește lista publică drept dovadă a cheii (doar comentariul
    // o mai pomenește, ca explicație — de-aia țintim exact URL-ul de fetch).
    expect(src).not.toContain('bazaOllamaCloud()}/v1/models')
  })
})

// ── DOVADA COMUTĂRII: decideConfigConstructor pe FIECARE combinație ───────────
// 2 surse (free/plătit) × 3 creiere (Gemini/Kimi K3/Qwen3.5) × 2 chei (da/nu).
// FREE-FIRST: pornirea e mereu free; paid e REZERVĂ când e gata; `platit` forțează
// paid DOAR dacă rezerva e gata (pe Gemini, care n-are model cloud, rămâne free).
describe('decideConfigConstructor — comutarea funcționează pe FIECARE combinație', () => {
  const K = 'id0000000000000.secretsecretsecretXYZ' // cheie „prezentă"

  describe('constructor FREE', () => {
    it('FREE + Gemini + fără cheie → free, fără rezervă', () => {
      const d = decideConfigConstructor({ creier2: 'gemini', constructorSursa: 'free' }, '')
      expect(d.sursa).toBe('free')
      expect(d.paidDisponibil).toBe(false)
      expect(d.fallback).toBeNull()
      expect(d.model).toBe('')
      expect(d.cheie).toBe('')
    })
    it('FREE + Gemini + cheie → tot free (Gemini n-are model cloud), fără rezervă', () => {
      const d = decideConfigConstructor({ creier2: 'gemini', constructorSursa: 'free' }, K)
      expect(d.sursa).toBe('free')
      expect(d.paidDisponibil).toBe(false)
      expect(d.fallback).toBeNull()
    })
    it('FREE + Kimi K3 + fără cheie → free, fără rezervă (cheie lipsă)', () => {
      const d = decideConfigConstructor({ creier2: 'kimi-k3', constructorSursa: 'free' }, '')
      expect(d.sursa).toBe('free')
      expect(d.paidDisponibil).toBe(false)
      expect(d.fallback).toBeNull()
    })
    it('FREE + Kimi K3 + cheie → free-first, DAR rezervă paid gata (kimi-k3)', () => {
      const d = decideConfigConstructor({ creier2: 'kimi-k3', constructorSursa: 'free' }, K)
      expect(d.sursa).toBe('free')
      expect(d.preferred).toBe('free')
      expect(d.paidDisponibil).toBe(true)
      expect(d.fallback).toMatchObject({ sursa: 'platit', model: MODELE_CLOUD['kimi-k3'], cheie: K })
      // pe free, câmpurile de forțare rămân goale (nu pornește paid singur)
      expect(d.model).toBe('')
      expect(d.cheie).toBe('')
    })
    it('FREE + Qwen3.5 + cheie → free-first, rezervă paid qwen3.5:397b', () => {
      const d = decideConfigConstructor({ creier2: 'qwen3.5', constructorSursa: 'free' }, K)
      expect(d.sursa).toBe('free')
      expect(d.paidDisponibil).toBe(true)
      expect(d.fallback?.model).toBe(MODELE_CLOUD['qwen3.5'])
    })
  })

  describe('constructor PLĂTIT', () => {
    it('PLĂTIT + Gemini + cheie → cade pe FREE (Gemini n-are model cloud), NU inventează', () => {
      const d = decideConfigConstructor({ creier2: 'gemini', constructorSursa: 'platit' }, K)
      expect(d.sursa).toBe('free')
      expect(d.paidDisponibil).toBe(false)
      expect(d.model).toBe('')
    })
    it('PLĂTIT + Kimi K3 + fără cheie → cade pe FREE (fără cheie)', () => {
      const d = decideConfigConstructor({ creier2: 'kimi-k3', constructorSursa: 'platit' }, '')
      expect(d.sursa).toBe('free')
      expect(d.paidDisponibil).toBe(false)
    })
    it('PLĂTIT + Kimi K3 + cheie → PLĂTIT real: model kimi-k3 + bază + cheie', () => {
      const d = decideConfigConstructor({ creier2: 'kimi-k3', constructorSursa: 'platit' }, K)
      expect(d.sursa).toBe('platit')
      expect(d.model).toBe(MODELE_CLOUD['kimi-k3'])
      expect(d.base).toBe(bazaOllamaCloud())
      expect(d.cheie).toBe(K)
      expect(d.paidDisponibil).toBe(true)
    })
    it('PLĂTIT + Qwen3.5 + cheie → PLĂTIT real: qwen3.5:397b', () => {
      const d = decideConfigConstructor({ creier2: 'qwen3.5', constructorSursa: 'platit' }, K)
      expect(d.sursa).toBe('platit')
      expect(d.model).toBe(MODELE_CLOUD['qwen3.5'])
      expect(d.cheie).toBe(K)
    })
  })

  it('cheia NU se expune întreagă în coada de diagnostic (doar ultimele 4)', () => {
    const d = decideConfigConstructor({ creier2: 'qwen3.5', constructorSursa: 'platit' }, 'abcdef1234567890WXYZ')
    expect(d.fallback?.cheieCoada).toBe('…WXYZ')
    expect(d.fallback?.cheieCoada).not.toContain('abcdef')
  })
})

// ── DOVADA TRANZIȚIILOR: comuți din oricare mod în oricare, iar configul persistă
describe('getConfigCreier/setConfigCreier — persistență + TRANZIȚII între moduri', () => {
  beforeEach(() => kv.clear())

  it('implicit când nu s-a salvat nimic: Gemini + free', async () => {
    expect(await getConfigCreier()).toEqual({ creier2: 'gemini', constructorSursa: 'free' })
  })

  it('salvează și citește o combinație (Kimi K3 + plătit)', async () => {
    await setConfigCreier({ creier2: 'kimi-k3', constructorSursa: 'platit' })
    expect(await getConfigCreier()).toEqual({ creier2: 'kimi-k3', constructorSursa: 'platit' })
  })

  it('TRANZIȚIE completă: kimi/plătit → qwen/free → gemini/free, fiecare pas persistă', async () => {
    await setConfigCreier({ creier2: 'kimi-k3', constructorSursa: 'platit' })
    expect(await getConfigCreier()).toEqual({ creier2: 'kimi-k3', constructorSursa: 'platit' })
    await setConfigCreier({ creier2: 'qwen3.5', constructorSursa: 'free' })
    expect(await getConfigCreier()).toEqual({ creier2: 'qwen3.5', constructorSursa: 'free' })
    await setConfigCreier({ creier2: 'gemini', constructorSursa: 'free' })
    expect(await getConfigCreier()).toEqual({ creier2: 'gemini', constructorSursa: 'free' })
  })

  it('update PARȚIAL păstrează celălalt câmp (comuți doar creierul, sau doar sursa)', async () => {
    await setConfigCreier({ creier2: 'qwen3.5', constructorSursa: 'platit' })
    await setConfigCreier({ constructorSursa: 'free' }) // doar sursa
    expect(await getConfigCreier()).toEqual({ creier2: 'qwen3.5', constructorSursa: 'free' })
    await setConfigCreier({ creier2: 'kimi-k3' }) // doar creierul
    expect(await getConfigCreier()).toEqual({ creier2: 'kimi-k3', constructorSursa: 'free' })
  })

  it('valori invalide sunt IGNORATE (păstrează curentul, nu inventează)', async () => {
    await setConfigCreier({ creier2: 'qwen3.5', constructorSursa: 'platit' })
    // @ts-expect-error — testăm rezistența la valori din afara mulțimii
    await setConfigCreier({ creier2: 'inexistent', constructorSursa: 'ceva' })
    expect(await getConfigCreier()).toEqual({ creier2: 'qwen3.5', constructorSursa: 'platit' })
  })

  it('kv corupt (JSON invalid) → cade pe implicit, nu crapă', async () => {
    kv.set('creier:cloud', '{nu-i json')
    expect(await getConfigCreier()).toEqual({ creier2: 'gemini', constructorSursa: 'free' })
  })

  it('TRANZIȚIA se vede și în decizia de host (setConfigCreier → decideConfigConstructor)', async () => {
    // free/Gemini → decizie free; comuți pe plătit/qwen cu cheie → decizie plătit real.
    await setConfigCreier({ creier2: 'gemini', constructorSursa: 'free' })
    let cfg = await getConfigCreier()
    expect(decideConfigConstructor(cfg, '').sursa).toBe('free')
    await setConfigCreier({ creier2: 'qwen3.5', constructorSursa: 'platit' })
    cfg = await getConfigCreier()
    const d = decideConfigConstructor(cfg, 'id.secretsecretsecret')
    expect(d.sursa).toBe('platit')
    expect(d.model).toBe(MODELE_CLOUD['qwen3.5'])
  })
})

describe('cablajul comutatorului — panou scrie, host citește, Aider trece pe cloud', () => {
  it('constructor.ts are endpointul de setare (admin) + config-ul host care DELEAGĂ funcției pure', () => {
    const c = s('./routes/constructor.ts')
    expect(c).toContain("app.post<{ Body: { creier2?: string; constructorSursa?: string; ollamaKey?: string } }>(")
    expect(c).toContain("'/api/admin/constructor/creier-cloud'")
    expect(c).toContain("app.get('/api/constructor/creier-config'")
    // statusul admin trimite alegerea + proba MĂSURATĂ a cheii
    expect(c).toContain('creier: creierCfg')
    expect(c).toContain('cloud, // { ok, motiv, modele }')
    // ruta NU mai are logica inline — o deleagă funcției pure probate mai sus
    expect(c).toContain('decideConfigConstructor(cfg, cheie)')
    // free-first + coada mascată trăiesc acum în creierCloud (probate comportamental)
    const cc = s('./services/creierCloud.ts')
    expect(cc).toContain("preferred: 'free'")
    expect(cc).toContain('cheieCoada')
  })

  it('agentul: Aider trece pe CLOUD (openai/<model> + cheie) când sursa=platit', () => {
    const a = s('../../deploy/constructor-agent.mjs')
    expect(a).toContain("creierCfg.sursa === 'platit'")
    expect(a).toContain('`openai/${creierCfg.model}`')
    expect(a).toContain('aiderEnv.OPENAI_API_KEY = creierCfg.cheie')
    // pe cloud NU mai instalăm local; pe free rămâne asiguraCreierulLocal
    expect(a).toContain('if (!platit && !asiguraCreierulLocal())')
    expect(a).toContain("await api('/api/constructor/creier-config'")
  })

  it('panoul (AdminPanel) are comutatorul creier 2 + constructor + câmp de cheie', () => {
    const p = s('../../frontend/src/components/AdminPanel.tsx')
    expect(p).toContain("'/api/admin/constructor/creier-cloud'")
    expect(p).toContain('setCreierCfg')
    expect(p).toContain('ollamaKeyInput')
    expect(p).toContain('Kimi K3 (cloud)')
    expect(p).toContain('Qwen3.5 397B (cloud)')
    expect(p).toContain('PLĂTIT (= creier 2 cloud)')
    // TOP-UP „extra usage" (owner: „bifă pentru kimi 3, in soft sa pot pune extra bani"):
    // buton către plata Ollama + link la prețul viu (fără cifră hardcodată în cod).
    expect(p).toContain('Pune bani extra / auto-reload')
    expect(p).toContain('https://ollama.com/settings')
    expect(p).toContain('Vezi prețul modelului (live)')
    // Becul e cinstit: cheie OK pe cloud ≠ model local constructor; chat greu = Creier 2.
    expect(p).toContain('Cheie OK pe Ollama cloud')
    expect(p).toContain('Chat rapid = Gemini')
    expect(p).toContain('Constructor FREE = Ollama local')
    // „nu stă butonul": pollul de 10s NU mai suprascrie alegerea nesalvată (flag EDITAT).
    expect(p).toContain('creierEditatRef')
    expect(p).toContain('!creierEditatRef.current')
  })
})
