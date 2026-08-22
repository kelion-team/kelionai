// ── OLLAMA LOCAL PE DEVICE (owner, 22 aug 2026: „rezerva reală") ─────────────
//
// Cascade: device (localhost:11434) → VPS → Gemini. Device prioritar.
//
// La pornirea app-ului, verifică discret:
//   1. Ollama instalat pe device? (localhost:11434 răspunde)
//   2. Modelul necesar e tras? (verifică /api/tags)
//   3. Digest-ul modelului local == digest-ul cerut? (dacă nu, update)
//
// Dacă trebuie downloadat ceva, ANUNȚĂ utilizatorul (nu silent, nu întreabă):
//   „Descarc <model> pentru rezerva locală (~2GB) — backdrop la pornire"
//
// Update-urile se verifică comparând digest-ul local cu cel de pe server.
// Dacă diferă, șterge modelul vechi + trage cel nou.
//
// LEGEA ANTI-HARDCODARE: numele modelului + digest-ul vin din /api/ollama/config
// (server, env) — NU hardcodate aici.

import { getOllamaConfig } from './ollamaConfig'

export interface StareOllamaLocal {
  instalat: boolean // Ollama rulează pe device
  modelPrezent: boolean // modelul e tras local
  digestMatch: boolean // digest local == digest cerut
  digestLocal?: string
  digestCerut?: string
  versiune?: string
  ultimaVerificare: number
  inDownload: boolean
  progresDownload?: number // 0-100
  mesaj?: string // mesaj pentru utilizator
}

const OLLAMA_LOCAL = 'http://127.0.0.1:11434' // hardcod-permis: gazda LOCALĂ pe device, universală
const INTERVAL_VERIFICARE_MS = 30 * 60_000 // re-verifică la 30 min
const TIMEOUT_PROBA_MS = 3000 // 3s — device local e rapid sau nu răspunde

let stare: StareOllamaLocal = {
  instalat: false,
  modelPrezent: false,
  digestMatch: false,
  ultimaVerificare: 0,
  inDownload: false,
}

let notificareCb: ((mesaj: string, tip: 'info' | 'progress' | 'gata' | 'eroare') => void) | null = null

/** Înregistrează callback-ul pentru notificări către utilizator. */
export function setNotificareOllama(
  cb: (mesaj: string, tip: 'info' | 'progress' | 'gata' | 'eroare') => void,
): void {
  notificareCb = cb
}

function anunta(mesaj: string, tip: 'info' | 'progress' | 'gata' | 'eroare' = 'info'): void {
  stare.mesaj = mesaj
  notificareCb?.(mesaj, tip)
}

/** Probă vie: Ollama rulează pe device? */
async function probeazaOllama(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_LOCAL}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_PROBA_MS),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Lista modelelor locale + digest-ul modelului nostru. */
async function listaModele(): Promise<{ name: string; digest: string }[] | null> {
  try {
    const r = await fetch(`${OLLAMA_LOCAL}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_PROBA_MS),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { models?: { name?: string; digest?: string }[] }
    return (j.models ?? []).map((m) => ({
      name: m.name ?? '',
      digest: m.digest ?? '',
    }))
  } catch {
    return null
  }
}

function matchModel(name: string, model: string): boolean {
  return name === model || name.startsWith(model.split(':')[0])
}

/** Trage modelul de la Ollama library. Anunță progresul. */
async function pullModel(model: string): Promise<boolean> {
  stare.inDownload = true
  anunta(`Descarc ${model} pentru rezerva locală — backdrop la pornire`, 'info')
  try {
    const r = await fetch(`${OLLAMA_LOCAL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(30 * 60_000), // 30 min max — pe conexiune lentă
    })
    if (!r.ok || !r.body) {
      stare.inDownload = false
      anunta(`Eroare download ${model}: HTTP ${r.status}`, 'eroare')
      return false
    }
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const linii = buf.split('\n')
      buf = linii.pop() ?? ''
      for (const linie of linii) {
        try {
          const j = JSON.parse(linie) as { status?: string; completed?: number; total?: number }
          if (j.status === 'pulling' && j.total && j.completed) {
            const pct = Math.round((j.completed / j.total) * 100)
            stare.progresDownload = pct
            if (pct % 10 === 0) {
              anunta(`Download ${model}: ${pct}%`, 'progress')
            }
          } else if (j.status === 'success') {
            stare.progresDownload = 100
          }
        } catch { /* linie parțială — ignor */ }
      }
    }
    stare.inDownload = false
    anunta(`${model} descărcat — rezerva locală gata`, 'gata')
    return true
  } catch (e) {
    stare.inDownload = false
    anunta(`Eroare download ${model}: ${String(e).slice(0, 100)}`, 'eroare')
    return false
  }
}

