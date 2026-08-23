import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { emotieKelionDominanta, parametriAvatar, actualizeazaEmotieKelion } from '../services/emotiiKelion.js'
import { getSalutDimineata, detecteazaTrezierea, marcheazaActivitate } from '../services/modulVis.js'
import { getJurnaleRecente, getJurnalPentruZi } from '../services/jurnalAuto.js'
import { analizeazaSanatate } from '../services/detectieSanatate.js'
import { getConfigMostenire, setConfigMostenire, stareMostenire, marcheazaActivitateMostenire } from '../services/mostenireDigitala.js'
import { getProfilPersonalitate, promptPersonalitate } from '../services/personalitateEvolutiva.js'

// ── RUTELE CELOR 10 „WAW" (owner, 22 aug 2026: „uimește-mă") ────────────────

export async function wawRoutes(fastify: FastifyInstance): Promise<void> {
  // #1 MODUL VIS — salut de dimineață
  fastify.get('/api/kelion/salut-dimineata', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    marcheazaActivitate()
    void marcheazaActivitateMostenire().catch(() => undefined)
    const trezit = detecteazaTrezierea()
    const salut = trezit ? getSalutDimineata() : null
    return reply.send({ trezit, salut })
  })

  // #3 EMOȚIILE LUI KELION — starea internă + parametri avatar
  fastify.get('/api/kelion/emotie', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(emotieKelionDominanta())
  })

  fastify.get('/api/kelion/avatar-parametri', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(parametriAvatar())
  })

  fastify.post('/api/kelion/emotie/trigger', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { trigger?: string }
    actualizeazaEmotieKelion(corp.trigger as 'user_suparat' | 'user_vesel' | 'user_intreaba' | 'eveniment_urgent' | 'inactivitate' | 'sarcina_reusita')
    return reply.send(emotieKelionDominanta())
  })

  // #4 JURNAL AUTOMAT
  fastify.get('/api/jurnal/recent', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const jurnale = await getJurnaleRecente(user.email, 7)
    return reply.send({ jurnale })
  })

  fastify.get('/api/jurnal/:data', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const { data } = req.params as { data: string }
    const jurnal = await getJurnalPentruZi(user.email, data)
    return reply.send({ jurnal })
  })

  // #5 DETECTARE BURNOUT/SĂNĂTATE
  fastify.get('/api/sanatate/analiza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const alerta = await analizeazaSanatate(user.email)
    return reply.send({ alerta })
  })

  // #9 MOȘTENIRE DIGITALĂ
  fastify.get('/api/mostenire/config', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(await getConfigMostenire())
  })

  fastify.post('/api/mostenire/config', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as Record<string, unknown>
    await setConfigMostenire(corp)
    return reply.send({ ok: true })
  })

  fastify.get('/api/mostenire/stare', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(await stareMostenire())
  })

  // #10 PERSONALITATE EVOLUTIVĂ
  fastify.get('/api/personalitate/profil', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(getProfilPersonalitate())
  })

  fastify.get('/api/personalitate/prompt', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({ prompt: promptPersonalitate() })
  })

  // #6 CLONARE VOCE — stocare + verificare sample
  fastify.get('/api/voce/sample', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    try {
      const { loadKv } = await import('../db.js')
      const raw = await loadKv(`voce_sample_${user.email}`)
      return reply.send({ are: !!raw })
    } catch {
      return reply.send({ are: false })
    }
  })

  fastify.post('/api/voce/sample', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { audioBase64?: string; textCitit?: string }
    if (!corp.audioBase64) return reply.code(400).send({ error: 'lipsa audio' })
    try {
      const { saveKv } = await import('../db.js')
      await saveKv(`voce_sample_${user.email}`, JSON.stringify({
        audio: corp.audioBase64.slice(0, 500000), // max 500KB — sample de 30s
        text: corp.textCitit ?? '',
        ts: Date.now(),
      }))
      return reply.send({ ok: true })
    } catch {
      return reply.code(500).send({ error: 'eroare_stocare' })
    }
  })

  // #6 CLONARE VOCE — SINTEZĂ cu Coqui TTS (XTTS v2)
  // Primește text + email user, încarcă sample-ul din KV, îl trimite la
  // microserviciul Coqui (port 5100 intern), primește audio sintetizat
  // în vocea userului. Folosit pentru conversații de demo (studioul de clipuri).
  fastify.post('/api/voce/sintetizeaza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { text?: string; limba?: string }
    const text = (corp.text ?? '').trim()
    if (!text) return reply.code(400).send({ error: 'lipsa_text' })
    if (text.length > 500) return reply.code(400).send({ error: 'text_prea_lung', max: 500 })

    try {
      const { loadKv } = await import('../db.js')
      const raw = await loadKv(`voce_sample_${user.email}`)
      if (!raw) return reply.code(404).send({ error: 'nu_exista_sample' })

      const sampleData = JSON.parse(raw) as { audio?: string; text?: string }
      if (!sampleData.audio) return reply.code(404).send({ error: 'sample_corupt' })

      // Trimite la microserviciul Coqui (port 5100 intern)
      const coquiUrl = process.env.COQUI_URL ?? 'http://127.0.0.1:5100'
      const r = await fetch(`${coquiUrl}/sintetizeaza`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sample_base64: sampleData.audio,
          limba: corp.limba ?? 'ro',
        }),
        signal: AbortSignal.timeout(30_000), // sinteza pe CPU poate dura
      })

      if (!r.ok) {
        const errText = await r.text().catch(() => '')
        return reply.code(502).send({ error: 'coqui_eroare', status: r.status, detaliu: errText })
      }

      const audioBuf = Buffer.from(await r.arrayBuffer())
      reply.header('Content-Type', 'audio/wav')
      reply.header('Cache-Control', 'no-store')
      return reply.send(audioBuf)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Coqui nu rulează? Spune cinstit, nu masca.
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        return reply.code(503).send({ error: 'coqui_nedisponibil', detaliu: 'Microserviciul Coqui TTS nu rulează pe VPS' })
      }
      return reply.code(500).send({ error: 'eroare_sinteza', detaliu: msg })
    }
  })

  // #6 CLONARE VOCE — STATUS Coqui (e disponibil pentru sinteză?)
  fastify.get('/api/voce/coqui-status', async (_req, reply) => {
    try {
      const coquiUrl = process.env.COQUI_URL ?? 'http://127.0.0.1:5100'
      const r = await fetch(`${coquiUrl}/health`, { signal: AbortSignal.timeout(5000) })
      if (!r.ok) return reply.send({ ok: false, status: r.status })
      const j = (await r.json()) as { ok?: boolean; model?: string }
      return reply.send({ ok: !!j.ok, model: j.model ?? 'necunoscut' })
    } catch {
      return reply.send({ ok: false, model: 'none' })
    }
  })
}