/** Șterge modelul vechi (înainte de a trage versiunea nouă). */
async function stergeModel(model: string): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_LOCAL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(10_000),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Raportează starea către backend (pentru cascade device → VPS → Gemini). */
async function raporteazaLaServer(disponibil: boolean): Promise<void> {
  try {
    await fetch('/api/ollama/local-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disponibil }),
    })
  } catch { /* offline — tăcut */ }
}

/** Verificarea completă: instalat → model prezent → digest match → update.
 *  Anunță utilizatorul la fiecare pas care cere acțiune (download). */
export async function verificaOllamaLocal(): Promise<StareOllamaLocal> {
  const acum = Date.now()
  stare.ultimaVerificare = acum

  // Configul de la server (model + digest) — LEGEA ANTI-HARDCODARE
  const cfg = await getOllamaConfig()
  if (!cfg.model) {
    // Serverul nu servește config — nu putem face nimic
    return stare
  }

  // 1. Ollama instalat pe device?
  stare.instalat = await probeazaOllama()
  if (!stare.instalat) {
    stare.modelPrezent = false
    stare.digestMatch = false
    // Nu anunțăm — multi device-uri nu au Ollama; nu vrem zgomot
    void raporteazaLaServer(false)
    return stare
  }

  // 2. Modelul e tras?
  const modele = await listaModele()
  if (!modele) {
    stare.modelPrezent = false
    void raporteazaLaServer(false)
    return stare
  }
  const model = modele.find((m) => matchModel(m.name, cfg.model))
  stare.modelPrezent = !!model
  if (!model) {
    // Trebuie downloadat — ANUNȚĂ utilizatorul
    await pullModel(cfg.model)
    // Re-verifică după download
    const modelePost = await listaModele()
    if (modelePost) {
      const m = modelePost.find((x) => matchModel(x.name, cfg.model))
      if (m) {
        stare.modelPrezent = true
        stare.digestLocal = m.digest
        stare.digestCerut = cfg.digestCerut || m.digest
        stare.digestMatch = true // proaspăt tras = match
        stare.versiune = m.digest.slice(0, 12)
        void raporteazaLaServer(true)
      }
    }
    return stare
  }

  // 3. Digest match?
  stare.digestLocal = model.digest
  if (cfg.digestCerut) {
    stare.digestCerut = cfg.digestCerut
    stare.digestMatch = model.digest === cfg.digestCerut
    if (!stare.digestMatch) {
      anunta(`Update ${cfg.model}: digest diferit — șterg vechiul + descarc nouul`, 'info')
      const sters = await stergeModel(cfg.model)
      if (sters) {
        await pullModel(cfg.model)
        const modelePost = await listaModele()
        if (modelePost) {
          const m = modelePost.find((x) => matchModel(x.name, cfg.model))
          if (m) {
            stare.digestLocal = m.digest
            stare.digestMatch = m.digest === cfg.digestCerut
            stare.versiune = m.digest.slice(0, 12)
          }
        }
      }
    }
  } else {
    // Fără digest cerut — doar prezența contează
    stare.digestMatch = true
    stare.versiune = model.digest.slice(0, 12)
  }

  // Raportează starea finală către backend (cascade)
  void raporteazaLaServer(stare.modelPrezent && stare.digestMatch)

  return stare
}

/** Starea curentă (pentru afișare). */
export function stareOllamaLocal(): StareOllamaLocal {
  return stare
}

/** Pornește verificarea periodică + imediată la startup.
 *  Discret: nu anunță dacă totul e OK, doar dacă trebuie download/update. */
export function pornesteVerificareaOllamaLocal(): void {
  void verificaOllamaLocal().catch(() => {})
  setInterval(() => {
    if (!stare.inDownload) void verificaOllamaLocal().catch(() => {})
  }, INTERVAL_VERIFICARE_MS)
}
